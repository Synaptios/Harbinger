import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playerView, startEpisode, title } from './episode.mjs';
import { openStore } from './store.mjs';
import { processTurn } from './turns.mjs';
import { seedThoughts, testingView } from './thoughts.mjs';
import { createModel, providerFromEnvironment } from './model.mjs';
import { createSaveHandler, createSaveQueue, download, maxImportBytes, shareableStory } from './saves.mjs';
import { createCovelBridge } from '../covel/bridge.mjs';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/saves.js': ['saves.js', 'text/javascript; charset=utf-8'],
  '/saves.css': ['saves.css', 'text/css; charset=utf-8'],
  '/journal.css': ['journal.css', 'text/css; charset=utf-8'],
  '/journal.js': ['journal.js', 'text/javascript; charset=utf-8'],
  '/inspector.js': ['inspector.js', 'text/javascript; charset=utf-8'],
  '/inspector.css': ['inspector.css', 'text/css; charset=utf-8'],
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

export function createHarbinger({ databasePath, provider, model, engine = 'legacy' } = {}) {
  const covel = engine === 'covel' ? createCovelBridge({ databasePath: databasePath ?? '.harbinger/covel-story.sqlite', provider }) : null;
  const store = covel ? null : openStore(databasePath ?? resolve('.harbinger/bread-ledger.sqlite'));
  if (!covel && !model && provider) model = createModel(provider);
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
      if (covel) {
        if (method === 'GET' && pathname === '/api/saves') return reply(response, 200, await covel.list());
        if (method === 'POST' && pathname === '/api/saves/import') {
          const bundle = await readJson(request, maxImportBytes);
          return reply(response, 201, await covel.restore(bundle));
        }
        if (method === 'POST' && pathname === '/api/saves') {
          await readJson(request);
          return reply(response, 201, await covel.start());
        }
        const match = pathname.match(/^\/api\/saves\/([a-f0-9-]+)(?:\/(turns|receipt|testing|duplicate|export|story|notes))?$/);
        if (match && method === 'GET' && !match[2]) return reply(response, 200, await covel.read(match[1]));
        if (match?.[2] === 'testing' && method === 'GET') return reply(response, 200, await covel.testing(match[1]));
        if (match?.[2] === 'receipt' && method === 'GET') {
          const committed = await covel.receipt(match[1], searchParams.get('requestId'));
          return reply(response, 200, { committed });
        }
        if (match?.[2] === 'turns' && method === 'POST') {
          const input = await readJson(request);
          const result = await saveQueue.run(match[1], () => covel.turn(match[1], input));
          return reply(response, 200, result);
        }
        if (match?.[2] === 'duplicate' && method === 'POST') {
          await readJson(request);
          const copy = await saveQueue.run('covel-library', () => saveQueue.run(match[1], () => covel.duplicate(match[1])));
          return reply(response, 201, copy);
        }
        if (match?.[2] === 'export' && method === 'GET') {
          const bundle = await covel.capture(match[1]);
          return download(response, 'harbinger-covel-save.json', 'application/json; charset=utf-8', JSON.stringify(bundle));
        }
        if (match?.[2] === 'story' && method === 'GET') {
          return download(response, 'harbinger-story.txt', 'text/plain; charset=utf-8', shareableStory(await covel.read(match[1])));
        }
        if (match?.[2] === 'notes' && method === 'GET') return reply(response, 200, await covel.notes(match[1]));
        if (match?.[2] === 'notes' && method === 'PUT') {
          const { note } = await readJson(request) ?? {};
          if (typeof note !== 'string' || note.length > 4000) {
            return reply(response, 400, { message: 'Enter up to 4,000 characters of notes.' });
          }
          return reply(response, 200, await covel.notes(match[1], { note }));
        }
        return reply(response, 404, { message: 'This action is not available in the Covel opening yet.' });
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
        return reply(response, 201, playerView(store.create(title, seedThoughts(startEpisode()))));
      }

      if (await handleSaveRequest(request, response, pathname)) return;
      const match = pathname.match(/^\/api\/saves\/([a-f0-9-]+)(?:\/(turns|receipt|testing))?$/);
      if (!match) return reply(response, 404, { message: 'Page not found.' });
      const [, id, action] = match;
      const save = store.get(id);
      if (!save) return reply(response, 404, { message: 'Save not found.' });
      if (method === 'GET' && !action) return reply(response, 200, playerView(save));
      if (method === 'GET' && action === 'testing') return reply(response, 200, testingView(save));
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
  server.once('close', () => {
    if (store) store.close();
    if (covel) server.covelClosed = covel.close();
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const engine = process.argv.includes('--covel') ? 'covel' : process.env.HARBINGER_ENGINE;
  const port = Number(process.env.HARBINGER_PORT ?? (engine === 'covel' ? 4174 : 4173));
  const server = createHarbinger({
    databasePath: engine === 'covel' ? process.env.HARBINGER_COVEL_DATABASE_PATH : process.env.HARBINGER_DATABASE_PATH,
    provider: providerFromEnvironment(),
    engine,
  });
  server.listen(port, '127.0.0.1', () => console.log(`Harbinger · http://127.0.0.1:${server.address().port}`));
  if (engine === 'covel') {
    const stop = () => server.close();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}
