import { prepareNarration } from '../../voice.mjs';

export default async function synthesize(ctx) {
  return prepareNarration(ctx, { manual: false });
}
