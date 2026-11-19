import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playFixedTurn, playerView, startEpisode, title } from './episode.mjs';
import { openStore } from './store.mjs';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Send JSON to this endpoint.'), { status: 415 });
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw Object.assign(new Error('This request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('This request contains invalid JSON.'), { status: 400 });
  }
}

export function createHarbinger({ databasePath = resolve('.harbinger/bread-ledger.sqlite') } = {}) {
  const store = openStore(databasePath);
  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      const { method } = request;
      if (method === 'GET' && Object.hasOwn(assets, pathname)) {
        const [path, type] = assets[pathname];
        const data = await readFile(new URL('../public/' + path, import.meta.url));
        response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
        return response.end(data);
      }
      if (method === 'GET' && pathname === '/api/saves') return reply(response, 200, store.list());
      if (method === 'POST' && pathname === '/api/saves') {
        await readJson(request);
        return reply(response, 201, playerView(store.create(title, startEpisode())));
      }

      const match = pathname.match(/^\/api\/saves\/([a-f0-9-]+)(?:\/(turns))?$/);
      if (!match) return reply(response, 404, { message: 'Page not found.' });
      const [, id, action] = match;
      const save = store.get(id);
      if (!save) return reply(response, 404, { message: 'Save not found.' });
      if (method === 'GET' && !action) return reply(response, 200, playerView(save));
      if (method === 'POST' && action === 'turns') {
        const input = await readJson(request);
        if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 4000) {
          return reply(response, 400, { message: 'Enter an action of up to 4,000 characters.' });
        }
        if (input.revision !== save.revision) return reply(response, 409, { message: 'The save has advanced. Open it again.' });
        const result = playFixedTurn(save.state, input.text);
        if (result.clarification) return reply(response, 200, result);
        const committed = store.commit(id, save.revision, result.state);
        if (!committed) return reply(response, 409, { message: 'The save has advanced. Open it again.' });
        return reply(response, 200, playerView(committed));
      }
      return reply(response, 405, { message: 'Action unavailable.' });
    } catch (error) {
      if (!error.status) console.error(error);
      return reply(response, error.status ?? 500, { message: error.status ? error.message : 'The story could not be saved. Try again.' });
    }
  });
  server.once('close', () => store.close());
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.HARBINGER_PORT ?? 4173);
  const server = createHarbinger({ databasePath: process.env.HARBINGER_DATABASE_PATH });
  server.listen(port, '127.0.0.1', () => console.log(`Harbinger · http://127.0.0.1:${server.address().port}`));
}
