# ai-lambda-service

Run a local REST server from a declarative JSON config. Each endpoint can be backed by an OpenAI prompt or a JavaScript handler.

## Installation

Install globally via npm:

```bash
npm install -g ai-lambda-service
```

Or add it as a project dependency:

```bash
npm install ai-lambda-service
```

## Quick start

1) Add your OpenAI key to `.env`:
```
OPENAI_API_KEY=sk-...
```

2) Create a config file (e.g., `config.json`) — see [Configuration](#configuration) below.

3) Start the server:
```bash
ai-lambda-service start -c config.json
```

Or if installed locally, use npx:
```bash
npx ai-lambda-service start -c config.json
```

4) Try the sample endpoints:
- AI prompt: `POST http://localhost:4000/ai-greeting` with `{ "name": "Ada" }`
- JS handler: `POST http://localhost:4000/sum` with `{ "a": 1, "b": 2 }`
- AI prompt (GET): `GET http://localhost:4000/countries?continent=Europe`

5) **Or use the interactive dashboard** — open `http://localhost:4000` in your browser!

## Interactive Dashboard

When you visit the root URL of your running service, you'll see an interactive dashboard that lets you explore and test all endpoints without writing any code or using curl.

![Interactive Dashboard](docs/dashboard-screenshot.png)

**Features:**
- Lists all configured endpoints with method, path, and description
- Shows handler type (AI Prompt or JS Handler) for each endpoint
- Auto-generates input fields based on each endpoint's `inputSchema`
- Send requests with one click and see formatted JSON responses
- Displays response status and timing information

This makes it easy to:
- Explore available endpoints during development
- Test endpoints with different inputs
- Debug responses without leaving the browser
- Share API documentation with your team

## Configuration
- See [CONFIG.md](CONFIG.md) for the JSON schema and field descriptions.
- Sample config: [examples/basic.json](examples/basic.json)
- Sample JS handler: [examples/handlers/sum.js](examples/handlers/sum.js)
	- Includes endpoints: `hello-ai`, `sum-js`, and `countries` (GET with `continent` query)

### Minimal config example
Save this as `config.json` (paths in `jsHandler.file` are relative to this file):

```json
{
	"port": 4000,
	"endpoints": [
		{
			"name": "hello-ai",
			"description": "Return a friendly greeting using an OpenAI prompt.",
			"path": "/ai-greeting",
			"method": "POST",
			"inputSchema": {
				"type": "object",
				"required": ["name"],
				"properties": { "name": { "type": "string" } },
				"additionalProperties": false
			},
			"outputSchema": {
				"type": "object",
				"required": ["greeting"],
				"properties": { "greeting": { "type": "string" } },
				"additionalProperties": false
			},
			"aiPrompt": {
				"prompt": "Write a JSON object with a key 'greeting' that greets the provided name in one short sentence.",
				"model": "gpt-5-mini",
				"temperature": 1
			}
		},
		{
			"name": "sum-js",
			"description": "Sum two numbers using a JS handler.",
			"path": "/sum",
			"method": "POST",
			"inputSchema": {
				"type": "object",
				"required": ["a", "b"],
				"properties": { "a": { "type": "number" }, "b": { "type": "number" } },
				"additionalProperties": false
			},
			"outputSchema": {
				"type": "object",
				"required": ["sum"],
				"properties": { "sum": { "type": "number" } },
				"additionalProperties": false
			},
			"jsHandler": {
				"file": "handlers/sum.js"
			}
		}
	]
}
```

Create `handlers/sum.js` next to the config:

```js
module.exports = async (input) => {
	return { sum: Number(input.a) + Number(input.b) };
};
```

### Environment
- `.env` is loaded automatically.
- `OPENAI_API_KEY` is required for any endpoint using `aiPrompt`.

## CLI
Implemented in [bin/ai-lambda-service.js](bin/ai-lambda-service.js).

```
ai-lambda-service start -c <config.json> -p <port> -v <level>
ai-lambda-service stop
```
- `-c, --config`: path to JSON config (default `./config.json`)
- `-p, --port`: port override (else uses config.port or 3000)
- `-v, --verbose`: `debug|info|warn|error` (default `info`)

## How it works
- Config is validated with AJV in [src/config.js](src/config.js).
- Routes are bound in [src/server.js](src/server.js) using Express.
- Each endpoint uses either an OpenAI chat completion or a JS handler via [src/engine.js](src/engine.js).
- Input/output validation uses JSON Schema per-endpoint.
- **Output format**: When `outputSchema` is defined, responses are JSON. Without it, AI endpoints return plain text directly—useful for translations, summaries, etc.

## Testing
```
npm test
```
Mocha + Supertest cover config loading and JS handler endpoints. Test fixtures live in [test/fixtures](test/fixtures).

## License
ISC
