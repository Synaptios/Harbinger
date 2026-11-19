import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { nextCopyName } from '../app/saves.mjs';
import { clarificationPrefix } from '../app/turns.mjs';
import { validCovelSave } from './saves.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const checkout = join(project, '.harbinger', 'covel');
const node = join(project, '.harbinger', 'toolchain', 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');

function launchCovel(databasePath, provider) {
  if (!existsSync(node) || !existsSync(join(checkout, 'node_modules', 'tsx', 'dist', 'loader.mjs'))) {
    throw new Error('Run npm run covel:setup before starting Harbinger on Covel.');
  }
  if (!provider?.url || !provider?.name) throw new Error('Set HARBINGER_MODEL_URL and HARBINGER_MODEL_NAME.');
  const loader = pathToFileURL(join(checkout, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  return fork(join(checkout, 'apps', 'server', 'src', 'index.ts'), [], {
    cwd: checkout,
    execPath: node,
    execArgv: ['--import', loader],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STORE_BACKEND: 'sqlite',
      SQLITE_PATH: resolve(databasePath),
      SERVER_PORT: '0',
      COVEL_BIND_HOST: '127.0.0.1',
      COVEL_HOME: join(dirname(resolve(databasePath)), 'covel-home'),
      COVEL_PLUGINS_DIR: join(project, 'covel', 'plugins'),
      COVEL_WORLDS_DIR: join(project, 'covel', 'worlds'),
      HARBINGER_MODEL_URL: provider.url,
      HARBINGER_MODEL_NAME: provider.name,
      HARBINGER_MODEL_KEY: provider.key ?? '',
      HARBINGER_REASONING_EFFORT: provider.reasoningEffort ?? '',
    },
  });
}

function failure(message, status) {
  return Object.assign(new Error(message), { status });
}

function inputId(sessionId, requestId) {
  return createHash('sha256').update(sessionId + '\0' + requestId).digest('hex');
}

export function createCovelBridge({ databasePath, provider }) {
  const child = launchCovel(databasePath, provider);
  const closed = new Promise(resolve => child.once('exit', resolve));
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(failure('The Covel runtime stopped.', 503)));
    child.on('message', message => {
      if (message?.type === 'covel:ready') resolve(`http://127.0.0.1:${message.port}`);
    });
  });
  // Preserve the startup failure for the first request even if it arrives later.
  ready.catch(() => {});

  async function call(path, data) {
    const request = data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    };
    const response = await fetch(await ready + path, request);
    if (!response.ok) throw failure(response.status === 404 ? 'Save not found.' : 'Covel could not finish the action.', response.status);
    return response;
  }

  async function runAction(sessionId, type, requestId, payload = {}) {
    const response = await call('/api/actions', { sessionId, type, requestId, payload });
    const events = (await response.text()).split(/\r?\n/u).filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)));
    if (!events.findLast(event => event.type === 'execution.completed')?.payload?.committed) {
      const storyFailure = events.findLast(event => event.type === 'runtime.failed' && event.payload?.runtimeId === 'harbinger/story');
      const message = storyFailure?.payload.error;
      if (typeof message === 'string' && message.startsWith(clarificationPrefix)) {
        return message.slice(clarificationPrefix.length);
      }
      throw failure('The story could not finish this passage. Try again.', 502);
    }
  }

  async function pluginItems(id) {
    const response = await call(`/api/sessions/${id}/plugin-data/harbinger`);
    return (await response.json()).items;
  }

  async function read(id) {
    const items = await pluginItems(id);
    const view = items.find(item => item.namespace === 'story' && item.key === 'view')?.value;
    if (!view) throw failure('Save not found.', 404);
    const passages = items.filter(item => item.namespace === 'passages')
      .map(item => item.value).sort((a, b) => a.sequence - b.sequence);
    return { ...view, passages };
  }

  async function readCommittedInput(id, messageId) {
    const response = await call(`/api/sessions/${id}/messages`);
    const { items } = await response.json();
    const message = items.find(item => item.id === messageId && item.role === 'user');
    if (message && items.some(item => item.kind === 'story' && item.turnId === message.turnId)) return message;
  }

  async function newSession() {
    const id = randomUUID();
    await call('/api/sessions', { id, worldId: 'bread-ledger', locale: 'en-US', plugins: ['harbinger'] });
    return id;
  }

  async function list() {
    const { items } = await (await call('/api/sessions?worldId=bread-ledger')).json();
    const saves = await Promise.all(items.map(async ({ id, updatedAt }) => {
      try {
        const record = await call(`/api/sessions/${id}/plugin-data/harbinger/story/view`);
        const { name, revision } = (await record.json()).value;
        return { id, name, revision, updated_at: updatedAt };
      } catch (error) {
        if (error.status !== 404) throw error;
        return null;
      }
    }));
    return saves.filter(Boolean);
  }

  async function invoke(id, action, payload) {
    const response = await call(`/api/sessions/${id}/plugin-rpc`, { kind: 'action', pluginId: 'harbinger', action, payload });
    const { result } = await response.json();
    if (!result?.ok) throw failure(result?.message ?? 'Save not found.', 404);
    return result.data;
  }

  const capture = id => invoke(id, 'capture-save');

  async function restore(bundle) {
    if (!validCovelSave(bundle)) throw failure('Choose a valid Harbinger complete save for Covel.', 400);
    const id = await newSession();
    await call(`/api/sessions/${id}/plugin-rpc`, {
      kind: 'runtime', pluginId: 'harbinger', runtimeId: 'harbinger/restore', payload: bundle,
    });
    return read(id);
  }

  return {
    read,
    list,
    capture,
    restore,
    notes: (id, input) => invoke(id, 'journal-note', input),
    async duplicate(id) {
      const bundle = await capture(id);
      const name = nextCopyName(bundle.name, new Set((await list()).map(save => save.name)));
      return restore({ ...bundle, name });
    },
    testing: id => invoke(id, 'testing-view'),
    async receipt(id, requestId) {
      if (!requestId || requestId.length > 128) return false;
      return Boolean(await readCommittedInput(id, inputId(id, requestId)));
    },
    async start() {
      const id = await newSession();
      await runAction(id, 'start_session', randomUUID());
      return read(id);
    },
    async turn(id, { text, revision, requestId } = {}) {
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) {
        throw failure('Enter an action of up to 4,000 characters.', 400);
      }
      if (typeof requestId !== 'string' || !requestId || requestId.length > 128) {
        throw failure('This turn needs a valid request ID.', 400);
      }
      const actionText = text.trim();
      const save = await read(id);
      const messageId = inputId(id, requestId);
      const committed = await readCommittedInput(id, messageId);
      if (committed) {
        if (committed.content !== actionText || revision >= save.revision) {
          throw failure('That request ID belongs to a different turn.', 409);
        }
        return save;
      }
      if (save.revision !== revision) throw failure('The save has advanced. Open it again.', 409);
      const status = await (await call(`/api/sessions/${id}/execution`)).json();
      if (status.state === 'running') throw failure('The previous turn is still running.', 409);
      const retry = status.retry;
      const recovering = ['failed', 'interrupted'].includes(status.state)
        && retry?.type === 'submit_actions' && retry.payload.inputMessageId === messageId;
      if (recovering && retry.payload.actions[0]?.text !== actionText) {
        throw failure('That request ID belongs to a different turn.', 409);
      }
      try {
        const clarification = await runAction(id, 'submit_actions', randomUUID(), {
          ...(recovering ? retry.payload : { actions: [{ kind: 'say', text: actionText }], inputMessageId: messageId }),
          ...(recovering && { recoverFromTurnId: status.turnId }),
        });
        if (clarification) return { clarification };
      } catch (error) {
        if (!await readCommittedInput(id, messageId).catch(() => false)) throw error;
      }
      return read(id);
    },
    async close() {
      if (child.exitCode === null) child.kill();
      await closed;
    },
  };
}
