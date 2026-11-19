import { createHash } from 'node:crypto';

const success = { outcome: 'success', value: {} };
const trackNamespace = 'audio';
const sourceNamespace = 'source';
const clipLimit = 3800;
const castDefaults = ['Ashley', 'Olivia', 'Alex'];

function isPublicStory(message) {
  return message.sourceType === 'runtime' && message.role === 'assistant' && message.content?.trim()
    && ['harbinger/story', 'narrator'].includes(message.sourceRuntimeId);
}

function bodyOf(story) {
  return story?.segments?.map(segment => segment.text).join('\n\n');
}

function normalizeName(name) {
  return name.normalize('NFKC').trim().toLowerCase();
}

function voiceMapping(names, narrator, setting) {
  const voices = new Map([['alice', 'Ashley']]);
  for (const assignment of (setting ?? '').split(',')) {
    const [name, voice] = assignment.split('=').map(part => part.trim());
    if (name && voice) voices.set(normalizeName(name), voice);
  }
  const candidates = castDefaults.filter(voice => voice !== narrator);
  const used = new Set([narrator, ...names.map(name => voices.get(name)).filter(Boolean)]);
  for (const name of names) {
    if (voices.has(name)) continue;
    const start = createHash('sha256').update(name).digest().readUInt16LE() % candidates.length;
    const preference = [...candidates.slice(start), ...candidates.slice(0, start)];
    const voice = preference.find(voice => !used.has(voice)) ?? preference[0];
    voices.set(name, voice);
    used.add(voice);
  }
  return voices;
}

function quoteSegments(text, names) {
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(/“([^”\n]+)”|"([^"\n]+)"/gu)) {
    const speech = match[1] ?? match[2];
    const next = match.index + match[0].length;
    const after = text.slice(next).trimStart();
    const before = text.slice(cursor, match.index).trimEnd();
    const matchingNames = names.filter(name => {
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const attribution = '(?:says|said|asks|asked|replies|replied|quietly says|whispers|whispered)';
      return new RegExp(`^(?:${safe}\\s+${attribution}|${attribution}\\s+${safe})(?=[\\s.!?;,:]|$)`, 'iu').test(after)
        || new RegExp(`(?:^|[.!?]\\s+)${safe}\\s+${attribution}[:,]$`, 'iu').test(before);
    });
    if (matchingNames.length !== 1) continue;
    const prefix = text.slice(cursor, match.index).trim();
    if (prefix) segments.push({ text: prefix });
    segments.push({ text: speech, speaker: matchingNames[0] });
    cursor = next;
  }
  const remaining = text.slice(cursor).trim();
  if (remaining) segments.push({ text: remaining });
  return segments;
}

function narrationSegments(story, record, knownCharacters) {
  if (bodyOf(story) !== record.content) return [{ text: record.content }];
  const present = new Set((story.cues?.present ?? []).map(normalizeName));
  const names = [...new Set(knownCharacters.map(({ name }) => name)
    .filter(name => name && present.has(normalizeName(name))))];
  return story.segments.flatMap(segment => {
    const speaker = typeof segment.speaker === 'string'
      ? names.find(name => normalizeName(name) === normalizeName(segment.speaker)) : undefined;
    if (segment.kind === 'dialogue' && speaker) return [{ text: segment.text, speaker }];
    return record.sourcePluginId === 'harbinger' && segment.kind === 'narration'
      ? quoteSegments(segment.text, names) : [{ text: segment.text }];
  });
}

function clipsFor(segments, settings) {
  const narrator = settings?.narrator?.trim() || 'Dennis';
  const cast = [...new Set(segments.flatMap(({ speaker }) => speaker ? [normalizeName(speaker)] : []))].sort();
  const voices = voiceMapping(cast, narrator, settings?.cast);
  const runs = [];
  for (const { text, speaker } of segments) {
    const last = runs.at(-1);
    if (last && last.speaker === speaker) last.text += '\n\n' + text;
    else runs.push({ text, speaker });
  }
  return runs.flatMap(({ text, speaker }) => {
    const voice = speaker ? voices.get(normalizeName(speaker)) : narrator;
    const pieces = [];
    let rest = text.trim();
    while (rest.length > clipLimit) {
      let boundary = rest.lastIndexOf(' ', clipLimit);
      if (boundary < clipLimit / 2) boundary = clipLimit;
      if (/^[\uD800-\uDBFF]$/u.test(rest[boundary - 1])) boundary -= 1;
      pieces.push(rest.slice(0, boundary).trim());
      rest = rest.slice(boundary).trim();
    }
    if (rest) pieces.push(rest);
    return pieces.map(text => ({ speaker: speaker ?? 'Narrator', voice, text }));
  });
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

export async function prepareNarration(ctx, { manual }) {
  if (!ctx.speech) return success;
  const turnId = manual ? ctx.manualPayload?.turnId : (ctx.execution?.sourceTurnId ?? ctx.turnId);
  const story = ctx.inputs?.story?.value;
  if (!manual && !story?.segments?.length) return success;
  const journal = await ctx.store.listTurnMessages(200);
  let record = journal.findLast(message => isPublicStory(message) && (!turnId || message.turnId === turnId));
  if (!record && manual && turnId && await ctx.pluginData.get(trackNamespace, turnId)) {
    let after;
    do {
      const page = await ctx.store.readTurnMessages({ after });
      record = page.messages.find(message => message.turnId === turnId && isPublicStory(message));
      if (record || !page.hasMore) break;
      after = page.cursor;
    } while (after);
  }
  if (!record) return success;
  if (!manual && (bodyOf(story) !== record.content || (record.sourcePluginId === 'harbinger' && !story.cues?.scene))) return success;

  const id = record.turnId;
  const sourceHash = digest(record.content);
  const saved = manual ? await ctx.pluginData.get(sourceNamespace, id) : null;
  const existing = manual ? await ctx.pluginData.get(trackNamespace, id) : null;
  const matching = saved?.sourceHash === sourceHash;
  if (matching && existing?.status === 'ready') return success;
  const segments = matching ? saved.segments : narrationSegments(story, record, ctx.world?.characters ?? []);
  const clips = clipsFor(segments, ctx.userSettings);
  await ctx.pluginData.set(sourceNamespace, id, { sourceHash, segments, voices: clips.map(({ voice }) => voice) });
  if (!clips.length || (!manual && ctx.userSettings?.automatic === false)) return success;
  const tracks = [];
  // Pace paid requests in groups of four while the detached worker drains all clips.
  for (let offset = 0; offset < clips.length; offset += 4) {
    ctx.signal.throwIfAborted();
    const batch = clips.slice(offset, offset + 4).map(async ({ speaker, text, voice }, index) => {
      const already = matching && saved.voices[offset + index] === voice && existing?.clips[offset + index];
      if (already?.ref) return already;
      try {
        const { refs } = await ctx.speech.generate({ presetId: 'speech', text, voice, format: 'wav', signal: ctx.signal });
        if (refs[0]) return { speaker, ref: refs[0] };
      } catch {
        ctx.signal.throwIfAborted();
      }
      return { speaker, failed: true };
    });
    tracks.push(...await Promise.all(batch));
  }
  await ctx.pluginData.set(trackNamespace, id, {
    turnId: id,
    time: record.createdAt,
    status: tracks.every(clip => clip.ref) ? 'ready' : 'failed',
    clips: tracks,
  });
  return success;
}
