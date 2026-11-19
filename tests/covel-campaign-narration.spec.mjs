import { expect, test } from '@playwright/test';
import { campaignWordCount, narrateCampaign } from '../covel/campaign-narration.mjs';

function context(complete) {
  return {
    complete, signal: new AbortController().signal, playerText: 'Ask who signed',
    scene: { heading: 'The delivery book', location: 'London · Guild room' },
    view: { campaign: { chapter: 2, step: 3 }, choices: ['Read the entry', 'Leave it open'] },
    passages: [{ paragraphs: ['Martin points to the line. “It has space for a name.”'] }],
    recent: [], newObservations: [],
  };
}

test('campaign narration preserves resolved dialogue and publishes the returned paragraphs verbatim', async () => {
  const fill = key => Array.from({ length: 55 }, (_, word) => key + word).join(' ');
  const requests = [];
  let fields;
  const written = await narrateCampaign(context(request => {
    requests.push(request);
    fields = Object.keys(request.schema.properties);
    return Object.fromEntries(fields.map(key => [key, fill(key)]));
  }));
  expect(written).toEqual(['Martin points to the line. “It has space for a name.”', ...fields.map(fill)]);
  expect(requests).toHaveLength(1);
  expect(requests[0].instructions).toContain('Do not add any prop');
  expect(requests[0].context.printed).toEqual(written.slice(0, 1));
  expect(requests[0].context).not.toHaveProperty('availableActions');
});

test('the narrator adds a new bridge without rewriting an earlier reply', async () => {
  const supplied = 'grounded '.repeat(40).trim();
  const requests = [];
  const written = await narrateCampaign(context(request => {
    requests.push(request.context);
    return Object.fromEntries(Object.keys(request.schema.properties).map(key =>
      [key, key === 'bridge' ? supplied : (key + ' ').repeat(41).trim()]));
  }));
  expect(requests[1].parts).toHaveProperty('bridge');
  expect(written.at(-2)).toBe(supplied);
  expect(written.at(-1)).toBe('opening '.repeat(41).trim());
});

test('an independent director callback closes the turn and does not inform the current case draft', async () => {
  const closingBeat = 'Elsewhere in the lane, Alice brings news of her old tally.';
  const fixture = context(request => {
    expect(request.context.printed).toEqual(['Martin points to the line. “It has space for a name.”']);
    expect(JSON.stringify(request.context)).not.toContain(closingBeat);
    expect(request.context.parts.answer).toContain('only offered or arranged');
    return Object.fromEntries(Object.keys(request.schema.properties).map(key =>
      [key, (key + ' ').repeat(67).trim()]));
  });
  fixture.passages[0].paragraphs.push(closingBeat);
  const written = await narrateCampaign({ ...fixture, closingBeat, resolvedIntent: { stance: 'verify' } });
  expect(written.at(-1)).toBe(closingBeat);
  expect(written.filter(paragraph => paragraph === closingBeat)).toHaveLength(1);
});

test('the writer sees the difference between an earlier report and a newly verified detail', async () => {
  const earlier = { title: 'Report about the scale', text: 'One notch appears twice.', source: 'Martin', status: 'reported' };
  const current = { title: 'What the scale shows', text: 'One notch appears twice.', source: 'The scale', status: 'firsthand' };
  const resolvedIntent = { stance: 'verify', evidenceBefore: 'reported', evidenceAfter: 'firsthand' };
  const fixture = context(({ context, schema }) => {
    expect(context).toMatchObject({ earlierEvidence: [earlier], newEvidence: [current], resolvedIntent });
    expect(Object.keys(schema.properties)).toEqual(['answer', 'stakes', 'opening']);
    return Object.fromEntries(Object.keys(schema.properties).map(key => [key, (key + ' ').repeat(66).trim()]));
  });
  const written = await narrateCampaign({
    ...fixture, earlierEvidence: [earlier], newObservations: [current], resolvedIntent, reactionBudget: 48,
  });
  expect(campaignWordCount(written)).toBeGreaterThanOrEqual(200);
  expect(campaignWordCount(written) + 48).toBeLessThanOrEqual(300);
});
