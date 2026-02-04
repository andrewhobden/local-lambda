const path = require('node:path');
const { strict: assert } = require('node:assert');
const { loadConfig } = require('../src/config');

const noopLogger = { info() {}, warn() {}, error() {} };

describe('config loader', () => {
  it('loads a valid config and normalizes methods', async () => {
    const configPath = path.join(__dirname, 'fixtures', 'js-only-config.json');
    const config = await loadConfig(configPath, noopLogger);

    assert.equal(config.endpoints.length, 1);
    assert.equal(config.endpoints[0].method, 'POST');
    assert.ok(config.baseDir.endsWith(path.join('test', 'fixtures')));
  });

  it('fails when neither aiPrompt, jsHandler, nor workiqQuery is provided', async () => {
    const badConfigPath = path.join(__dirname, 'fixtures', 'invalid-missing-handler.json');
    await assert.rejects(() => loadConfig(badConfigPath, noopLogger), /must specify exactly one/);
  });

  it('loads a valid workiqQuery config', async () => {
    const configPath = path.join(__dirname, 'fixtures', 'workiq-config.json');
    const config = await loadConfig(configPath, noopLogger);

    assert.equal(config.endpoints.length, 1);
    assert.equal(config.endpoints[0].name, 'test-workiq');
    assert.ok(config.endpoints[0].workiqQuery);
    assert.equal(config.endpoints[0].workiqQuery.query, 'What meetings do I have on {{day}} {{timeOfDay}}?');
  });

  it('fails when multiple handlers are specified', async () => {
    const badConfigPath = path.join(__dirname, 'fixtures', 'invalid-multiple-handlers.json');
    await assert.rejects(() => loadConfig(badConfigPath, noopLogger), /must specify exactly one/);
  });

  it('fails when workiqQuery is missing query field', async () => {
    const badConfigPath = path.join(__dirname, 'fixtures', 'invalid-workiq-missing-query.json');
    await assert.rejects(() => loadConfig(badConfigPath, noopLogger), /query/);
  });
});
