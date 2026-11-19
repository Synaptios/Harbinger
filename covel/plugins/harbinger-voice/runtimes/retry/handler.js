import { prepareNarration } from '../../voice.mjs';

export default async function retry(ctx) {
  return prepareNarration(ctx, { manual: true });
}
