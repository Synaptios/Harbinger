import { createHash } from 'node:crypto';

export const done = { outcome: 'success', value: {} };
const callsPerJob = 4;
const running = new Map();

function normalized(name) {
  return name.normalize('NFKC').trim().toLowerCase();
}

function placeKey(name) {
  return 'place:' + createHash('sha256').update(normalized(name)).digest('hex').slice(0, 24);
}

function subjectPrompt({ kind, label }) {
  return kind === 'place'
    ? `Illustrate the disclosed setting "${label}" as a quiet landscape for a work of interactive fiction. Show the location, with no text or lettering.`
    : `Make a portrait of the publicly identified character "${label}" for a work of interactive fiction. Show one person with no name label, text, or lettering.`;
}

function disclosedSubjects(story, presentation) {
  const place = story.cues?.scene?.trim();
  const subjects = new Map();
  if (place) subjects.set(placeKey(place), { id: placeKey(place), kind: 'place', label: place });
  const passages = normalized(story.segments.map(({ text }) => text).join(' '));
  for (const cue of story.cues?.present ?? []) {
    const name = normalized(cue);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(passages)) continue;
    const matches = presentation.characters.filter(character =>
      [character.name, ...(character.aliases ?? [])].map(normalized).includes(name));
    if (matches.length !== 1 || matches[0].id === presentation.viewpointCharacterId) continue;
    const id = 'portrait:' + matches[0].id;
    subjects.set(id, { id, kind: 'portrait', label: cue.trim() });
  }
  return [...subjects.values()];
}

async function draw(ctx, subject) {
  const key = `${ctx.sessionId}/${subject.id}`;
  // A newer queued turn may have captured the same disclosure while this job was pending.
  if (running.has(key)) return running.get(key);
  const task = (async () => {
    try {
      const { refs } = await ctx.images.generate({
        presetId: 'image',
        prompt: subjectPrompt(subject),
        n: 1,
        quality: ctx.userSettings?.quality ?? 'low',
        size: subject.kind === 'place' ? '1536x1024' : '1024x1024',
        metadata: { kind: subject.kind, subject: subject.id },
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(90_000)]),
      });
      if (refs[0]) return { ...subject, ref: refs[0], failed: false };
    } catch {
      ctx.signal.throwIfAborted();
    }
    return { ...subject, failed: true };
  })();
  running.set(key, task);
  try {
    return await task;
  } finally {
    running.delete(key);
  }
}

export async function renderBatch(ctx, index) {
  const story = ctx.inputs?.story?.value;
  if (!story) return done;
  const candidates = disclosedSubjects(story, ctx.presentation);
  if (index === 0) {
    const previous = await ctx.pluginData.get('stage', 'current');
    const place = candidates.find(({ kind }) => kind === 'place') ?? previous?.place ?? null;
    const cast = story.cues?.present ? candidates.filter(({ kind }) => kind === 'portrait') : previous?.cast ?? [];
    const next = { place, cast };
    if (JSON.stringify(next) !== JSON.stringify(previous)) await ctx.pluginData.set('stage', 'current', next);
  }
  if (ctx.userSettings?.automatic === false) return done;
  const rows = await ctx.pluginData.list('display');
  const known = new Set(rows.flatMap(({ value }) => value.items.map(({ id }) => id)));
  const start = index * callsPerJob;
  const subjects = candidates
    .filter(({ id }) => !known.has(id)).slice(start, start + callsPerJob);
  if (!subjects.length) return done;
  const record = `batch-${index}`;
  const items = [...(rows.find(({ key }) => key === record)?.value.items ?? [])];
  for (const subject of subjects) {
    items.push(ctx.images?.isAvailable('image') ? await draw(ctx, subject) : { ...subject, failed: true });
  }
  await ctx.pluginData.set('display', record, { items });
  return done;
}

export async function retryIllustration(ctx) {
  const id = ctx.manualPayload?.id;
  if (typeof id !== 'string' || !ctx.images?.isAvailable('image')) return done;
  const rows = await ctx.pluginData.list('display');
  for (const { key, value } of rows) {
    const index = value.items.findIndex(subject => subject.id === id && subject.failed);
    if (index < 0) continue;
    const items = [...value.items];
    items[index] = await draw(ctx, items[index]);
    await ctx.pluginData.set('display', key, { items });
    break;
  }
  return done;
}
