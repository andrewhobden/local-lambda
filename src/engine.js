const path = require('node:path');
const { exec, spawn, execSync } = require('node:child_process');
const { promisify } = require('node:util');
const readline = require('node:readline');

const execAsync = promisify(exec);

// Helper to run workiq CLI command with proper shell environment
async function runWorkiqCli(query, logger) {
  const workiqPath = `${process.env.HOME}/.nvm/versions/node/v24.6.0/bin/workiq`;
  
  // Escape single quotes in the query
  const escapedQuery = query.replace(/'/g, "'\"'\"'");
  
  // Run via login shell to get full environment including auth tokens
  const command = `${workiqPath} ask -q '${escapedQuery}'`;
  
  logger.info(`Running workiq CLI: ${command}`);
  
  return new Promise((resolve, reject) => {
    exec(command, {
      timeout: 180000, // 3 minute timeout
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.nvm/versions/node/v24.6.0/bin:${process.env.PATH}`
      }
    }, (error, stdout, stderr) => {
      if (stderr) {
        logger.warn(`workiq stderr: ${stderr}`);
      }
      
      if (error) {
        logger.error(`workiq CLI error: ${error.message}`);
        reject(new Error(`workiq CLI failed: ${error.message}${stderr ? `\nStderr: ${stderr}` : ''}`));
        return;
      }
      
      resolve(stdout.trim());
    });
  });
}

// MCP Client for communicating with workiq MCP server
class WorkiqMcpClient {
  constructor(logger) {
    this.logger = logger;
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
    this.tools = [];
    this.buffer = '';
  }

  async connect() {
    if (this.process) return;

    const workiqPath = `${process.env.HOME}/.nvm/versions/node/v24.6.0/bin/workiq`;
    
    this.logger.info('Starting workiq MCP server...');
    
    this.process = spawn(workiqPath, ['mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.nvm/versions/node/v24.6.0/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`
      }
    });

    // Handle stderr for debugging
    this.process.stderr.on('data', (data) => {
      this.logger.warn(`workiq MCP stderr: ${data.toString()}`);
    });

    // Handle stdout - MCP uses newline-delimited JSON
    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.on('error', (err) => {
      this.logger.error(`workiq MCP process error: ${err.message}`);
    });

    this.process.on('close', (code) => {
      this.logger.info(`workiq MCP server exited with code ${code}`);
      this.process = null;
      this.initialized = false;
    });

    // Initialize MCP connection
    await this.initialize();
  }

  processBuffer() {
    // MCP messages are newline-delimited JSON
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (err) {
        this.logger.warn(`Failed to parse MCP message: ${line}`);
      }
    }
  }

  handleMessage(message) {
    this.logger.info(`MCP received: ${JSON.stringify(message).substring(0, 200)}`);
    
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      
      if (message.error) {
        reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    }
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 120000);

      // Store timeout ref to clear on response
      const pending = this.pendingRequests.get(id);
      if (pending) {
        const originalResolve = pending.resolve;
        const originalReject = pending.reject;
        pending.resolve = (result) => {
          clearTimeout(timeout);
          originalResolve(result);
        };
        pending.reject = (err) => {
          clearTimeout(timeout);
          originalReject(err);
        };
      }

      this.logger.info(`MCP sending: ${JSON.stringify(request)}`);
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async initialize() {
    // Send MCP initialize request
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'ai-lambda-service',
        version: '1.0.0'
      }
    });
    
    this.logger.info(`MCP initialized: ${JSON.stringify(initResult)}`);
    
    // Send initialized notification
    this.process.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');
    
    // List available tools
    const toolsResult = await this.sendRequest('tools/list', {});
    this.tools = toolsResult.tools || [];
    this.logger.info(`MCP tools available: ${this.tools.map(t => t.name).join(', ')}`);
    
    // Accept EULA if needed
    const eulaAccepted = await this.acceptEulaIfNeeded();
    if (!eulaAccepted) {
      this.logger.warn('EULA may not have been accepted - ask_work_iq might fail');
    }
    
    this.initialized = true;
  }

  async acceptEulaIfNeeded() {
    const eulaTool = this.tools.find(t => t.name === 'accept_eula');
    if (!eulaTool) {
      return true; // No EULA tool, assume already accepted
    }
    
    try {
      this.logger.info('Accepting WorkIQ EULA...');
      const result = await this.sendRequest('tools/call', {
        name: 'accept_eula',
        arguments: { eulaUrl: 'https://github.com/microsoft/work-iq-mcp' }
      });
      this.logger.info(`EULA acceptance result: ${JSON.stringify(result)}`);
      return true;
    } catch (err) {
      this.logger.warn(`EULA acceptance failed: ${err.message}`);
      return false;
    }
  }

  async ask(query) {
    if (!this.initialized) {
      await this.connect();
    }

    // Use the ask_work_iq tool
    const askTool = this.tools.find(t => t.name === 'ask_work_iq');

    if (!askTool) {
      throw new Error('ask_work_iq tool not found in workiq MCP server. Available tools: ' + this.tools.map(t => t.name).join(', '));
    }

    this.logger.info(`Using MCP tool: ${askTool.name}`);

    // Call the tool - the parameter might be 'question' or 'query' - check the tool schema
    const toolArgs = {};
    if (askTool.inputSchema && askTool.inputSchema.properties) {
      const paramName = Object.keys(askTool.inputSchema.properties)[0] || 'question';
      toolArgs[paramName] = query;
    } else {
      toolArgs.question = query;
    }
    
    this.logger.info(`MCP tool args: ${JSON.stringify(toolArgs)}`);

    // Call the tool
    const result = await this.sendRequest('tools/call', {
      name: askTool.name,
      arguments: toolArgs
    });

    // Check for MCP tool error
    if (result.isError) {
      const errorText = result.content?.find(c => c.type === 'text')?.text || 'Unknown MCP tool error';
      throw new Error(`workiq MCP tool error: ${errorText}`);
    }

    // Extract text content from result
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content.find(c => c.type === 'text');
      if (textContent) {
        return textContent.text;
      }
    }
    
    return JSON.stringify(result);
  }

  close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
  }
}

