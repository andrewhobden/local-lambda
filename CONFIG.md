# Local Lambda Configuration (JSON)

Describe your REST endpoints in a single JSON file. The CLI reads it and wires routes to AI prompts or JS handlers.

## CLI
- `local-lambda start -c config.json -p 3000 -v debug`
- `local-lambda stop` (only affects a server started in the same process; use Ctrl+C otherwise)

Environment:
- `.env` is loaded automatically; set `OPENAI_API_KEY` there for any endpoint using `aiPrompt`.

## Top-level fields
- `port` (number, optional): default 3000 or CLI `-p` override.
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

## AI prompt behavior
- Builds messages with `description` as the system message and `aiPrompt.prompt` + input JSON as the user message.
- Uses `response_format: json_object` when `outputSchema` is provided.
- Default model: `gpt-5-mini`; default temperature: `1` (only supported value for this model).

## JS handler behavior
- The handler module is loaded via `require` using a path relative to the config file directory.
- If `export` is provided, that named export is used; otherwise the module default export must be a function.
- Handler signature: `async function handler(input, req)` returning any JSON-serializable object.

## Example
See `examples/basic.json` for a working sample with both an AI prompt and a JS handler.
