# Harbinger

A local text chat with a model picker and an editable system prompt.

Run `npm start` with Node.js 22 or later, then open [Harbinger](http://127.0.0.1:4173).

The server reads `OPENAI_API_KEY` and `OPENROUTER_API_KEY` from the environment or from a local `.credentials` or `.env` file. Set `CREDENTIALS_FILE` to reuse an existing dotenv or flat JSON file elsewhere. The aliases `OPEN_AI_API_KEY` and `OPEN_ROUTER_API_KEY` also work. If your network requires an HTTPS proxy, use Node.js 24.5 or later and set `NODE_USE_ENV_PROXY=1`.

The picker loads live catalogs. OpenAI models use your OpenAI account directly. Models from other publishers use OpenRouter. Models that require audio, image, or other non-chat endpoints appear unavailable for text chat. Access and billing still depend on your API accounts.

Changing the model or system prompt applies to the next message. Each request sends the current prompt and conversation history to the selected provider. Use **New chat** to start a fresh conversation.