// Singleton MCP client instance
let mcpClient = null;

async function getWorkiqMcpClient(logger) {
  if (!mcpClient) {
    mcpClient = new WorkiqMcpClient(logger);
    await mcpClient.connect();
  }
  return mcpClient;
}

async function createHandler(endpoint, baseDir, logger = console, config = {}) {
  if (endpoint.aiPrompt) {
    return createPromptHandler(endpoint, logger, config);
  }
  if (endpoint.workiqQuery) {
    return createWorkiqHandler(endpoint, logger);
  }
  return createJsHandler(endpoint, baseDir);
}

async function createPromptHandler(endpoint, logger, config = {}) {
  // Resolve API key: endpoint > config > environment
  const apiKey = endpoint.aiPrompt.apiKey || config.defaultApiKey || process.env.OPENAI_API_KEY;
  
  // Resolve base URL: endpoint > config > default (OpenAI)
  const baseUrl = endpoint.aiPrompt.baseUrl || config.defaultBaseUrl;
  
  // API key is only required when using OpenAI (no custom baseUrl) or if explicitly set
  // Local LLM servers like LM Studio often don't require auth
  if (!apiKey && !baseUrl) {
    throw new Error('OPENAI_API_KEY is required for aiPrompt handlers, or specify a baseUrl for local LLM servers.');
  }

  let OpenAI;
  try {
    OpenAI = (await import('openai')).default;
  } catch (err) {
    throw new Error(`Failed to load OpenAI SDK: ${err.message}`);
  }

  const clientOptions = {};
  if (apiKey) {
    clientOptions.apiKey = apiKey;
  } else {
    // For local servers without auth, use a dummy key (SDK requires something)
    clientOptions.apiKey = 'not-required';
  }
  if (baseUrl) {
    clientOptions.baseURL = baseUrl;
  }

  const client = new OpenAI(clientOptions);
  const model = endpoint.aiPrompt.model || config.defaultModel || 'gpt-4o-mini';
  const temperature = endpoint.aiPrompt.temperature ?? 1;

  return async (input, req) => {
    const messages = [
      { role: 'system', content: endpoint.description },
      {
        role: 'user',
        content: `${endpoint.aiPrompt.prompt}\n\nInput JSON:\n${JSON.stringify(input)}`
      }
    ];

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature,
      // Only include response_format if using OpenAI (some local servers don't support it)
      ...(endpoint.outputSchema && !baseUrl ? { response_format: { type: 'json_object' } } : {})
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content returned from LLM.');
    }

    // If no outputSchema, return raw text directly
    if (!endpoint.outputSchema) {
      return content;
    }

    // Otherwise parse as JSON
    try {
      return JSON.parse(content);
    } catch (err) {
      logger.warn('LLM response was not valid JSON, returning raw text.');
      return { result: content };
    }
  };
}

