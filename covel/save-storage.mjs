import { createHash } from 'node:crypto';

export const storyNamespace = '_hidden.story';
export const storyChunkNamespace = '_hidden.story-chunks';
const markerFormat = 'harbinger-chunked-story-v1';
const partitionAtBytes = 240 * 1024;
// Even an escaped JSON string uses at most six bytes per UTF-16 code unit.
// Leave room below Covel's 256 KiB limit, including the enclosing quotes.
const unitsPerChunk = 32 * 1024;

function isPartitioned(value) {
  return value?.storage === markerFormat;
}

function chunkPrefix(section) {
  if (section === null) return 'metadata';
  return 'state-' + createHash('sha256').update(section).digest('hex');
}

function readSection(section, count, readChunk) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid private story partition index.');
  const prefix = chunkPrefix(section);
  const pieces = [];
  for (let i = 0; i < count; i += 1) {
    const chunk = readChunk(prefix + '-' + i);
    if (typeof chunk !== 'string') throw new Error('A committed private story chunk is missing.');
    pieces.push(chunk);
  }
  return JSON.parse(pieces.join(''));
}

export function hydrateStoredStory(current, readChunk) {
  if (!isPartitioned(current)) return current;
  const metadata = readSection(null, current.metadataParts, readChunk);
  const state = Object.fromEntries(current.sections.map(([section, count]) =>
    [section, readSection(section, count, readChunk)]));
  return { ...metadata, state };
}

function addChunks(chunks, section, serialized) {
  const prefix = chunkPrefix(section);
  let count = 0;
  for (let i = 0; i < serialized.length; i += unitsPerChunk) {
    chunks.set(prefix + '-' + count++, serialized.slice(i, i + unitsPerChunk));
  }
  return count;
}

function partition(save) {
  const { state, ...metadata } = save;
  const chunks = new Map();
  const metadataParts = addChunks(chunks, null, JSON.stringify(metadata));
  const sections = [];
  for (const [section, value] of Object.entries(state)) {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) sections.push([section, addChunks(chunks, section, serialized)]);
  }
  const { id, name, revision, memoryIncarnation } = save;
  const head = {
    storage: markerFormat, id, name, revision, metadataParts, sections,
    ...(memoryIncarnation !== undefined && { memoryIncarnation }),
  };
  return { head, chunks };
}

export async function readStoredStory(pluginData) {
  const head = await pluginData.get(storyNamespace, 'current');
  const chunks = new Map(isPartitioned(head)
    ? (await pluginData.list(storyChunkNamespace)).map(row => [row.key, row.value]) : []);
  return { head, chunks, save: hydrateStoredStory(head, key => chunks.get(key)) };
}

export async function readCommittedStory(store) {
  const current = async () => (await store.getPluginData(storyNamespace, 'current'))?.value;
  // RPCs can run while a turn commits. Read the marker on both sides of the
  // chunk list so another revision cannot be mistaken for this snapshot.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await current();
    if (!isPartitioned(head)) return head;
    const chunks = new Map((await store.listPluginData(storyChunkNamespace)).map(row => [row.key, row.value]));
    if ((await current())?.revision === head.revision) return hydrateStoredStory(head, key => chunks.get(key));
  }
  throw new Error('The private story changed while it was being read.');
}

export async function writeStoredStory(pluginData, save, previous) {
  if (!isPartitioned(previous?.head) && Buffer.byteLength(JSON.stringify(save), 'utf8') <= partitionAtBytes) {
    await pluginData.set(storyNamespace, 'current', save);
    return;
  }
  const { head, chunks } = partition(save);
  // Function-runtime writes are buffered together with the rest of the turn.
  for (const [key, value] of chunks) {
    if (previous?.chunks.get(key) !== value) await pluginData.set(storyChunkNamespace, key, value);
  }
  for (const key of previous?.chunks.keys() ?? []) {
    if (!chunks.has(key)) await pluginData.set(storyChunkNamespace, key, null);
  }
  await pluginData.set(storyNamespace, 'current', head);
}
