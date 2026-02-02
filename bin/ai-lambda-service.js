#!/usr/bin/env node
require('dotenv').config();
const path = require('node:path');
const { Command, InvalidArgumentError } = require('commander');
const pkg = require('../package.json');
const { loadConfig } = require('../src/config');
const { startServer, stopServer } = require('../src/server');
const { createLogger } = require('../src/logger');

const program = new Command();

const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function parsePort(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Port must be a positive integer.');
  }
  return parsed;
}

function parseVerbosity(value) {
  const level = String(value).toLowerCase();
  if (!VALID_LEVELS.has(level)) {
    throw new InvalidArgumentError(`Verbosity must be one of ${Array.from(VALID_LEVELS).join(', ')}.`);
  }
  return level;
}

async function handleCommand(command, options) {
  const logger = createLogger(options.verbose || 'info');

  if (command === 'start') {
    const configPath = options.config ? path.resolve(process.cwd(), options.config) : path.resolve(process.cwd(), 'config.json');
    try {
      const config = await loadConfig(configPath, logger);
      const port = options.port || config.port || 3000;
      await startServer({ config, port, logger });
    } catch (err) {
      logger.error(`Failed to start: ${err.message}`);
      if (logger.isDebugEnabled()) {
        logger.error(err.stack);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'stop') {
    const stopped = await stopServer();
    if (!stopped) {
      logger.warn('No running server found to stop. In-memory mode only supports stopping from the same process.');
    }
    return;
  }

  logger.error(`Unknown command: ${command}`);
  program.help({ error: true });
}

program
  .name('ai-lambda-service')
  .description('Run a local REST server from a declarative JSON config with AI or JS handlers.')
  .version(pkg.version)
  .argument('<command>', 'start | stop')
  .option('-c, --config <path>', 'Path to JSON configuration file (defaults to ./config.json)')
  .option('-p, --port <port>', 'Port to bind the server on', parsePort)
  .option('-v, --verbose <level>', 'Log level: debug | info | warn | error', parseVerbosity, 'info')
  .action((command, options) => {
    handleCommand(command, options);
  });

program.on('command:*', () => {
  program.help({ error: true });
});

program.parse(process.argv);
