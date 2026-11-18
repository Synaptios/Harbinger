import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asText, perspectiveRule, stageRunner } from './chat.mjs';
import { seedMemory } from './memory.mjs';
import { resolveSettings } from './stages.mjs';

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sourceEvidence(event, character) {
  return event.knowledge.flatMap((entry, index) => entry.visibleTo.includes(character.id) ? [{
    id: event.id + '-' + (index + 1), statement: entry.statement, route: entry.route, excerpt: entry.evidence ?? '',
  }] : []);
}

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

function exactExcerpts(value, evidence) {
  return array(value).flatMap((quote) => {
    const excerpt = asText(quote?.text, 400);
    const source = evidence.find(({ id }) => id === quote?.evidence_id);
    return excerpt && source?.excerpt.includes(excerpt) ? [excerpt] : [];
  }).slice(0, 4);
}

async function buildEvent({ event, index, character, canonicalize, run }) {
  const evidence = sourceEvidence(event, character);
  const lived = event.participants.includes(character.id) ? evidence.filter(({ route }) => ['direct', 'observation'].includes(route)) : [];
  if (!evidence.length) return { episode: null, facts: [], emotion: null, patterns: [] };

  const context = { character: character.name, evidence };
  const personalContext = { character: character.name, evidence: lived };
  const prepare = await run('scenePreparation', context, 'Return JSON {"scene":"briefly organized scene evidence"}.', perspectiveRule);
  const [summary, entityResult, emotionResult] = await Promise.all([
    lived.length ? run('episodic', personalContext, 'Return JSON {"memory":"first-person scene summary"}.', perspectiveRule) : {},
    run('entities', { ...context, scene: asText(prepare.scene, 2_000) }, 'Return JSON {"entities":["name", "object", "place"]}.', perspectiveRule),
    lived.length ? run('emotionAnnotation', personalContext,
      'Return JSON {"transitions":[{"emotion":"…","intensity":"…","trigger":"…","intent":"…"}]} in narrative order.', perspectiveRule) : {},
  ]);
  const memory = asText(summary.memory, 2_000);
  const entities = array(entityResult.entities).map((entity) => asText(entity, 250)).filter(Boolean).slice(0, 60);
  const relations = await run('facts', { ...context, entities },
    'Return JSON {"facts":[{"evidence_id":"a supplied ID","subject":"…","predicate":"…","object":"…","cause":"…"}]}. Prefer one relation per evidence ID.', perspectiveRule);
  const approvedSources = new Map(evidence.map((item) => [item.id, item]));
  const candidates = array(relations.facts).flatMap((relation) => {
    const source = approvedSources.get(relation?.evidence_id);
    const subject = asText(relation?.subject, 250);
    const predicate = asText(relation?.predicate, 250);
    const object = asText(relation?.object, 500);
    if (!source || !subject || !predicate || !object) return [];
    return [{ id: source.id, subject, predicate, object, cause: asText(relation.cause, 500), route: source.route }];
  }).slice(0, evidence.length * 2);
  const [verification, personality] = await Promise.all([
    run('visibility', { ...context, candidates, episodic: memory, episodicEvidenceIds: lived.map(({ id }) => id) },
      'Return JSON {"accepted_evidence_ids":["ID"],"episode_supported":true or false}. Accept a fact ID only if its proposed relation is supported by the statement and its recorded visibility route. Accept the episode only if all its claims are supported by the listed episodic evidence.', perspectiveRule),
    lived.length ? run('personality', personalContext,
      'Return JSON {"patterns":[{"label":"…","description":"…","excerpts":[{"evidence_id":"ID","text":"exact dialogue"}]}]}. Return an empty array when the scene has no supported pattern.', perspectiveRule) : {},
  ]);

  const accepted = new Set(array(verification.accepted_evidence_ids));
  const facts = candidates.filter(({ id }) => accepted.has(id)).map(({ id, subject, predicate, object, cause, route }) => ({
    id, index, text: approvedSources.get(id).statement,
    subject: canonicalize(subject, approvedSources.get(id).statement), predicate,
    object: canonicalize(object, approvedSources.get(id).statement), cause, route,
  }));
  const episode = memory && verification.episode_supported === true ? { id: event.id, title: event.title, index, text: memory } : null;
  const emotion = array(emotionResult.transitions).flatMap((transition) => {
    const label = asText(transition?.emotion, 120);
    return label ? [{ index, emotion: label, intensity: asText(transition.intensity, 80),
      trigger: asText(transition.trigger, 400), intent: asText(transition.intent, 400) }] : [];
  }).slice(0, 16);
  const patterns = array(personality.patterns).flatMap((pattern, position) => {
    const label = asText(pattern?.label, 120);
    const description = asText(pattern?.description, 600);
    if (!label || !description) return [];
    return [{ id: event.id + '-pattern-' + (position + 1), index, label, description, excerpts: exactExcerpts(pattern.excerpts, lived) }];
  }).slice(0, 5);
  return { episode, facts, emotion, patterns };
}

export async function buildMemory({ story, character, settings, providers, signal }) {
  const run = stageRunner(providers, resolveSettings(settings), signal);
  const aliases = new Map(story.characters.flatMap(({ name, aliases }) => aliases.map((alias) => [normalize(alias), name])));
  const canonicalize = (name, statement) => {
    const canonical = aliases.get(normalize(name));
    return canonical && normalize(statement).includes(normalize(canonical)) ? canonical : name;
  };
  const memory = { episodes: [], facts: [], patterns: [], emotions: [] };
  const factKeys = new Set();
  const patternKeys = new Set();
  for (const [index, event] of story.events.entries()) {
    signal.throwIfAborted();
    const record = await buildEvent({ event, index, character, canonicalize, run });
    if (record.episode) memory.episodes.push(record.episode);
    if (record.emotion) memory.emotions.push(...record.emotion);
    for (const fact of record.facts) {
      const key = normalize(fact.text);
      if (factKeys.has(key)) continue;
      factKeys.add(key);
      memory.facts.push(fact);
    }
    for (const pattern of record.patterns) {
      const key = normalize(pattern.label + ' ' + pattern.description);
      if (patternKeys.has(key)) continue;
      patternKeys.add(key);
      memory.patterns.push(pattern);
    }
  }
  return memory;
}

export async function openMemoryStore(story, directory) {
  const revision = createHash('sha256').update(JSON.stringify(story)).digest('hex').slice(0, 16);
  const memoryPath = (id) => join(directory, revision + '-' + id + '.json');
  const entries = new Map(await Promise.all(story.characters.map(async ({ id }) => {
    if (directory) {
      try {
        const memory = JSON.parse(await readFile(memoryPath(id), 'utf8'));
        if (['episodes', 'facts', 'patterns', 'emotions'].every((key) => Array.isArray(memory?.[key]))) return [id, memory];
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('A Harbinger memory file could not be loaded. Using the prepared story memory.');
      }
    }
    return [id, seedMemory(story, id)];
  })));

  return {
    entries,
    async save(id, memory) {
      if (directory) {
        await mkdir(directory, { recursive: true });
        const destination = memoryPath(id);
        const temporary = destination + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temporary, JSON.stringify(memory), { flag: 'wx', mode: 0o600 });
          await rename(temporary, destination);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      entries.set(id, memory);
    },
  };
}
