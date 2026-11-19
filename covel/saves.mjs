import { playerView } from '../app/episode.mjs';
import { visibleObservations } from '../app/knowledge.mjs';
import { safeKeys, validState } from '../app/saves.mjs';
import { readCommittedStory, storyNamespace, writeStoredStory } from './save-storage.mjs';

const format = 'harbinger-covel-save';
const version = 1;
const publicStory = 'story';
const viewKey = 'view';
const passageNamespace = 'passages';
const noteKey = 'note';

function orderedPassages(rows, revision = Infinity) {
  return rows.map(row => row.value).filter(passage => passage.sequence <= revision)
    .sort((a, b) => a.sequence - b.sequence);
}

export async function readPublishedPassages(pluginData) {
  return orderedPassages(await pluginData.list(passageNamespace));
}

export function publishedStoryView(rows) {
  const view = rows.find(row => row.namespace === publicStory && row.key === viewKey)?.value;
  if (!view) return;
  return {
    ...view,
    passages: orderedPassages(rows.filter(row => row.namespace === passageNamespace), view.revision),
  };
}

// Covel commits these buffered writes together as part of the enclosing runtime.
async function publishStory(pluginData, { save, view, passages, previous, note }) {
  await writeStoredStory(pluginData, save, previous);
  if (note !== undefined) await pluginData.set(storyNamespace, noteKey, note);
  await pluginData.set(publicStory, viewKey, view);
  for (const { id, heading, location, time, playerText, paragraphs, sequence } of passages) {
    await pluginData.set(passageNamespace, id, { id, heading, location, time, playerText, paragraphs, sequence });
  }
}

export async function publishStoryTurn(pluginData, { save, previous, composed, playerText }) {
  const { view, finalPassage, paragraphs, passageIds } = composed;
  if (!finalPassage) throw new Error('A resolved story turn needs a passage to publish.');
  const rendered = { ...finalPassage, playerText, paragraphs, sequence: save.revision };
  // A compound turn renders as one passage. Keep each discovery linked to it.
  const linkPassage = observation => passageIds.has(observation.passageId)
    ? { ...observation, passageId: rendered.id } : observation;
  save.state.observations = save.state.observations.map(linkPassage);
  const publicView = { ...view, observations: view.observations.map(linkPassage) };
  await publishStory(pluginData, { save, view: publicView, passages: [rendered], previous });
}

export function packSave(save, passages, note = '') {
  const { name, revision, state } = save;
  return { format, version, name, revision, state, passages, note };
}

function validKnowledgeHistory({ records, facts, passages, minute }) {
  const knownFacts = new Set(facts.map(fact => fact.id));
  const knownPassages = new Set(passages.map(passage => passage.id));
  return records.every(record => {
    if (record.type !== 'fact-access' && record.type !== 'fact-report') return true;
    return knownFacts.has(record.factId) && knownPassages.has(record.passageId)
      && Number.isSafeInteger(record.minute) && record.minute >= 0 && record.minute <= minute
      && Array.isArray(record.recipients) && record.recipients.length > 0
      && record.recipients.every(actorId => typeof actorId === 'string' && actorId.length > 0)
      && (record.type !== 'fact-access' || typeof record.source === 'string');
  });
}

export function validCovelSave(bundle) {
  if (bundle?.format !== format || bundle.version !== version || !safeKeys(bundle)
    || typeof bundle.name !== 'string' || !bundle.name.trim() || bundle.name.length > 160
    || !validNote(bundle.note)
    || !Number.isSafeInteger(bundle.revision) || bundle.revision < 0
    || !validState(bundle.state, bundle.revision)
    || !validKnowledgeHistory(bundle.state)
    || !Array.isArray(bundle.passages) || bundle.passages.length !== bundle.revision + 1) return false;

  const staged = new Map(bundle.state.passages.map(passage => [passage.id, passage]));
  const rendered = new Set();
  for (const [index, passage] of bundle.passages.entries()) {
    const source = staged.get(passage?.id);
    if (!source || rendered.has(passage.id) || passage.sequence !== index
      || !['heading', 'location', 'time'].every(field => passage[field] === source[field])
      || !(passage.playerText === null || typeof passage.playerText === 'string')
      || !Array.isArray(passage.paragraphs) || !passage.paragraphs.length
      || passage.paragraphs.some(paragraph => typeof paragraph !== 'string' || paragraph.length > 4000)) return false;
    rendered.add(passage.id);
  }
  return visibleObservations(bundle.state, 'player').every(observation => rendered.has(observation.passageId));
}

export async function restoreSave(pluginData, sessionId, bundle) {
  if (!validCovelSave(bundle) || await pluginData.get(storyNamespace, 'current')) return false;
  const { name, revision, state, passages, note } = bundle;
  // This session will obtain its own memory incarnation on its next turn.
  const save = { id: sessionId, name: name.trim(), revision, state };
  const view = playerView(save);
  delete view.passages;
  await publishStory(pluginData, { save, view, passages, note });
  return true;
}

function validNote(note) {
  return typeof note === 'string' && note.length <= 4000;
}

async function readNote(store) {
  const record = await store.getPluginData(storyNamespace, noteKey);
  return record?.value ?? '';
}

export async function saveNote(store, payload) {
  if (!(await store.getPluginData(storyNamespace, 'current'))) return { ok: false, message: 'Save not found.' };
  if (!Object.hasOwn(payload ?? {}, 'note')) return { ok: true, data: { note: await readNote(store) } };
  const { note } = payload;
  if (!validNote(note)) return { ok: false, message: 'Enter up to 4,000 characters of notes.' };
  await store.setPluginData({ namespace: storyNamespace, key: noteKey, value: note });
  return { ok: true, data: { note } };
}

export async function captureSave(ctx) {
  const save = await readCommittedStory(ctx.store);
  if (!save) return { ok: false, message: 'Save not found.' };
  const passages = orderedPassages(await ctx.store.listPluginData(passageNamespace), save.revision);
  return { ok: true, data: packSave(save, passages, await readNote(ctx.store)) };
}
