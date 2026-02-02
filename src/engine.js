const path = require('node:path');

async function createHandler(endpoint, baseDir, logger = console, config = {}) {
  if (endpoint.aiPrompt) {
    return createPromptHandler(endpoint, logger, config.defaultModel);
  }
  return createJsHandler(endpoint, baseDir);
}

async function createPromptHandler(endpoint, logger, defaultModel) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for aiPrompt handlers.');
  }

  let OpenAI;
  try {
    OpenAI = (await import('openai')).default;
  } catch (err) {
    throw new Error(`Failed to load OpenAI SDK: ${err.message}`);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = endpoint.aiPrompt.model || defaultModel || 'gpt-5-mini';
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
      response_format: endpoint.outputSchema ? { type: 'json_object' } : undefined
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content returned from OpenAI.');
    }

    try {
      return JSON.parse(content);
    } catch (err) {
      logger.warn('OpenAI response was not valid JSON, returning raw text.');
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

module.exports = { createHandler };
