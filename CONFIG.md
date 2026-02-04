# AI Lambda Service Configuration (JSON)

Describe your REST endpoints in a single JSON file. The CLI reads it and wires routes to AI prompts or JS handlers.

## CLI
- `ai-lambda-service start -c config.json -p 3000 -v debug`
- `ai-lambda-service stop` (only affects a server started in the same process; use Ctrl+C otherwise)

Environment:
- `.env` is loaded automatically; set `OPENAI_API_KEY` there for any endpoint using `aiPrompt`.

## Top-level fields
- `port` (number, optional): default 3000 or CLI `-p` override.
- `defaultModel` (string, optional): default OpenAI model for all `aiPrompt` endpoints (e.g., `gpt-5-mini`). Can be overridden per-endpoint.
- `endpoints` (array, required): one or more endpoint objects.

## Endpoint fields
- `name` (string): identifier used in logs.
- `description` (string): brief purpose, also passed to OpenAI system message.
- `path` (string): Express-style path (`/ai-greeting`).
- `method` (string): `GET` or `POST`.
- `inputSchema` (object, optional): JSON Schema for validating request input. For `GET` the query object is validated; for `POST` the JSON body is validated.
- `outputSchema` (object, optional): JSON Schema for validating handler output.
- Exactly **one** of:
  - `aiPrompt`: `{ prompt: string, model?: string, temperature?: number }`
  - `jsHandler`: `{ file: string, export?: string }` where `file` is relative to the config file directory.
  - `workiqQuery`: `{ query: string }` where `query` is the Workiq copilot query to execute.

## AI prompt behavior
- Builds messages with `description` as the system message and `aiPrompt.prompt` + input JSON as the user message.
- Model priority: per-endpoint `aiPrompt.model` > top-level `defaultModel` > built-in default `gpt-5-mini`.
- Default temperature: `1`.

### Output handling
- **With `outputSchema`**: Uses `response_format: json_object` to enforce structured JSON output. The response is parsed and validated against the schema, then returned as `application/json`.
- **Without `outputSchema`**: The raw LLM text is returned directly as `text/plain`. Use this for free-form text responses like translations, summaries, or creative writing.

**Example without outputSchema:**
```json
{
  "name": "translate",
  "path": "/translate",
  "method": "GET",
  "description": "Translate text into Chinese",
  "inputSchema": {
    "type": "object",
    "required": ["text"],
    "properties": { "text": { "type": "string" } }
  },
  "aiPrompt": {
    "prompt": "Translate the provided text into Chinese. Return only the translated text, nothing else."
  }
}
```
This endpoint returns plain text like `你好` instead of JSON.

## JS handler behavior
- The handler module is loaded via `require` using a path relative to the config file directory.
- If `export` is provided, that named export is used; otherwise the module default export must be a function.
- Handler signature: `async function handler(input, req)` returning any JSON-serializable object.

## Workiq query behavior
- Executes the `workiq ask -q "..."` shell command with the configured query.
- Supports `{{placeholder}}` syntax in the query string to inject input values (e.g., `{{day}}` will be replaced with the `day` input value).
- If no placeholders are used, input values are automatically appended as context.
- Has a 60-second timeout for command execution.

### Output handling
- **With `outputSchema`**: The Workiq response is parsed as JSON and validated against the schema.
- **Without `outputSchema`**: The raw text output is returned directly.

**Example with placeholders:**
```json
{
  "name": "meetings",
  "path": "/meetings",
  "method": "GET",
  "description": "Get meetings for a specific day",
  "inputSchema": {
    "type": "object",
    "required": ["day"],
    "properties": {
      "day": { "type": "string" },
      "timeOfDay": { "type": "string" }
    }
  },
  "outputSchema": {
    "type": "object",
    "required": ["meetings"],
    "properties": {
      "meetings": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "time": { "type": "string" }
          }
        }
      }
    }
  },
  "workiqQuery": {
    "query": "What meetings do I have on {{day}} {{timeOfDay}}? Return as JSON with a 'meetings' array."
  }
}
```
This endpoint calls `workiq ask -q "What meetings do I have on Monday afternoon? Return as JSON with a 'meetings' array."` when called with `?day=Monday&timeOfDay=afternoon`.

## Example
See `examples/basic.json` for a working sample with both an AI prompt and a JS handler.
