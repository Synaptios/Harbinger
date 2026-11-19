import { expect, test } from '@playwright/test';
import { playerView, startEpisode } from '../app/episode.mjs';
import { hydrateStoredStory, readStoredStory, storyChunkNamespace, storyNamespace, writeStoredStory } from '../covel/save-storage.mjs';
import { captureSave, packSave } from '../covel/saves.mjs';
import restore from '../covel/plugins/harbinger/runtimes/restore/handler.js';
import register from '../covel/plugins/harbinger/server/index.js';
import { startApp } from './app-fixture.mjs';

const covelValueLimit = 256 * 1024;
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

function storageFixture() {
  const values = new Map();
  const writes = [];
  const keyFor = (namespace, key) => namespace + '\0' + key;
  const pluginData = {
    get: (namespace, key) => structuredClone(values.get(keyFor(namespace, key)) ?? null),
    list: namespace => [...values].filter(([key]) => key.startsWith(namespace + '\0'))
      .map(([key, value]) => ({ key: key.split('\0')[1], value: structuredClone(value) })),
    set(namespace, key, value) {
      expect(bytes(value), namespace + '/' + key).toBeLessThanOrEqual(covelValueLimit);
      writes.push({ namespace, key });
      if (value === null) values.delete(keyFor(namespace, key));
      else values.set(keyFor(namespace, key), structuredClone(value));
    },
  };
  const store = {
    getPluginData: (namespace, key) => ({ value: pluginData.get(namespace, key) }),
    listPluginData: namespace => pluginData.list(namespace),
  };
  return { pluginData, store, writes };
}

function longStory() {
  const state = startEpisode({ campaign: true });
  state.records = [...state.records, ...Array.from({ length: 580 }, (_, index) =>
    ({ type: 'storage-fixture', minute: 300 + index, detail: ('𝄞\t\n“quotation”\\"' + index).repeat(31) }))];
  state.thoughts = [{ actorId: 'alice', name: 'Alice', presence: 'onstage', text: 'I will write it down.', turn: 0,
    minute: 360, sources: ['Opening scene'] }];
  return { id: 'long-1', name: 'A continued story', revision: 0, memoryIncarnation: 'fixture', state,
    detailUses: { tested: 4 }, recentDetails: [['a detail only the author can see']] };
}

test('private story writes stay below Covel limits and leave unchanged history chunks alone', async () => {
  const { pluginData, writes } = storageFixture();
  const legacy = { id: 'short-1', name: 'A short story', revision: 0, state: startEpisode() };
  await writeStoredStory(pluginData, legacy);
  expect(await readStoredStory(pluginData)).toMatchObject({ head: legacy, save: legacy });
  expect(pluginData.list(storyChunkNamespace)).toEqual([]);

  const save = longStory();
  expect(bytes(save)).toBeGreaterThan(covelValueLimit);
  await writeStoredStory(pluginData, save, await readStoredStory(pluginData));
  const stored = await readStoredStory(pluginData);
  expect(stored.head).toMatchObject({ storage: 'harbinger-chunked-story-v1', id: save.id, revision: save.revision });
  expect(stored.head).not.toHaveProperty('state');
  expect(stored.save).toEqual(save);
  expect(hydrateStoredStory(stored.head, key => pluginData.get(storyChunkNamespace, key))).toEqual(save);

  const next = structuredClone(save);
  next.revision++;
  next.state.records.push({ type: 'append', minute: 500 });
  writes.length = 0;
  await writeStoredStory(pluginData, next, stored);
  expect(writes).toHaveLength(3);
  expect(writes.at(-1)).toEqual({ namespace: storyNamespace, key: 'current' });
  expect((await readStoredStory(pluginData)).save).toEqual(next);
});

test('a portable save larger than one native row restores, exports and opens its inspector losslessly', async () => {
  const save = longStory();
  const bundle = packSave(save, playerView(save).passages.map((passage, sequence) => ({ ...passage, sequence })), 'A private note');
  const { pluginData, store } = storageFixture();
  const restored = await restore({ manualPayload: bundle, pluginData, sessionId: 'restored' });
  expect(restored).toEqual({ outcome: 'success', value: { restored: true } });
  const { passages, ...view } = playerView({ ...save, id: 'restored' });
  expect(pluginData.get('story', 'view')).toEqual(view);
  const exported = await captureSave({ store });
  expect(exported).toEqual({ ok: true, data: bundle });

  const actions = new Map();
  register({ registerRpc: (name, execute) => actions.set(name, execute) });
  expect(await actions.get('testing-view')({}, { store })).toMatchObject({
    ok: true, data: { revision: 0, thoughts: save.state.thoughts },
  });
});

test('a native oversized save survives restart and the next action commits exactly once', async ({ request }) => {
  test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the native storage fixture with HARBINGER_TEST_COVEL=1.');
  test.slow();
  const save = longStory();
  const bundle = packSave(save, playerView(save).passages.map((passage, sequence) => ({ ...passage, sequence })));
  // This route needs no provider to restore a passage or look around.
  const app = await startApp({ engine: 'covel', provider: { url: 'http://127.0.0.1:1/v1/responses', name: 'fixture' } });
  try {
    const restored = await request.post(app.url + '/api/saves/import', { data: bundle });
    expect(restored.status(), await restored.text()).toBe(201);
    const { id } = await restored.json();
    await app.restart();
    const endpoint = app.url + '/api/saves/' + id;
    const data = { text: 'Look around', revision: 0, requestId: 'native-partition-1' };
    const first = await request.post(endpoint + '/turns', { data });
    expect(first.status(), await first.text()).toBe(200);
    expect(await first.json()).toMatchObject({ revision: 1 });
    const replay = await request.post(endpoint + '/turns', { data });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const exported = await (await request.get(endpoint + '/export')).json();
    expect(exported.revision).toBe(1);
    expect(exported.passages).toHaveLength(2);
    expect(exported.state.records.slice(0, save.state.records.length)).toEqual(save.state.records);
  } finally {
    await app.close();
  }
});
