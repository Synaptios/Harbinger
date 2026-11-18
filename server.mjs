import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMemory, openMemoryStore } from './build-memory.mjs';
import { asText, chat, StageError } from './chat.mjs';
import { createRanker } from './memory.mjs';
import { stages } from './stages.mjs';

const root = import.meta.url;
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function parseBody(request) {
  if (request.headers['content-type']?.split(';', 1)[0].trim() !== 'application/json') {
    throw new RequestError(415, 'Send an application/json request.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes <= 384_000) chunks.push(chunk);
  }
  if (bytes > 384_000) throw new RequestError(413, 'The request is too large.');
  try {
    const body = JSON.parse(Buffer.concat(chunks));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new RequestError(400, 'Send a valid JSON object.');
  }
}

async function loadStory() {
  return JSON.parse(await readFile(new URL('./story/ortuzar-first-contact.json', root), 'utf8'));
}

function counts({ episodes, facts, patterns }) {
  return { episodes: episodes.length, facts: facts.length, patterns: patterns.length };
}

export async function createServer({ story, providers, storageDirectory = fileURLToPath(new URL('./app-state/', root)) } = {}) {
  story ??= await loadStory();
  providers ??= await (await import('./providers.mjs')).createProviders({ credentialFile: new URL('./.credentials', root) });
  const characters = new Map(story.characters.map((character) => [character.id, character]));
  const events = new Map(story.events.map((event, index) => [event.id, index]));
  const store = await openMemoryStore(story, storageDirectory);
  const building = new Set();
  const rank = createRanker(providers);

  return httpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const controller = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    const { signal } = controller;
    try {
      const origin = request.headers.origin;
      const host = request.headers.host;
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host ?? '') || (origin && origin !== 'http://' + host)) {
        throw new RequestError(403, 'Open Harbinger from its local address.');
      }
      const { pathname } = new URL(request.url, 'http://localhost');
      const { method } = request;
      if ((method === 'GET' || method === 'HEAD') && files.has(pathname)) {
        const [filename, contentType] = files.get(pathname);
        const contents = await readFile(new URL('./public/' + filename, root));
        response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'Content-Length': contents.length });
        response.end(method === 'HEAD' ? undefined : contents);
      } else if (method === 'GET' && pathname === '/api/bootstrap') {
        json(response, 200, { story, stages, memory: Object.fromEntries([...store.entries].map(([id, memory]) => [id, counts(memory)])) });
      } else if (method === 'GET' && pathname === '/api/models') {
        json(response, 200, await providers.catalog({ signal }));
      } else if (method === 'POST' && pathname === '/api/chat') {
        const body = await parseBody(request);
        const character = characters.get(body.characterId);
        const index = events.get(body.eventId);
        if (!character || index === undefined || !asText(body.message, 1) || body.message.length > 6_000) {
          throw new RequestError(400, 'Choose a character and scene and enter a message up to 6,000 characters.');
        }
        json(response, 200, await chat({ character, eventId: body.eventId, index, memory: store.entries.get(character.id), body, providers, rank, signal }));
      } else if (method === 'POST' && pathname === '/api/memory/build') {
        const body = await parseBody(request);
        const character = characters.get(body.characterId);
        if (!character) throw new RequestError(400, 'Choose a character before building memory.');
        if (building.has(character.id)) throw new RequestError(409, 'Memory is already building for this character.');
        building.add(character.id);
        try {
          const memory = await buildMemory({ story, character, settings: body.settings, providers, signal });
          signal.throwIfAborted();
          if (!memory.facts.length && !memory.episodes.length) {
            throw new RequestError(422, 'The build found no supported memories. Check the character, source, and stage settings.');
          }
          await store.save(character.id, memory);
          json(response, 200, { memory: counts(memory) });
        } finally {
          building.delete(character.id);
        }
      } else if (method === 'GET' && pathname === '/favicon.ico') {
        response.writeHead(204).end();
      } else {
        throw new RequestError(404, 'Page not found.');
      }
    } catch (error) {
      if (response.destroyed) return;
      controller.abort();
      if (error instanceof RequestError) json(response, error.status, { error: error.message });
      else if (error instanceof StageError) json(response, 502, { error: error.message, stage: error.stage });
      else {
        console.error('Harbinger request failed:', error.name, error.code ?? '');
        json(response, 500, { error: 'Harbinger could not finish this request.' });
      }
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173);
  const server = await createServer();
  server.listen(port, '127.0.0.1', () => console.log('Harbinger is ready at http://127.0.0.1:' + server.address().port));
}