async function createJsHandler(endpoint, baseDir) {
  const handlerPath = path.resolve(baseDir, endpoint.jsHandler.file);
  let moduleExport;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    moduleExport = require(handlerPath);
  } catch (err) {
    throw new Error(`Failed to load JS handler at ${handlerPath}: ${err.message}`);
  }

  const handlerFn = endpoint.jsHandler.export
    ? moduleExport[endpoint.jsHandler.export]
    : moduleExport;

  if (typeof handlerFn !== 'function') {
    throw new Error(`JS handler at ${handlerPath} is not a function.`);
  }

  return async (input, req) => handlerFn(input, req);
}

async function createWorkiqHandler(endpoint, logger) {
  // Pre-initialize the MCP client when the handler is created
  const client = await getWorkiqMcpClient(logger);
  
  return async (input, req) => {
    // Build the query by combining the template with input values
    let query = endpoint.workiqQuery.query;
    
    // Replace {{key}} placeholders with input values
    for (const [key, value] of Object.entries(input)) {
      query = query.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
    
    // Also append input as context if there are remaining values
    const inputContext = Object.keys(input).length > 0 
      ? ` Context: ${JSON.stringify(input)}` 
      : '';
    
    // Only append context if no placeholders were used
    const hasPlaceholders = endpoint.workiqQuery.query.includes('{{');
    const finalQuery = hasPlaceholders ? query : query + inputContext;
    
    logger.info(`Executing workiq query: ${finalQuery}`);
    
    let result;
    
    // Try MCP first, fall back to CLI if it fails
    try {
      result = await client.ask(finalQuery);
      logger.info(`workiq MCP returned: ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);
    } catch (mcpErr) {
      logger.warn(`MCP failed (${mcpErr.message}), falling back to CLI...`);
      
      try {
        result = await runWorkiqCli(finalQuery, logger);
        logger.info(`workiq CLI returned: ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);
      } catch (cliErr) {
        logger.error(`workiq CLI also failed: ${cliErr.message}`);
        throw new Error(`Workiq query failed. MCP: ${mcpErr.message}. CLI: ${cliErr.message}`);
      }
    }
    
    // If outputSchema is defined, try to parse as JSON
    if (endpoint.outputSchema) {
      try {
        return JSON.parse(result);
      } catch (err) {
        logger.warn('workiq response was not valid JSON, returning as result object.');
        return { result };
      }
    }
    
    // No outputSchema, return raw text
    return result;
  };
}

// Cleanup function to close MCP client (for tests and shutdown)
function closeWorkiqClient() {
  if (mcpClient) {
    mcpClient.close();
    mcpClient = null;
  }
}

module.exports = { createHandler, closeWorkiqClient };
