import { playerView, startEpisode, title } from '../../../../../app/episode.mjs';
import { directScene } from '../../../../../app/director.mjs';
import { providerFromEnvironment } from '../../../../../app/model.mjs';
import { recordThoughts } from '../../../../../app/thoughts.mjs';
import { clarificationPrefix, resolveTurn } from '../../../../../app/turns.mjs';
import { createCovelActors, narrationEvidence } from '../../../../actors.mjs';
import { generatePassage } from '../../../../narrator.mjs';

const privateStory = '_hidden.story';
const publicStory = 'story';

async function publishedPassages(ctx) {
  return (await ctx.pluginData.list('passages')).map(row => row.value).sort((a, b) => a.sequence - b.sequence);
}

function narration(paragraphs) {
  return { outcome: 'success', value: { segments: paragraphs.map(text => ({ kind: 'narration', text })), yield: 'user' } };
}

export default async function story(ctx) {
  const previous = await ctx.pluginData.get(privateStory, 'current');
  const opening = !previous;
  const playerText = ctx.playerActions.map(action => action.text?.trim()).filter(Boolean).join('\nThen ')
    || ctx.playerMessage;
  const history = await publishedPassages(ctx);
  if (previous && !playerText) {
    // The native opening follows setup when a portable save was already restored.
    const chunks = [];
    for (const paragraph of history.flatMap(passage => passage.paragraphs)) {
      const last = chunks.at(-1);
      if (last && last.length + paragraph.length + 2 <= 4000) chunks[chunks.length - 1] += '\n\n' + paragraph;
      else chunks.push(paragraph);
    }
    return narration(chunks.slice(-60));
  }
  const provider = { ...providerFromEnvironment(), signal: ctx.signal };
  const actors = createCovelActors(provider);
  let state;
  let speechDrafts = [];
  if (opening) {
    state = startEpisode();
  } else {
    const result = await resolveTurn(previous, playerText, actors, { pauseAtDirectorInterruption: true });
    if (result.clarification) return { outcome: 'failed', error: clarificationPrefix + result.clarification };
    state = result.state;
    speechDrafts = result.speechDrafts;
  }

  const save = { id: ctx.sessionId, name: previous?.name ?? title, revision: (previous?.revision ?? -1) + 1, state };
  await recordThoughts(previous?.state, state, actors, save.revision);
  const { passages: draft, ...view } = playerView(save);
  const newPassages = draft.slice(previous?.state.passages.length ?? 0);
  const finalPassage = newPassages.at(-1);
  const evidence = narrationEvidence(state, save.revision, speechDrafts);
  const paragraphs = await generatePassage(provider, {
    opening,
    passage: {
      ...finalPassage,
      paragraphs: newPassages.flatMap(passage => passage.paragraphs),
      playerText: opening ? null : playerText,
    },
    history,
    ...evidence,
    sceneBrief: directScene(view, newPassages, evidence.speakerEvidence),
  });

  const sequence = save.revision;
  const rendered = { ...finalPassage, playerText: opening ? null : playerText, paragraphs, sequence };
  const currentIds = new Set(newPassages.map(passage => passage.id));
  const linkPassage = observation => currentIds.has(observation.passageId)
    ? { ...observation, passageId: rendered.id } : observation;
  state.observations = state.observations.map(linkPassage);
  await ctx.pluginData.set(privateStory, 'current', save);
  await ctx.pluginData.set(publicStory, 'view', { ...view, observations: view.observations.map(linkPassage) });
  await ctx.pluginData.set('passages', rendered.id, rendered);

  return narration(paragraphs);
}
