import { playerView } from '../../../../../app/episode.mjs';
import { validCovelSave } from '../../../../saves.mjs';
import { storyNamespace, writeStoredStory } from '../../../../save-storage.mjs';

export default async function restore(ctx) {
  const bundle = ctx.manualPayload;
  if (!validCovelSave(bundle) || await ctx.pluginData.get(storyNamespace, 'current')) {
    return { outcome: 'failed', error: 'Choose a valid complete Covel save and a fresh session.' };
  }
  const { state, name, revision, passages, note } = bundle;
  const save = { id: ctx.sessionId, name: name.trim(), state, revision };
  const view = playerView(save);
  delete view.passages;
  await writeStoredStory(ctx.pluginData, save);
  await ctx.pluginData.set(storyNamespace, 'note', note);
  await ctx.pluginData.set('story', 'view', view);
  for (const passage of passages) {
    const { id, heading, location, time, playerText, paragraphs, sequence } = passage;
    await ctx.pluginData.set('passages', id, { id, heading, location, time, playerText, paragraphs, sequence });
  }
  return { outcome: 'success', value: { restored: true } };
}
