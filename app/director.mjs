const inspectionConsequences = [
  {
    id: 'inspection-at-bakehouse', scene: 'shutter', title: 'A key at dusk',
    actorId: 'errand-boy', locationId: 'bakehouse-lane', travelMinutes: 0,
    reason: 'The inspection sealed the oven. The boy saw the order and was already on the lane where the clerk returned.',
  },
  {
    id: 'inspection-at-market', scene: 'marketWarning', title: 'A warning by the stall',
    actorId: 'guild-runner', locationId: 'market', travelMinutes: 8,
    reason: 'The inspection sealed the oven. The guild runner had the market copy of the order and enough time to reach the clerk at the market.',
  },
];

export function advanceAgenda(state, minute) {
  const until = Math.max(state.minute, minute);
  const due = state.pending.filter(event => event.minute <= until).sort((a, b) => a.minute - b.minute);
  state.pending = state.pending.filter(event => event.minute > until);
  for (const event of due) {
    if (event.type !== 'inspection') {
      state.records.push(event);
      continue;
    }
    state.records.push({
      ...event,
      id: `inspection-${event.minute}`,
      outcome: 'oven-sealed',
      sources: [
        { actorId: 'errand-boy', detail: 'Saw the written order on the bakehouse shutter.' },
        { actorId: 'guild-runner', detail: 'Received a copy of the order from Martin.' },
      ],
    });
  }
  state.minute = until;
}

export function selectInspectionConsequence(state, locationId) {
  const inspection = state.records.findLast(event => event.type === 'inspection' && event.outcome === 'oven-sealed');
  if (!inspection || state.directorTrace?.some(entry => entry.eventId === inspection.id)) return null;
  const consequence = inspectionConsequences.find(candidate =>
    candidate.locationId === locationId &&
    state.minute >= inspection.minute + candidate.travelMinutes &&
    inspection.sources.some(source => source.actorId === candidate.actorId));
  if (!consequence) return null;

  state.directorTrace ??= [];
  state.directorTrace.push({
    id: `direction-${state.directorTrace.length}`,
    minute: state.minute,
    situationId: consequence.id,
    situation: consequence.title,
    eventId: inspection.id,
    actorId: consequence.actorId,
    locationId: consequence.locationId,
    reason: consequence.reason,
  });
  return consequence.scene;
}
