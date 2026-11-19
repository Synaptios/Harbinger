import { playerView, worldVersion } from './episode.mjs';

const saveFormat = 'harbinger-complete-save';
const saveFormatVersion = 1;
export const maxImportBytes = 16 * 1024 * 1024;

export function download(response, name, mediaType, content) {
  response.writeHead(200, {
    'Content-Type': mediaType,
    'Content-Disposition': 'attachment; filename="' + name + '"',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
}

function stringFields(record, fields) {
  return record !== null && typeof record === 'object' && !Array.isArray(record) &&
    fields.every(key => typeof record[key] === 'string');
}

function rows(list, predicate) {
  return Array.isArray(list) && list.every(predicate);
}

function strings(list) {
  return rows(list, item => typeof item === 'string');
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validInspectorMetadata(state) {
  return (state.thoughts === undefined || rows(state.thoughts, thought =>
    stringFields(thought, ['actorId', 'name', 'presence', 'text']) &&
    ['onstage', 'offstage'].includes(thought.presence) &&
    nonnegativeInteger(thought.turn) && nonnegativeInteger(thought.minute) && strings(thought.sources))) &&
    (state.directorTrace === undefined || rows(state.directorTrace, direction =>
      stringFields(direction, ['id', 'situationId', 'situation', 'eventId', 'actorId', 'locationId', 'reason']) &&
      nonnegativeInteger(direction.minute) &&
      (direction.focus === undefined || ['evidence', 'cost'].includes(direction.focus)) &&
      (direction.turn === undefined || nonnegativeInteger(direction.turn))));
}

export function safeKeys(value, depth = 0) {
  if (depth > 32) return false;
  if (value === null || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, child]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) && safeKeys(child, depth + 1));
}

export function validState(state, revision) {
  if (!stringFields(state, ['worldVersion', 'scene']) || state.worldVersion !== worldVersion ||
      !Number.isSafeInteger(state.minute) || state.minute < 0 ||
      !rows(state.passages, passage => stringFields(passage, ['id', 'heading', 'location', 'time']) &&
        strings(passage.paragraphs) && (passage.playerText === null || typeof passage.playerText === 'string')) ||
      !state.passages.length ||
      !rows(state.observations, record => stringFields(record, ['id', 'passageId', 'kind', 'title', 'text', 'source', 'status']) &&
        strings(record.recipients)) ||
      !rows(state.facts, record => stringFields(record, ['id', 'text', 'source']) && strings(record.recipients)) ||
      !rows(state.pending, record => stringFields(record, ['type']) && Number.isSafeInteger(record.minute)) ||
      !rows(state.records, record => stringFields(record, ['type'])) ||
      !validInspectorMetadata(state)) return false;

  const passageIds = new Set(state.passages.map(passage => passage.id));
  if (passageIds.size !== state.passages.length ||
      !state.observations.every(record => passageIds.has(record.passageId))) return false;
  try {
    const view = playerView({ id: '', name: '', revision, state });
    return stringFields(view.scene, ['id', 'heading', 'location', 'time']) && strings(view.choices);
  } catch {
    return false;
  }
}

function validBundle(bundle) {
  return stringFields(bundle, ['format', 'name', 'note']) &&
    bundle.format === saveFormat && bundle.version === saveFormatVersion &&
    bundle.name.trim().length > 0 && bundle.name.length <= 160 && bundle.note.length <= 4000 &&
    Number.isSafeInteger(bundle.revision) && bundle.revision >= 0 &&
    safeKeys(bundle) && validState(bundle.state, bundle.revision);
}

export function createSaveQueue() {
  const active = new Map();
  return {
    run(id, operation) {
      const result = (active.get(id) ?? Promise.resolve()).then(operation);
      const tail = result.then(() => undefined, () => undefined);
      active.set(id, tail);
      return result.finally(() => {
        if (active.get(id) === tail) active.delete(id);
      });
    },
  };
}

export function nextCopyName(name, names) {
  const baseName = name.replace(/ \(copy(?: \d+)?\)$/u, '').slice(0, 140);
  let copy = baseName + ' (copy)';
  for (let number = 2; names.has(copy); number++) copy = baseName + ' (copy ' + number + ')';
  return copy;
}

function makeCopy(store, save) {
  const name = nextCopyName(save.name, new Set(store.list().map(entry => entry.name)));
  return store.create(name, save.state, save.revision, store.getNote?.(save.id));
}

export function shareableStory({ title, passages }) {
  const sections = passages.map(({ heading, location, time, playerText, paragraphs }) =>
    [heading, location + ' / ' + time, playerText, ...paragraphs].filter(Boolean).join('\n\n'));
  return [title, ...sections].join('\n\n') + '\n';
}

export function createSaveHandler({ store, saveQueue, reply, readJson }) {
  return async (request, response, pathname) => {
    if (pathname === '/api/saves/import' && request.method === 'POST') {
      const bundle = await readJson(request, maxImportBytes);
      if (!validBundle(bundle)) {
        reply(response, 400, { message: 'Choose a valid Harbinger complete save for this edition.' });
        return true;
      }
      const save = store.create(bundle.name.trim(), bundle.state, bundle.revision, bundle.note);
      reply(response, 201, playerView(save));
      return true;
    }

    const match = pathname.match(/^\/api\/saves\/([a-f0-9-]+)\/(duplicate|export|story)$/);
    if (!match) return false;
    const [, id, action] = match;
    if (request.method !== (action === 'duplicate' ? 'POST' : 'GET')) return false;
    if (action === 'duplicate') await readJson(request);
    await saveQueue.run(id, () => {
      const save = store.get(id);
      if (!save) return reply(response, 404, { message: 'Save not found.' });
      if (action === 'duplicate') return reply(response, 201, playerView(makeCopy(store, save)));
      if (action === 'story') return download(response, 'harbinger-story.txt', 'text/plain; charset=utf-8', shareableStory(playerView(save)));
      const bundle = {
        format: saveFormat, version: saveFormatVersion, name: save.name, revision: save.revision,
        state: save.state, note: store.getNote?.(save.id) ?? '',
      };
      return download(response, 'harbinger-complete-save.json', 'application/json; charset=utf-8', JSON.stringify(bundle));
    });
    return true;
  };
}
