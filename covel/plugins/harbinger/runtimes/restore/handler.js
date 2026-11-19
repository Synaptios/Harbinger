import { restoreSave } from '../../../../saves.mjs';

export default async function restore(ctx) {
  if (!await restoreSave(ctx.pluginData, ctx.sessionId, ctx.manualPayload)) {
    return { outcome: 'failed', error: 'Choose a valid complete Covel save and a fresh session.' };
  }
  return { outcome: 'success', value: { restored: true } };
}
