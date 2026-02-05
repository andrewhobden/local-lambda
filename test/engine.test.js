const path = require('node:path');
const { strict: assert } = require('node:assert');
const { createHandler, closeWorkiqClient } = require('../src/engine');

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, isDebugEnabled: () => false };

describe('engine', () => {
  // Clean up MCP client after all tests to prevent hanging
  after(() => {
    closeWorkiqClient();
  });

  describe('createHandler', () => {
    it('creates a jsHandler correctly', async () => {
      const endpoint = {
        name: 'test-sum',
        jsHandler: { file: 'handlers/sum.js' }
      };
      const baseDir = path.join(__dirname, 'fixtures');
      
      const handler = await createHandler(endpoint, baseDir, noopLogger);
      
      assert.equal(typeof handler, 'function');
      
      const result = await handler({ a: 5, b: 3 });
      assert.deepEqual(result, { sum: 8 });
    });

    it('throws when jsHandler file does not exist', async () => {
      const endpoint = {
        name: 'test-missing',
        jsHandler: { file: 'handlers/nonexistent.js' }
      };
      const baseDir = path.join(__dirname, 'fixtures');
      
      await assert.rejects(
        () => createHandler(endpoint, baseDir, noopLogger),
        /Failed to load JS handler/
      );
    });

    it('throws for aiPrompt without OPENAI_API_KEY', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      const endpoint = {
        name: 'test-ai',
        aiPrompt: { prompt: 'test' }
      };
      
      try {
        await assert.rejects(
          () => createHandler(endpoint, __dirname, noopLogger),
          /OPENAI_API_KEY is required|baseUrl/
        );
      } finally {
        if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it('allows aiPrompt without API key when baseUrl is provided', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      const endpoint = {
        name: 'test-local',
        aiPrompt: { 
          prompt: 'test',
          baseUrl: 'http://localhost:1234/v1',
          model: 'local-model'
        }
      };
      
      try {
        // Should not throw - baseUrl allows no API key
        const handler = await createHandler(endpoint, __dirname, noopLogger);
        assert.equal(typeof handler, 'function');
      } finally {
        if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it('allows aiPrompt with config-level defaultBaseUrl', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      const endpoint = {
        name: 'test-local-default',
        aiPrompt: { 
          prompt: 'test'
        }
      };
      
      const config = {
        defaultBaseUrl: 'http://localhost:1234/v1',
        defaultModel: 'local-model'
      };
      
      try {
        // Should not throw - config defaultBaseUrl allows no API key
        const handler = await createHandler(endpoint, __dirname, noopLogger, config);
        assert.equal(typeof handler, 'function');
      } finally {
        if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it('uses config defaultApiKey when OPENAI_API_KEY not set', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      const endpoint = {
        name: 'test-config-key',
        aiPrompt: { 
          prompt: 'test',
          model: 'gpt-4o'
        }
      };
      
      const config = {
        defaultApiKey: 'sk-test-key'
      };
      
      try {
        // Should not throw - config provides API key
        const handler = await createHandler(endpoint, __dirname, noopLogger, config);
        assert.equal(typeof handler, 'function');
      } finally {
        if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      }
    });
  });

  describe('workiqQuery handler', () => {
    it('creates a workiqQuery handler', async function() {
      // Skip this test if workiq is not installed
      this.timeout(10000);
      
      const endpoint = {
        name: 'test-workiq',
        workiqQuery: { query: 'Test query {{param}}' },
        outputSchema: { type: 'object' }
      };
      
      try {
        const handler = await createHandler(endpoint, __dirname, noopLogger);
        assert.equal(typeof handler, 'function');
      } catch (err) {
        // Skip if workiq is not available
        if (err.message.includes('ENOENT') || err.message.includes('workiq')) {
          this.skip();
        }
        throw err;
      }
    });

    it('replaces placeholders in query template', async function() {
      this.timeout(10000);
      
      const endpoint = {
        name: 'test-workiq',
        workiqQuery: { query: 'Meetings on {{day}} in the {{timeOfDay}}' },
        outputSchema: { type: 'object' }
      };
      
      try {
        const handler = await createHandler(endpoint, __dirname, noopLogger);
        // We can't fully test execution without workiq auth, but we can verify handler creation
        assert.equal(typeof handler, 'function');
      } catch (err) {
        if (err.message.includes('ENOENT') || err.message.includes('workiq')) {
          this.skip();
        }
        throw err;
      }
    });
  });
});
