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

const appointment = {
  actorId: 'alice', name: 'Alice', origin: 'bakehouse', scene: 'landing', locationId: 'thames-landing',
  place: 'the Thames landing', minute: 1020, expires: 1050, purpose: 'flour',
};

function activeMeetings(state) {
  const completed = new Set(state.records.filter(record => record.type === 'meeting-kept').map(record => record.meetingId));
  return state.records.filter(record => record.type === 'meeting-offered' && record.expires >= state.minute && !completed.has(record.id));
}

export function meetingOptions(state, actorId) {
  if (actorId !== appointment.actorId || state.scene !== appointment.origin || state.minute > appointment.minute
      || activeMeetings(state).some(record => record.actorId === actorId)) return [];
  return [appointment];
}

export function offerMeeting(state, actorId, proposal, passage) {
  if (!proposal) return;
  const option = meetingOptions(state, actorId).find(candidate =>
    candidate.locationId === proposal.locationId && candidate.purpose === proposal.purpose);
  if (!option) return;
  const label = `Meet ${option.name} at ${option.place}`;
  const offer = `${option.name} offers to wait at ${option.place} in the late afternoon so the two of you can speak about the flour.`;
  const event = {
    ...option, id: `meeting-${state.records.length}`, type: 'meeting-offered', label,
    passageId: passage.id, offeredAt: state.minute,
  };
  state.records.push(event);
  passage.paragraphs.push(offer);
  state.observations.push({
    id: `observation-${state.observations.length}`, passageId: passage.id, kind: 'promise',
    title: `Meeting with ${option.name}`, text: offer, source: `${option.name} at the bakehouse`,
    status: 'firsthand', recipients: ['player', actorId], minute: state.minute, topic: 'appointment',
  });
  return true;
}

export function offeredMeetings(state) {
  return activeMeetings(state).filter(record => record.scene !== state.scene);
}

export function honorMeeting(state) {
  const meeting = activeMeetings(state).find(record => record.scene === state.scene && record.minute <= state.minute);
  if (!meeting) return;
  const passage = state.passages.at(-1);
  const arrival = `${meeting.name} has stayed at ${meeting.place} to keep the appointment. She sets aside the tally for the flour so there is time for you to speak before the last cart leaves.`;
  passage.heading = `${meeting.name} keeps the appointment`;
  passage.paragraphs = [...passage.paragraphs, arrival];
  state.records.push({ type: 'meeting-kept', meetingId: meeting.id, minute: state.minute, passageId: passage.id });
  state.observations.push({
    id: `observation-${state.observations.length}`, passageId: passage.id, kind: 'promise',
    title: `${meeting.name} kept the appointment`, text: arrival, source: `Seen at ${meeting.place}`,
    status: 'firsthand', recipients: ['player', meeting.actorId], minute: state.minute, topic: 'appointment',
  });
}

export function advanceAgenda(state, minute) {
  const until = Math.max(state.minute, minute);
  const due = state.pending.filter(event => event.minute <= until).sort((a, b) => a.minute - b.minute);
  state.pending = state.pending.filter(event => event.minute > until);
  for (const event of due) {
    if (event.type !== 'inspection') {
      state.records.push(event);
      continue;
    }
    const submitted = state.records.findLast(record => record.type === 'ledger-presented' && record.minute <= event.minute);
    state.records.push({
      ...event,
      id: `inspection-${event.minute}`,
      outcome: submitted ? 'oven-licensed' : 'oven-sealed',
      sources: submitted ? [{ actorId: 'martin', detail: 'Received the ledger names before the inspection.' }] : [
        { actorId: 'errand-boy', detail: 'Saw the written order on the bakehouse shutter.' },
        { actorId: 'guild-runner', detail: 'Received a copy of the order from Martin.' },
      ],
    });
  }
  state.minute = until;
}

export function timeOfDay(minute) {
  if (minute < 420) return 'Dawn';
  if (minute < 720) return 'Morning';
  if (minute < 960) return 'Afternoon';
  if (minute < 1080) return 'Late afternoon';
  if (minute < 1100) return 'Dusk';
  return 'After dusk';
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

const sceneFocus = {
  bakehouse: ['Whose names are worth putting in the ledger?', 'Let the work around the oven and the deadline give the scene its pressure.'],
  guildInspection: ['What will the clerk let Martin put on record?', 'Make the stakes at the guild table concrete. Leave the decision with the clerk.'],
  landing: ['What ought the clerk to do about the flour?', 'Let the work at the landing make the decision immediate.'],
  marketTally: ['What can the clerk learn from the carters before the tally is ready?', 'Give the carters a practical reason for what they will say or do.'],
};
const tactics = {
  Alice: 'Let practical work and the cost of a favor carry what Alice is reluctant to say.',
  Martin: 'Give Martin a reason to distinguish the record he can sign from what he has heard.',
};

export function directScene(view, passages, speakers) {
  const passageIds = new Set(passages.map(passage => passage.id));
  const evidence = view.observations.filter(item => passageIds.has(item.passageId));
  const latest = passages.at(-1);
  let focus = sceneFocus[view.scene.id] ?? ['What has changed for the clerk here?', 'Resolve the immediate result before the scene ends.'];
  if (evidence.some(item => item.supersedes && item.status === 'firsthand')) {
    focus = ['What does the written record add to what the clerk heard?', 'Let the clerk encounter the evidence and hear only the interpretations the people present can make.'];
  } else if (evidence.some(item => item.topic === 'oven-closure' && item.status === 'reported')) {
    focus = ['How will the clerk respond to news of the missed inspection?', 'Bring the news through its reachable source. Leave the clerk free to verify it or walk away.'];
  } else if (evidence.some(item => item.topic === 'appointment')) {
    focus = ['What is Alice prepared to set aside to speak with the clerk?', 'Give the appointment a practical cost to Alice and leave the next decision to the clerk.'];
  } else if (view.turn?.kind === 'interrupted') {
    focus = ['How will the clerk respond to being stopped?', 'Show the action through the interruption and stop before any later attempted step.'];
  } else if (latest.heading === 'A moment to look') {
    focus = ['What becomes apparent when the clerk looks more closely?', 'Let observable details and nearby work carry the quiet moment. The clerk determines what to do next.'];
  }
  const [dramaticQuestion, beat] = focus;
  const interrupted = view.turn?.kind === 'interrupted';
  return {
    dramaticQuestion,
    beat: interrupted ? `${beat} Stop before any later attempted step.` : beat,
    time: view.scene.time,
    characterTactics: speakers.map(({ speaker }) => ({
      speaker, tactic: tactics[speaker] ?? 'Let the person speak from the work and evidence they had access to.',
    })),
    resolution: evidence.map(({ text, source, status }) => ({ text, source, status })),
  };
}
