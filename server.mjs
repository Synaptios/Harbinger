import { createServer } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GameError, createGame, playTurn, publicGame } from './engine.mjs';
import { makeProviders } from './providers.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/harbor.webp', ['harbor.webp', 'image/webp']],
]);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const activeTurns = new Set();

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  if (request.headers['content-type']?.split(';', 1)[0].trim() !== 'application/json') {
    throw new GameError('invalid_request', 'Send a JSON request.', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 8192) chunks.push(chunk);
  }
  if (size > 8192) throw new GameError('invalid_request', 'Request is too long.', 413);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new GameError('invalid_request', 'Send a JSON object.');
  }
}

async function saveGame(dataDir, game) {
  const path = join(dataDir, `${game.id}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(game), { flag: 'wx', mode: 0o600, flush: true });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function loadGame(dataDir, id) {
  try {
    return JSON.parse(await readFile(join(dataDir, `${id}.json`), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new GameError('not_found', 'This save could not be found.', 404);
    throw error;
  }
}

function actionRequest(body, catalog) {
  const { model, revision, requestId } = body;
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action || action.length > 1500 || !Number.isSafeInteger(revision) || revision < 0
    || typeof requestId !== 'string' || !uuid.test(requestId)) {
    throw new GameError('invalid_request', 'Enter an action up to 1,500 characters and retry.');
  }
  const selected = catalog.models.find(({ id }) => id === model);
  if (!selected) throw new GameError('invalid_model', 'Choose a narrator from the list.');
  return { action, model, revision, requestId, available: selected.available };
}

export async function makeServer({
  dataDir = process.env.BELLWETHER_DATA_DIR || join(here, 'data'), providers = makeProviders(),
} = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      const method = request.method;
      if ((method === 'GET' || method === 'HEAD') && files.has(path)) {
        const [filename, type] = files.get(path);
        let data;
        try {
          data = await readFile(join(here, 'public', filename));
        } catch (error) {
          if (error.code === 'ENOENT') throw new GameError('not_found', 'Page asset not found.', 404);
          throw error;
        }
        response.writeHead(200, {
          'Content-Type': type, 'Content-Length': data.length,
          'Cache-Control': path === '/harbor.webp' ? 'public, max-age=3600' : 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(method === 'HEAD' ? undefined : data);
        return;
      }
      if (method === 'GET' && path === '/api/models') {
        json(response, 200, providers.catalog());
        return;
      }
      if (method === 'POST' && request.headers.origin) {
        if (URL.parse(request.headers.origin)?.host !== request.headers.host) {
          throw new GameError('forbidden', 'Open the game on the same address as its API.', 403);
        }
      }
      if (method === 'POST' && path === '/api/games') {
        await readBody(request);
        const game = createGame();
        await saveGame(dataDir, game);
        json(response, 201, { game: publicGame(game) });
        return;
      }
      const match = path.match(/^\/api\/games\/([^/]+)(\/turns)?$/);
      if (match && uuid.test(match[1])) {
        const [, id, turns] = match;
        if (method === 'GET' && !turns) {
          json(response, 200, { game: publicGame(await loadGame(dataDir, id)) });
          return;
        }
        if (method === 'POST' && turns) {
          const input = actionRequest(await readBody(request), providers.catalog());
          const lock = join(dataDir, id);
          if (activeTurns.has(lock)) throw new GameError('busy', 'Another action is still resolving.', 409);
          activeTurns.add(lock);
          try {
            const game = await loadGame(dataDir, id);
            const prior = game.turns.find((turn) => turn.requestId === input.requestId);
            if (prior) {
              if (prior.action !== input.action || prior.model !== input.model) {
                throw new GameError('revision_conflict', 'This action ID has already been used.', 409);
              }
              json(response, 200, { game: publicGame(game) });
              return;
            }
            if (game.revision !== input.revision) {
              throw new GameError('revision_conflict', 'The save advanced in another tab. Reloaded the latest turn.', 409);
            }
            if (!input.available) {
              throw new GameError('model_unavailable', 'This narrator requires its provider key on the server.', 503);
            }
            const updated = await playTurn(game, input, providers);
            await saveGame(dataDir, updated);
            json(response, 200, { game: publicGame(updated) });
          } finally {
            activeTurns.delete(lock);
          }
          return;
        }
      }
      throw new GameError('not_found', 'That page could not be found.', 404);
    } catch (error) {
      if (Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 && error.code) {
        json(response, error.status, { error: error.message, code: error.code });
      } else {
        console.error('Unexpected game server error:', error.name, error.code ?? '');
        json(response, 500, { error: 'The game could not finish that request.', code: 'server_error' });
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT ? Number(process.env.PORT) : 4173;
  const server = await makeServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Bellwether is ready at http://127.0.0.1:${server.address().port}`);
  });
}
