import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playerView, startEpisode, title } from './episode.mjs';
import { openStore } from './store.mjs';
import { processTurn } from './turns.mjs';
import { createModel, providerFromEnvironment } from './model.mjs';
import { createSaveHandler, createSaveQueue } from './saves.mjs';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/saves.js': ['saves.js', 'text/javascript; charset=utf-8'],
  '/saves.css': ['saves.css', 'text/css; charset=utf-8'],
  '/journal.css': ['journal.css', 'text/css; charset=utf-8'],
  '/journal.js': ['journal.js', 'text/javascript; charset=utf-8'],
};

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request, maxBytes = 1024 * 1024) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Send JSON to this endpoint.'), { status: 415 });
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('This request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('This request contains invalid JSON.'), { status: 400 });
  }
}

export function createHarbinger({ databasePath = resolve('.harbinger/bread-ledger.sqlite'), provider, model = provider && createModel(provider) } = {}) {
  const store = openStore(databasePath);
  const saveQueue = createSaveQueue();
  const handleSaveRequest = createSaveHandler({ store, saveQueue, reply, readJson });
  const server = createServer(async (request, response) => {
    try {
      const { pathname, searchParams } = new URL(request.url, 'http://localhost');
      const { method } = request;
      if (method === 'GET' && Object.hasOwn(assets, pathname)) {
        const [path, type] = assets[pathname];
        const data = await readFile(new URL('../public/' + path, import.meta.url));
        response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
        return response.end(data);
      }
      const noteId = pathname.match(/^\/api\/saves\/([a-f0-9-]+)\/notes$/)?.[1];
      if (noteId) {
        if (!store.get(noteId)) return reply(response, 404, { message: 'Save not found.' });
        if (method === 'GET') return reply(response, 200, { note: store.getNote(noteId) });
        if (method !== 'PUT') return reply(response, 405, { message: 'Action unavailable.' });
        const { note } = await readJson(request) ?? {};
        if (typeof note !== 'string' || note.length > 4000) {
          return reply(response, 400, { message: 'Enter up to 4,000 characters of notes.' });
        }
        store.setNote(noteId, note);
        return reply(response, 200, { note });
      }
      if (method === 'GET' && pathname === '/api/saves') return reply(response, 200, store.list());
      if (method === 'POST' && pathname === '/api/saves') {
        await readJson(request);
        return reply(response, 201, playerView(store.create(title, startEpisode())));
      }

      if (await handleSaveRequest(request, response, pathname)) return;
      const match = pathname.match(/^\/api\/saves\/([a-f0-9-]+)(?:\/(turns|receipt))?$/);
      if (!match) return reply(response, 404, { message: 'Page not found.' });
      const [, id, action] = match;
      const save = store.get(id);
      if (!save) return reply(response, 404, { message: 'Save not found.' });
      if (method === 'GET' && !action) return reply(response, 200, playerView(save));
      if (method === 'GET' && action === 'receipt') {
        const requestId = searchParams.get('requestId');
        const committed = requestId?.length <= 128 && Boolean(store.receipt(id, requestId));
        return reply(response, 200, { committed: Boolean(committed) });
      }
      if (method === 'POST' && action === 'turns') {
        const input = await readJson(request);
        const result = await saveQueue.run(id, () => processTurn(store, id, input, model));
        return reply(response, result.status, result.body);
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
  const server = createHarbinger({ databasePath: process.env.HARBINGER_DATABASE_PATH, provider: providerFromEnvironment() });
  server.listen(port, '127.0.0.1', () => console.log(`Harbinger · http://127.0.0.1:${server.address().port}`));
}
