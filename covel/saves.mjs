import { playerView } from '../app/episode.mjs';
import { safeKeys, validState } from '../app/saves.mjs';
import { readCommittedStory, storyNamespace } from './save-storage.mjs';

const format = 'harbinger-covel-save';
const version = 1;

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
    || typeof bundle.note !== 'string' || bundle.note.length > 4000
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
  return playerView({ ...bundle, id: '' }).observations.every(observation => rendered.has(observation.passageId));
}

export async function captureSave(ctx) {
  const save = await readCommittedStory(ctx.store);
  if (!save) return { ok: false, message: 'Save not found.' };
  const passages = (await ctx.store.listPluginData('passages')).map(row => row.value)
    .filter(passage => passage.sequence <= save.revision).sort((a, b) => a.sequence - b.sequence);
  const note = (await ctx.store.getPluginData(storyNamespace, 'note'))?.value;
  return { ok: true, data: packSave(save, passages, note ?? '') };
}
