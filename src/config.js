const fs = require('node:fs/promises');
const path = require('node:path');
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, strict: false });

const endpointSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'path', 'method'],
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    path: { type: 'string', minLength: 1 },
    method: { type: 'string', enum: ['GET', 'POST', 'get', 'post'] },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    aiPrompt: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1 },
        model: { type: 'string', minLength: 1 },
        temperature: { type: 'number', minimum: 0, maximum: 2 }
      }
    },
    jsHandler: {
      type: 'object',
      additionalProperties: false,
      required: ['file'],
      properties: {
        file: { type: 'string', minLength: 1 },
        export: { type: 'string', minLength: 1 }
      }
    },
    workiqQuery: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 }
      }
    }
  }
};

const configSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['endpoints'],
  properties: {
    port: { type: 'integer', minimum: 1 },
    defaultModel: { type: 'string', minLength: 1 },
    endpoints: {
      type: 'array',
      minItems: 1,
      items: endpointSchema
    }
  }
};

const validateConfig = ajv.compile(configSchema);

async function loadConfig(configPath, logger = console) {
  const fullPath = path.resolve(configPath);
  let raw;
  try {
    raw = await fs.readFile(fullPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read config at ${fullPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config: ${err.message}`);
  }

  const valid = validateConfig(parsed);
  if (!valid) {
    const message = ajv.errorsText(validateConfig.errors, { dataVar: 'config' });
    throw new Error(`Config validation failed: ${message}`);
  }

  parsed.endpoints.forEach((ep, index) => {
    const hasPrompt = Boolean(ep.aiPrompt);
    const hasJs = Boolean(ep.jsHandler);
    const hasWorkiq = Boolean(ep.workiqQuery);
    const handlerCount = [hasPrompt, hasJs, hasWorkiq].filter(Boolean).length;
    if (handlerCount !== 1) {
      throw new Error(`Endpoint at index ${index} must specify exactly one of aiPrompt, jsHandler, or workiqQuery.`);
    }
    ep.method = ep.method.toUpperCase();
  });

  const config = { ...parsed, baseDir: path.dirname(fullPath) };
  logger.info(`Loaded config from ${fullPath} with ${config.endpoints.length} endpoints.`);
  return config;
}

module.exports = { loadConfig };
