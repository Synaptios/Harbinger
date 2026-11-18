export function seedMemory(story, characterId) {
  const episodes = [];
  const facts = [];
  story.events.forEach((event, index) => {
    const allowed = event.knowledge.flatMap((entry, position) => entry.visibleTo.includes(characterId)
      ? [{ id: event.id + '-' + (position + 1), index, text: entry.statement, route: entry.route }]
      : []);
    facts.push(...allowed);
    const lived = allowed.filter((fact) => ['direct', 'observation'].includes(fact.route));
    if (event.participants.includes(characterId) && lived.length) {
      episodes.push({ id: event.id, title: event.title, index,
        text: 'I remember this: ' + lived.map((fact) => fact.text).join(' ') });
    }
  });
  return { episodes, facts, patterns: [], emotions: [] };
}

function similarity(a, b) {
  let dot = 0;
  let aLength = 0;
  let bLength = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aLength += a[i] ** 2;
    bLength += b[i] ** 2;
  }
  return dot / (Math.sqrt(aLength * bLength) || 1);
}

export function createRanker(providers) {
  const indexes = new Map();
  return async function rank({ model, query, records, limit, signal }) {
    if (!records.length) return [];
    if (!indexes.has(model)) {
      if (indexes.size === 12) indexes.delete(indexes.keys().next().value);
      indexes.set(model, new Map());
    }
    const index = indexes.get(model);
    const missing = [...new Set(records.map(({ text }) => text))].filter((text) => !index.has(text));
    const [needle, ...first] = await providers.embed({ model, texts: [query, ...missing.slice(0, 31)], signal });
    first.forEach((vector, i) => index.set(missing[i], vector));
    for (let offset = 31; offset < missing.length; offset += 32) {
      const slice = missing.slice(offset, offset + 32);
      const vectors = await providers.embed({ model, texts: slice, signal });
      vectors.forEach((vector, i) => index.set(slice[i], vector));
    }
    return records.map((record) => ({ record, score: similarity(needle, index.get(record.text)) }))
      .sort((a, b) => b.score - a.score || b.record.index - a.record.index)
      .slice(0, limit).map(({ record }) => record);
  };
}
