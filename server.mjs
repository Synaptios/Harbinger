import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createProviders } from './providers.mjs';

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const MAX_BODY_BYTES = 1024 * 1024;

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function readChat(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw invalid('Send a JSON request.', 415);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw invalid('This conversation is too long to send. Start a new chat.', 413);
    }
    chunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalid('Send valid JSON.');
  }

  const { provider, model, system = '', messages } = body ?? {};
  if (!['openai', 'openrouter'].includes(provider) || typeof model !== 'string' || !model) {
    throw invalid('Choose a model first.');
  }
  if (typeof system !== 'string' || !Array.isArray(messages) || messages.length === 0) {
    throw invalid('Provide a valid system prompt and message history.');
  }
  if (messages.some((message, index) => (
    message?.role !== (index % 2 === 0 ? 'user' : 'assistant')
    || typeof message.content !== 'string' || !message.content.trim()
  )) || messages.at(-1).role !== 'user') {
    throw invalid('Conversation messages must alternate and end with a user message.');
  }
  return {
    provider,
    model,
    system,
    messages: messages.map(({ role, content }) => ({ role, content })),
  };
}

export function createServer({ providers = createProviders() } = {}) {
  return createHttpServer(async (request, response) => {
    try {
      if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host ?? '')) {
        json(response, 403, { error: 'Open Harbinger on localhost.' });
        return;
      }
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && path === '/api/models') {
        json(response, 200, await providers.catalog());
        return;
      }
      if (request.method === 'POST' && path === '/api/chat') {
        const message = await providers.chat(await readChat(request));
        json(response, 200, { message });
        return;
      }

      const asset = STATIC_FILES.get(path);
      if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
        const [file, contentType] = asset;
        const contents = await readFile(new URL(`./public/${file}`, import.meta.url));
        response.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': contents.length,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        });
        response.end(request.method === 'HEAD' ? undefined : contents);
        return;
      }
      json(response, 404, { error: 'Page not found.' });
    } catch (error) {
      if (response.destroyed) return;
      const status = Number.isInteger(error.status) ? error.status : 500;
      json(response, status, { error: status === 500 ? 'The server could not finish the request.' : error.message });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => {
    console.log(`Harbinger is ready at http://127.0.0.1:${server.address().port}`);
  });
}
