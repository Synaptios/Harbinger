import { sceneActorIds } from '../app/thoughts.mjs';

/** Only names established onstage in the accepted passage enter the public cast. */
export function publicMediaCues(ctx, state, scene, paragraphs, revision) {
  const onstage = new Set(sceneActorIds(state));
  const accepted = paragraphs.join(' ').normalize('NFKC').toLowerCase();
  const namedInPassage = name => {
    const escaped = name.normalize('NFKC').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(accepted);
  };
  const cast = (state.thoughts ?? []).filter(({ actorId, turn, presence, name }) =>
    turn === revision && presence === 'onstage' && onstage.has(actorId) && name &&
    namedInPassage(name));
  const stored = new Set((ctx.world?.characters ?? []).map(({ id }) => id));
  const now = new Date().toISOString();
  return {
    cues: { scene: scene.location, present: cast.map(({ name }) => name) },
    pendingProposals: cast.filter(({ actorId }) => !stored.has(actorId)).map(({ actorId, name }) => ({
      id: crypto.randomUUID(),
      type: 'character.upsert',
      source: { pluginId: ctx.pluginId, runtimeId: ctx.runtimeId },
      turnId: ctx.turnId,
      sessionId: ctx.sessionId,
      timestamp: now,
      payload: { id: actorId, name, type: 'npc', fields: {}, version: 1, createdAt: now },
    })),
  };
}
