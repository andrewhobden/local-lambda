const express = require('express');
const Ajv = require('ajv');
const { createHandler } = require('./engine');

let currentServer = null;

function generateIndexPage(config, port) {
  const endpoints = config.endpoints.map(ep => ({
    name: ep.name,
    description: ep.description,
    path: ep.path,
    method: ep.method,
    inputSchema: ep.inputSchema || null,
    handlerType: ep.aiPrompt ? 'AI Prompt' : ep.workiqQuery ? 'Workiq Query' : 'JS Handler'
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Lambda Service</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0; line-height: 1.6; padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #f8fafc; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .endpoints { display: grid; gap: 1.5rem; }
    .endpoint {
      background: #1e293b; border-radius: 12px; padding: 1.5rem;
      border: 1px solid #334155;
    }
    .endpoint-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    .method {
      padding: 0.25rem 0.75rem; border-radius: 6px; font-weight: 600;
      font-size: 0.75rem; text-transform: uppercase;
    }
    .method-get { background: #065f46; color: #6ee7b7; }
    .method-post { background: #1e40af; color: #93c5fd; }
    .endpoint-path { font-family: monospace; font-size: 1.1rem; color: #f8fafc; }
    .endpoint-name { color: #94a3b8; font-size: 0.875rem; }
    .endpoint-desc { color: #cbd5e1; margin-bottom: 1rem; }
    .handler-type {
      display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px;
      font-size: 0.75rem; background: #374151; color: #9ca3af; margin-bottom: 1rem;
    }
    .params { margin-bottom: 1rem; }
    .param-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
    .param-label { 
      min-width: 120px; font-family: monospace; font-size: 0.875rem; color: #94a3b8;
    }
    .param-input {
      flex: 1; padding: 0.5rem 0.75rem; border-radius: 6px; border: 1px solid #475569;
      background: #0f172a; color: #f8fafc; font-size: 0.875rem;
    }
    .param-input:focus { outline: none; border-color: #3b82f6; }
    .param-type { font-size: 0.75rem; color: #64748b; min-width: 60px; }
    .btn {
      padding: 0.5rem 1.5rem; border-radius: 6px; border: none; cursor: pointer;
      font-weight: 600; font-size: 0.875rem; transition: all 0.2s;
    }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-primary:disabled { background: #475569; cursor: not-allowed; }
    .response-area {
      margin-top: 1rem; padding: 1rem; border-radius: 8px; background: #0f172a;
      border: 1px solid #334155; display: none;
    }
    .response-area.visible { display: block; }
    .response-header { 
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 0.5rem; font-size: 0.875rem;
    }
    .response-status { font-weight: 600; }
    .response-status.success { color: #4ade80; }
    .response-status.error { color: #f87171; }
    .response-time { color: #64748b; }
    .response-body {
      font-family: monospace; font-size: 0.875rem; white-space: pre-wrap;
      word-break: break-word; color: #e2e8f0; max-height: 300px; overflow-y: auto;
    }
    .loading { display: inline-block; width: 16px; height: 16px; 
      border: 2px solid #475569; border-top-color: #3b82f6;
      border-radius: 50%; animation: spin 1s linear infinite; margin-right: 0.5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 AI Lambda Service</h1>
    <p class="subtitle">Running on port ${port} • ${endpoints.length} endpoint${endpoints.length !== 1 ? 's' : ''} available</p>
    
    <div class="endpoints">
      ${endpoints.map((ep, idx) => `
        <div class="endpoint" data-index="${idx}">
          <div class="endpoint-header">
            <span class="method method-${ep.method.toLowerCase()}">${ep.method}</span>
            <span class="endpoint-path">${ep.path}</span>
            <span class="endpoint-name">(${ep.name})</span>
          </div>
          <p class="endpoint-desc">${ep.description}</p>
          <span class="handler-type">${ep.handlerType}</span>
          
          <div class="params">
            ${ep.inputSchema?.properties ? Object.entries(ep.inputSchema.properties).map(([key, val]) => `
              <div class="param-row">
                <label class="param-label">${key}${ep.inputSchema.required?.includes(key) ? ' *' : ''}</label>
                <input type="text" class="param-input" data-param="${key}" 
                  placeholder="Enter ${val.type || 'value'}">
                <span class="param-type">${val.type || 'any'}</span>
              </div>
            `).join('') : '<p style="color: #64748b; font-size: 0.875rem;">No input parameters</p>'}
          </div>
          
          <button class="btn btn-primary" onclick="callEndpoint(${idx})">
            Send Request
          </button>
          
          <div class="response-area" id="response-${idx}">
            <div class="response-header">
              <span class="response-status" id="status-${idx}"></span>
              <span class="response-time" id="time-${idx}"></span>
            </div>
            <pre class="response-body" id="body-${idx}"></pre>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <script>
    const endpoints = ${JSON.stringify(endpoints)};

    async function callEndpoint(idx) {
      const ep = endpoints[idx];
      const container = document.querySelector(\`.endpoint[data-index="\${idx}"]\`);
      const btn = container.querySelector('.btn');
      const responseArea = document.getElementById(\`response-\${idx}\`);
      const statusEl = document.getElementById(\`status-\${idx}\`);
      const timeEl = document.getElementById(\`time-\${idx}\`);
      const bodyEl = document.getElementById(\`body-\${idx}\`);

      // Gather params
      const params = {};
      container.querySelectorAll('.param-input').forEach(input => {
        const key = input.dataset.param;
        let value = input.value.trim();
        if (value) {
          // Try to parse numbers
          const schema = ep.inputSchema?.properties?.[key];
          if (schema?.type === 'number') {
            value = parseFloat(value);
          } else if (schema?.type === 'integer') {
            value = parseInt(value, 10);
          }
          params[key] = value;
        }
      });

      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span>Loading...';
      responseArea.classList.add('visible');
      statusEl.textContent = 'Sending...';
      statusEl.className = 'response-status';
      bodyEl.textContent = '';

      const startTime = performance.now();

      try {
        let response;
        if (ep.method === 'GET') {
          const qs = new URLSearchParams(params).toString();
          response = await fetch(ep.path + (qs ? '?' + qs : ''));
        } else {
          response = await fetch(ep.path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
          });
        }

        const elapsed = Math.round(performance.now() - startTime);
        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await response.json();
          bodyEl.textContent = JSON.stringify(data, null, 2);
        } else {
          data = await response.text();
          bodyEl.textContent = data;
        }

        statusEl.textContent = response.ok ? \`✓ \${response.status} OK\` : \`✗ \${response.status} Error\`;
        statusEl.className = 'response-status ' + (response.ok ? 'success' : 'error');
        timeEl.textContent = \`\${elapsed}ms\`;
      } catch (err) {
        const elapsed = Math.round(performance.now() - startTime);
        statusEl.textContent = '✗ Network Error';
        statusEl.className = 'response-status error';
        timeEl.textContent = \`\${elapsed}ms\`;
        bodyEl.textContent = err.message;
      }

      btn.disabled = false;
      btn.textContent = 'Send Request';
    }
  </script>
</body>
</html>`;
}

async function startServer({ config, port, logger = console }) {
  if (currentServer) {
    logger.warn('A server is already running. Stopping the existing server before starting a new one.');
    await stopServer();
  }

  const app = express();
  const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/__health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Index page with interactive endpoint explorer
  app.get('/', (_req, res) => {
    res.send(generateIndexPage(config, port));
  });

  // API endpoint to get config for the UI
  app.get('/__endpoints', (_req, res) => {
    res.json(config.endpoints.map(ep => ({
      name: ep.name,
      description: ep.description,
      path: ep.path,
      method: ep.method,
      inputSchema: ep.inputSchema || null,
      outputSchema: ep.outputSchema || null,
      handlerType: ep.aiPrompt ? 'AI Prompt' : 'JS Handler'
    })));
  });

  for (const endpoint of config.endpoints) {
    const method = endpoint.method.toLowerCase();
    const validateInput = endpoint.inputSchema ? ajv.compile(endpoint.inputSchema) : null;
    const validateOutput = endpoint.outputSchema ? ajv.compile(endpoint.outputSchema) : null;
    const handler = await createHandler(endpoint, config.baseDir, logger, config);

    if (typeof app[method] !== 'function') {
      throw new Error(`Unsupported method ${endpoint.method} for ${endpoint.path}`);
    }

    logger.info(`Binding ${endpoint.method} ${endpoint.path} -> ${endpoint.name}`);

    app[method](endpoint.path, async (req, res) => {
      const input = endpoint.method === 'GET' ? req.query : req.body;

      if (validateInput && !validateInput(input)) {
        return res.status(400).json({ error: 'Invalid request', details: validateInput.errors });
      }

      try {
        const output = await handler(input, req);

        if (validateOutput && !validateOutput(output)) {
          return res.status(500).json({
            error: 'Handler output failed validation',
            details: validateOutput.errors
          });
        }

        // If output is a string (no outputSchema), send as plain text
        if (typeof output === 'string') {
          return res.type('text/plain').send(output);
        }

        return res.json(output);
      } catch (err) {
        logger.error(`Error in handler ${endpoint.name}: ${err.message}`);
        return res.status(500).json({ error: 'Handler error', detail: err.message });
      }
    });
  }

  const server = app.listen(port, () => {
    logger.info(`ai-lambda-service listening on http://localhost:${port}`);
  });

  currentServer = server;

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down...`);
    await stopServer();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

async function stopServer() {
  if (!currentServer) return false;

  await new Promise((resolve) => {
    currentServer.close(() => resolve());
  });
  currentServer = null;
  return true;
}

module.exports = { startServer, stopServer };
