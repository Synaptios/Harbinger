import { testingView } from '../../../../app/thoughts.mjs';
import { captureSave, saveNote } from '../../../saves.mjs';
import { readCommittedStory } from '../../../save-storage.mjs';

export default function register(covel) {
  covel.registerRpc('capture-save', (_payload, context) => captureSave(context), {
    description: 'Capture a complete committed Harbinger save, including its hidden state.',
  });
  covel.registerRpc('journal-note', (payload, { store }) => saveNote(store, payload), {
    description: 'Read or update the private notes for a committed Harbinger save.',
  });
  covel.registerRpc('testing-view', async (_payload, context) => {
    const save = await readCommittedStory(context.store);
    if (!save) return { ok: false, message: 'Save not found.' };
    return { ok: true, data: testingView(save) };
  }, { description: 'Read the opted-in testing view of a committed Harbinger save.' });
}
