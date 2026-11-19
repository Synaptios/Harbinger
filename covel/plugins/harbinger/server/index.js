import { testingView } from '../../../../app/thoughts.mjs';
import { captureSave } from '../../../saves.mjs';
import { readCommittedStory, storyNamespace } from '../../../save-storage.mjs';

export default function register(covel) {
  covel.registerRpc('capture-save', (_payload, context) => captureSave(context), {
    description: 'Capture a complete committed Harbinger save, including its hidden state.',
  });
  covel.registerRpc('journal-note', async (payload, context) => {
    const { store } = context;
    if (!(await store.getPluginData(storyNamespace, 'current'))) return { ok: false, message: 'Save not found.' };
    if (Object.hasOwn(payload ?? {}, 'note')) {
      if (typeof payload.note !== 'string' || payload.note.length > 4000) {
        return { ok: false, message: 'Enter up to 4,000 characters of notes.' };
      }
      await store.setPluginData({ namespace: storyNamespace, key: 'note', value: payload.note });
      return { ok: true, data: { note: payload.note } };
    }
    const row = await store.getPluginData(storyNamespace, 'note');
    return { ok: true, data: { note: row?.value ?? '' } };
  }, { description: 'Read or update the private notes for a committed Harbinger save.' });
  covel.registerRpc('testing-view', async (_payload, context) => {
    const save = await readCommittedStory(context.store);
    if (!save) return { ok: false, message: 'Save not found.' };
    return { ok: true, data: testingView(save) };
  }, { description: 'Read the opted-in testing view of a committed Harbinger save.' });
}
