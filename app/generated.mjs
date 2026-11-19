import { advanceAgenda } from './director.mjs';
import { actorContext, initialKnowledge } from './knowledge.mjs';
import { stalledModelResult } from './model.mjs';

const slot = {
  sceneId: 'guild-storehouse',
  landingId: 'landing',
  placeId: 'riverside-storehouse',
  actorId: 'guild-porter',
  travelMinutes: 5,
  porterNames: ['Agnes', 'Edith', 'Thomas'],
  signs: ['Willow', 'Anchor', 'Sedge'],
};
const actions = {
  visit: 'Visit the riverside storehouse',
  help: 'Help the porter sort the tally',
  tally: 'Ask the porter about the guild tally',
  leave: 'Return to the Thames landing',
};
const tallyFact = {
  id: 'storehouse-tally',
  text: 'The guild tallies each sack by its mark before putting it on a shelf.',
  recipients: [slot.actorId],
  source: 'The porter’s assigned guild tally',
};

function timeOfVisit(state) {
  return state.minute >= 1080 ? 'Dusk' : 'Late afternoon';
}

export function generatedScene(state) {
  const place = state.generatedStorehouse;
  if (state.scene !== slot.sceneId || !place) return undefined;
  return { heading: place.name, location: 'London · ' + place.name, time: timeOfVisit(state), choices: [] };
}

export function generatedChoices(state) {
  if (state.scene === slot.landingId) return [actions.visit];
  if (!generatedScene(state)) return [];
  const helped = state.relationships?.some(relation => relation.from === slot.actorId && relation.to === 'player' && relation.trust > 0);
  return [...(helped ? [] : [actions.help]), actions.tally, actions.leave];
}

async function chooseAppearance(model) {
  if (model) {
    try {
      const result = await model.complete({
        operation: 'generate-storehouse',
        instruction: 'Choose one porter name and one sign for the established guild storehouse off the Thames landing. Return JSON with only porterName and sign, selected from the supplied lists. The engine defines the role, location, and knowledge.',
        context: { porterNames: slot.porterNames, signs: slot.signs },
      });
      if (result === stalledModelResult) return result;
      if (result && Object.keys(result).sort().join(',') === 'porterName,sign' &&
          slot.porterNames.includes(result.porterName) && slot.signs.includes(result.sign)) return result;
    } catch {
      // The authored appearance keeps the route playable if the provider fails.
    }
  }
  return { porterName: slot.porterNames[0], sign: slot.signs[0] };
}

function fillSlot(state, { porterName, sign }) {
  state.generatedStorehouse = {
    id: slot.placeId,
    name: sign + ' Storehouse',
    connectedTo: slot.landingId,
    porterId: slot.actorId,
  };
  state.actors ??= initialKnowledge().actors;
  state.actors[slot.actorId] = {
    id: slot.actorId, name: porterName, locationId: slot.placeId, role: 'guild porter',
    goal: 'Account for the sacks delivered to the guild’s storehouse.',
    emotion: 'busy but cordial',
    voice: { style: 'Direct and practical.', examples: ['See the mark before you count the sack.'] },
  };
  state.relationships ??= initialKnowledge().relationships;
  state.relationships.push({ from: slot.actorId, to: 'player', trust: 0 });
  state.facts.push({ ...tallyFact, availableFrom: state.minute });
}

function append(state, scene, playerText, paragraphs, observations = []) {
  const passageId = 'passage-' + state.passages.length;
  state.passages.push({
    id: passageId, heading: scene.heading, location: scene.location, time: scene.time, playerText, paragraphs,
  });
  for (const observation of observations) {
    state.observations.push({
      id: 'observation-' + state.observations.length,
      passageId, ...observation, status: 'firsthand', minute: state.minute, recipients: observation.recipients ?? ['player'],
    });
  }
  state.records.push({ type: 'generated-encounter', actorId: slot.actorId, minute: state.minute, passageId });
  return passageId;
}

export async function playGeneratedTurn(state, choice, model) {
  if (!generatedChoices(state).includes(choice)) return false;
  if (choice === actions.visit) {
    const firstVisit = !state.generatedStorehouse;
    const appearance = firstVisit ? await chooseAppearance(model) : null;
    if (appearance === stalledModelResult) return appearance;
    advanceAgenda(state, state.minute + slot.travelMinutes);
    if (appearance) fillSlot(state, appearance);
    state.scene = slot.sceneId;
    const { name } = state.generatedStorehouse;
    const porter = state.actors[slot.actorId];
    const relationship = actorContext(state, slot.actorId).relationship;
    const paragraphs = firstVisit ? [
      'A narrow path leads from the Thames landing to the ' + name + '. The painted sign has weathered to the colour of river clay.',
      porter.name + ', the guild porter, props the door with an empty barrel and rests a chalk tally on the lid.',
    ] : [
      'The same painted sign hangs above the door of the ' + name + '. ' + porter.name + ' is still on duty.',
      relationship?.trust > 0
        ? porter.name + ' remembers your help with the tally. “If you bring a sack tomorrow, I’ll make room for it.”'
        : porter.name + ' gives you a brief nod and goes on checking the marks.',
    ];
    const observations = firstVisit ? [
      { kind: 'place', title: name, text: 'The guild storehouse is a short walk from the Thames landing.', source: 'Path from the Thames landing' },
      { kind: 'person', title: porter.name, text: porter.name + ' keeps the storehouse tally as the guild porter.', source: 'Meeting at the storehouse' },
      { kind: 'clue', topic: 'storehouse-chalk', title: 'The chalk tally', text: 'The porter rested the chalk tally on top of the barrel by the storehouse door.', source: 'At the storehouse door', recipients: ['player', slot.actorId] },
    ] : [];
    append(state, generatedScene(state), choice, paragraphs, observations);
  } else if (choice === actions.leave) {
    advanceAgenda(state, state.minute + slot.travelMinutes);
    state.scene = slot.landingId;
    append(state, { heading: 'Back at Thames landing', location: 'London · Thames landing', time: timeOfVisit(state) }, choice, [
      'You take the short path down from the storehouse. Alice is still with the carter, and there is flour to load.',
    ]);
  } else {
    advanceAgenda(state, state.minute + 1);
    const scene = generatedScene(state);
    const { actor, facts, relationship } = actorContext(state, slot.actorId);
    if (choice === actions.help) {
      const passageId = append(state, { ...scene, heading: 'A sorted tally' }, choice, [
        'You read the marks while ' + actor.name + ' moves the sacks into order. The last two were counted twice.',
        '“That would have cost me a day’s wage,” ' + actor.name + ' says, and leaves you a clean place to stand.',
      ], [{
        kind: 'clue', topic: 'storehouse-help', title: 'The corrected tally',
        text: 'The clerk helped the porter compare the marks, and they found the last two sacks counted twice.',
        source: 'Counted with the porter at the storehouse', recipients: ['player', slot.actorId],
      }]);
      relationship.trust = 1;
      relationship.source = passageId;
    } else {
      const fact = facts.find(item => item.id === tallyFact.id);
      const passageId = append(state, { ...scene, heading: 'The guild tally' }, choice, [
        actor.name + ' sets the chalk beside the tally. “' + fact.text + ' What goes on elsewhere is out of my reckoning.”',
      ], [{ kind: 'clue', title: 'The guild tally', text: fact.text, source: fact.source }]);
      state.records.push({ type: 'fact-access', factId: fact.id, recipients: ['player'], source: fact.source, minute: state.minute, passageId });
    }
  }
  return true;
}
