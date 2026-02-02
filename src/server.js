const express = require('express');
const Ajv = require('ajv');
const { createHandler } = require('./engine');

let currentServer = null;

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
