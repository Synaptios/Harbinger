const byId = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const settingsKey = 'harbinger.stage-settings.v1';
const phases = ['source', 'reasoning', 'fusion'];

let story;
let stages = [];
let memory = {};
let characterId = '';
let eventId = '';
let chatHistory = [];
let turnState;
let chatPending = false;
let buildPending = '';
let buildStatus;
let settings = readSettings();

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function activateTab(tab, moveFocus = false) {
  for (const candidate of tabs) {
    const active = candidate === tab;
    candidate.setAttribute('aria-selected', String(active));
    candidate.tabIndex = active ? 0 : -1;
    byId(candidate.getAttribute('aria-controls')).hidden = !active;
  }
  const inSettings = phases.includes(tab.id.slice('tab-'.length));
  byId('catalog').hidden = !inSettings;
  byId('settings-status').hidden = !inSettings || !byId('settings-status').textContent;
  if (moveFocus) tab.focus();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const destinations = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!Object.hasOwn(destinations, event.key)) return;
    event.preventDefault();
    activateTab(tabs[destinations[event.key]], true);
  });
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.error || `The server returned HTTP ${response.status}.`);
    error.stage = data?.stage;
    throw error;
  }
  return data;
}

function errorMessage(error) {
  const stage = stages.find((candidate) => candidate.id === error.stage);
  return stage ? `${stage.label} · ${error.message}` : error.message;
}

function notice(id, message = '', isError = false) {
  const node = byId(id);
  node.textContent = message;
  node.hidden = !message;
  node.classList.toggle('error', isError);
}

function eventLabel(event) {
  return event.when ? `${event.title} · ${event.when}` : event.title;
}

function pages(sourcePages) {
  if (!sourcePages?.length) return '';
  return `${sourcePages.length === 1 ? 'p.' : 'pp.'} ${sourcePages.join(', ')}`;
}

function fillSelect(id, options, selected) {
  const select = byId(id);
  select.replaceChildren(...options.map(({ id, label }) => new Option(label, id)));
  select.value = selected;
}

async function loadStory() {
  byId('bootstrap-notice').hidden = false;
  byId('retry-bootstrap').hidden = true;
  notice('bootstrap-status', 'Loading the story…');
  try {
    const result = await api('/api/bootstrap');
    story = result.story;
    stages = result.stages;
    memory = result.memory;
    characterId = story.characters.find((character) => /^Angela\b/i.test(character.name))?.id
      || story.characters[0]?.id || '';
    eventId = story.events.at(-1)?.id || '';
    const characters = story.characters.map(({ id, name }) => ({ id, label: name }));
    fillSelect('chat-character', characters, characterId);
    fillSelect('memory-character', characters, characterId);
    fillSelect('chat-event', story.events.map((event) => ({ id: event.id, label: eventLabel(event) })), eventId);
    byId('header-story').textContent = story.title;
    byId('download-story').disabled = false;
    renderStory();
    renderStages();
    updatePerspective();
    updateControls();
    byId('bootstrap-notice').hidden = true;
  } catch (error) {
    notice('bootstrap-status', `Couldn’t load the story. ${errorMessage(error)}`, true);
    byId('retry-bootstrap').hidden = false;
  }
}

function currentCharacter() {
  return story?.characters.find((character) => character.id === characterId);
}

function updatePerspective() {
  const character = currentCharacter();
  const event = story.events.find((candidate) => candidate.id === eventId);
  byId('chat-heading').textContent = character?.name || 'Conversation';
  byId('chat-subheading').textContent = event ? `As of ${eventLabel(event)}` : '';
  byId('event-context').textContent = pages(event?.sourcePages);
  byId('empty-transcript').textContent = character ? `Ask ${character.name} about the story.` : 'Choose a character and ask about the story.';
  renderMemory();
}

function canCompose() {
  return Boolean(characterId && eventId && !chatPending && buildPending !== characterId);
}

function updateControls() {
  byId('chat-character').disabled = !story?.characters.length || chatPending;
  byId('memory-character').disabled = byId('chat-character').disabled;
  byId('chat-event').disabled = !story?.events.length || chatPending;
  byId('new-chat').disabled = !characterId || !eventId || chatPending;
  byId('message').disabled = !canCompose();
  byId('send-message').disabled = !canCompose() || !byId('message').value.trim();
  byId('send-message').textContent = chatPending ? 'Sending…' : 'Send';
  byId('build-memory').disabled = !characterId || Boolean(buildPending) || chatPending;
  byId('build-memory').textContent = buildPending ? 'Building…' : 'Build memory';
}

function resetConversation() {
  chatHistory = [];
  turnState = undefined;
  byId('message').value = '';
  byId('transcript').replaceChildren(byId('empty-transcript'));
  byId('empty-transcript').hidden = false;
  notice('chat-status');
  updateControls();
}

function selectCharacter(id) {
  if (chatPending || id === characterId) return;
  characterId = id;
  byId('chat-character').value = characterId;
  byId('memory-character').value = characterId;
  resetConversation();
  updatePerspective();
}

function appendList(parent, items) {
  if (!items.length) return;
  const list = element('ul');
  for (const item of items) list.append(element('li', item));
  parent.append(list);
}

function traceList(details, label, items) {
  if (!items.length) return;
  details.append(element('p', label, 'trace-label'));
  appendList(details, items);
}

function renderTrace(trace) {
  const details = element('details');
  details.append(element('summary', 'Evidence and reasoning'));
  if (trace.grounded) details.append(element('p', 'The reply was grounded in retrieved memory.'));
  else if (trace.grounded === false) details.append(element('p', 'The reasoning steps returned insufficient evidence.'));
  if (trace.pattern) {
    details.append(element('p', 'Retrieved pattern', 'trace-label'), element('p', trace.pattern.label || trace.pattern.id));
  }
  traceList(details, 'Retrieved scenes', (trace.scenes || []).map((scene) => scene.title || scene.id));
  traceList(details, 'Retrieved facts', (trace.facts || []).map((fact) => fact.text || fact.id));
  traceList(details, 'Retrieval rounds', (trace.rounds || []).map((round) => {
    const added = Array.isArray(round.added) ? round.added.length : round.added;
    const summary = Number.isFinite(added) ? `${added} added` : '';
    const sufficiency = typeof round.sufficient === 'boolean'
      ? (round.sufficient ? 'evidence sufficient' : 'more evidence needed') : '';
    return [round.probe, summary, sufficiency].filter(Boolean).join(' · ');
  }));
  return details;
}

function appendMessage(role, content, trace) {
  const article = element('article', undefined, `message message-${role}`);
  const speaker = role === 'user' ? 'You' : currentCharacter()?.name || 'Character';
  article.append(element('h3', speaker), element('p', content, 'message-text'));
  if (trace) article.append(renderTrace(trace));
  byId('empty-transcript').hidden = true;
  const transcript = byId('transcript');
  transcript.append(article);
  transcript.scrollTop = transcript.scrollHeight;
  return article;
}

async function sendMessage(event) {
  event.preventDefault();
  const input = byId('message');
  const content = input.value.trim();
  if (!content || !canCompose()) return;

  chatPending = true;
  updateControls();
  const pendingMessage = appendMessage('user', content);
  notice('chat-status', `${currentCharacter().name} is preparing a reply…`);
  try {
    const result = await api('/api/chat', {
      characterId,
      eventId,
      message: content,
      history: chatHistory.slice(-10),
      state: turnState,
      settings: settingsForRequest(),
    });
    turnState = result.state;
    chatHistory.push({ role: 'user', content }, { role: 'assistant', content: result.reply });
    input.value = '';
    appendMessage('assistant', result.reply, result.trace);
    notice('chat-status');
  } catch (error) {
    pendingMessage.remove();
    byId('empty-transcript').hidden = Boolean(chatHistory.length);
    notice('chat-status', `Couldn’t send the message. ${errorMessage(error)}`, true);
  } finally {
    chatPending = false;
    updateControls();
    if (!byId('panel-chat').hidden) input.focus();
  }
}

function renderMemory() {
  const counts = memory[characterId] || {};
  const fields = [['Episodes', counts.episodes], ['Facts', counts.facts], ['Patterns', counts.patterns]];
  byId('memory-counts').replaceChildren(...fields.map(([label, value]) => {
    const row = element('div');
    const count = Array.isArray(value) ? value.length : value ?? 0;
    row.append(element('dt', label), element('dd', count));
    return row;
  }));
  if (buildPending) {
    const name = story.characters.find((character) => character.id === buildPending)?.name;
    notice('build-status', `Building memory for ${name}. This may take a few minutes.`);
  } else if (buildStatus?.characterId === characterId) {
    notice('build-status', buildStatus.text, buildStatus.error);
  } else {
    notice('build-status');
  }
}

async function buildMemory() {
  if (!characterId || buildPending || chatPending) return;
  const requestedCharacter = characterId;
  const name = currentCharacter().name;
  buildPending = requestedCharacter;
  renderMemory();
  updateControls();
  try {
    const result = await api('/api/memory/build', { characterId: requestedCharacter, settings: settingsForRequest() });
    memory[requestedCharacter] = result.memory;
    buildStatus = { characterId: requestedCharacter, text: `Memory built for ${name}.` };
    if (characterId === requestedCharacter) {
      resetConversation();
      notice('chat-status', 'Memory was rebuilt. Started a new conversation.');
    }
  } catch (error) {
    buildStatus = { characterId: requestedCharacter, text: `Couldn’t build memory. ${errorMessage(error)}`, error: true };
  } finally {
    buildPending = '';
    renderMemory();
    updateControls();
  }
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([, config]) => (
      config && typeof config.model === 'string' && (config.prompt == null || typeof config.prompt === 'string')
    )));
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    notice('settings-status');
  } catch {
    notice('settings-status', 'Browser storage is unavailable. Settings will reset when this page closes.', true);
  }
}

function settingsForRequest() {
  const overrides = stages.map((stage) => {
    const override = settings[stage.id];
    const config = { model: override?.model?.trim() || stage.defaultModel };
    if (stage.kind === 'generation' && override?.prompt?.trim()) config.prompt = override.prompt;
    return [stage.id, config];
  });
  return Object.fromEntries(overrides);
}

function renderStages() {
  for (const phase of phases) {
    const cards = stages.filter((stage) => stage.phase === phase).map(renderStage);
    byId(`stages-${phase}`).replaceChildren(...cards);
  }
}

function renderStage(stage) {
  const card = element('article', undefined, 'card stage-card');
  const heading = element('div', undefined, 'stage-title');
  const reset = element('button', 'Reset to defaults', 'text-button');
  reset.type = 'button';
  reset.setAttribute('aria-label', `Reset ${stage.label} to defaults`);
  heading.append(element('h3', stage.label), reset);
  card.append(heading, element('p', stage.description));

  const modelField = element('div', undefined, 'stage-field');
  const modelLabel = element('label', stage.kind === 'embedding' ? 'Embedding model' : 'Model');
  const model = element('input');
  const modelHint = element('p', `Default model · ${stage.defaultModel}`, 'hint');
  model.type = 'text';
  model.id = `model-${stage.id}`;
  model.maxLength = 180;
  modelHint.id = `model-hint-${stage.id}`;
  modelLabel.htmlFor = model.id;
  model.spellcheck = false;
  model.autocomplete = 'off';
  model.placeholder = stage.defaultModel;
  model.setAttribute('list', `${stage.kind}-models`);
  model.setAttribute('aria-describedby', modelHint.id);
  model.value = typeof settings[stage.id]?.model === 'string' ? settings[stage.id].model : stage.defaultModel;
  modelField.append(modelLabel, model, modelHint);
  card.append(modelField);

  let prompt;
  if (stage.kind === 'generation') {
    const promptField = element('div', undefined, 'stage-field');
    const promptLabel = element('label', 'System prompt');
    prompt = element('textarea');
    prompt.id = `prompt-${stage.id}`;
    promptLabel.htmlFor = prompt.id;
    prompt.rows = 8;
    prompt.maxLength = 16000;
    prompt.placeholder = 'Uses the default prompt when empty. Use Reset to defaults to restore its text.';
    prompt.value = typeof settings[stage.id]?.prompt === 'string' ? settings[stage.id].prompt : stage.defaultPrompt || '';
    promptField.append(promptLabel, prompt);
    card.append(promptField);
  }

  const save = () => {
    settings[stage.id] = { model: model.value };
    if (prompt && prompt.value !== stage.defaultPrompt) settings[stage.id].prompt = prompt.value;
    saveSettings();
  };
  model.addEventListener('input', save);
  prompt?.addEventListener('input', save);
  reset.addEventListener('click', () => {
    delete settings[stage.id];
    model.value = stage.defaultModel;
    if (prompt) prompt.value = stage.defaultPrompt || '';
    saveSettings();
  });
  return card;
}

async function loadModels() {
  const reload = byId('reload-models');
  reload.disabled = true;
  notice('catalog-status', 'Loading model choices…');
  try {
    const { models, providers, errors } = await api('/api/models');
    const providerNames = { openai: 'OpenAI', openrouter: 'OpenRouter' };
    for (const kind of ['generation', 'embedding']) {
      const choices = models.filter((model) => model.kind === kind).map((model) => {
        const option = element('option');
        option.value = model.id;
        option.label = `${model.label || model.id} · ${providerNames[model.provider] || model.provider}`;
        return option;
      });
      byId(`${kind}-models`).replaceChildren(...choices);
    }
    const configured = Object.entries(providerNames).filter(([id]) => providers[id]).map(([, name]) => name);
    const count = models.length === 1 ? '1 model choice' : `${models.length} model choices`;
    const availability = configured.length ? [count, ...configured].join(' · ') : 'No API providers configured';
    notice('catalog-status', [availability, ...(errors || []), 'You can also enter a model ID.'].join('. '), Boolean(errors?.length));
  } catch (error) {
    notice('catalog-status', `Couldn’t load model choices. ${errorMessage(error)} You can still enter a model ID.`, true);
  } finally {
    reload.disabled = false;
  }
}

function named(items, id) {
  return items.find((item) => item.id === id)?.name || id;
}

function storySection(label, items, summary, fill) {
  if (!items.length) return null;
  const section = element('section', undefined, 'story-section');
  section.append(element('h3', label));
  for (const item of items) {
    const details = element('details');
    const entry = element('div', undefined, 'story-entry');
    if (item.summary) entry.append(element('p', item.summary));
    fill(entry, item);
    if (item.sourcePages?.length) entry.append(element('p', pages(item.sourcePages), 'hint'));
    details.append(element('summary', summary(item)), entry);
    section.append(details);
  }
  return section;
}

function renderStory() {
  byId('story-heading').textContent = story.title;
  byId('story-source').textContent = story.source?.filename || '';
  const { characters, locations, events } = story;
  const counts = [
    `${characters.length} ${characters.length === 1 ? 'character' : 'characters'}`,
    `${locations.length} ${locations.length === 1 ? 'location' : 'locations'}`,
    `${events.length} ${events.length === 1 ? 'event' : 'events'}`,
  ];
  const chronology = storySection('Chronology', events, eventLabel, (entry, event) => {
    if (event.locationIds?.length) {
      entry.append(element('p', `Locations · ${event.locationIds.map((id) => named(locations, id)).join(', ')}`, 'hint'));
    }
    if (event.participants?.length) {
      entry.append(element('p', `Present · ${event.participants.map((id) => named(characters, id)).join(', ')}`, 'hint'));
    }
    if (event.knowledge?.length) {
      entry.append(element('p', 'What characters know', 'entry-heading'));
      appendList(entry, event.knowledge.map(({ statement, visibleTo, route, evidence }) => {
        const audience = visibleTo?.map((id) => named(characters, id)).join(', ');
        const method = route?.replaceAll('_', ' ');
        const source = Array.isArray(evidence) ? evidence.join(', ') : evidence;
        const detail = [audience, method, source].filter(Boolean).join(' · ');
        return detail ? `${statement} (${detail})` : statement;
      }));
    }
  });
  const cast = storySection('Characters', characters, (character) => character.name, (entry, character) => {
    if (character.aliases?.length) entry.append(element('p', `Also known as ${character.aliases.join(', ')}`, 'hint'));
  });
  const places = storySection('Locations', locations, (location) => location.name, () => {});
  const content = byId('story-content');
  content.classList.add('story-content');
  content.replaceChildren(element('p', counts.join(' · '), 'story-summary'), ...[chronology, cast, places].filter(Boolean));
  if (story.openThreads?.length) {
    const threads = element('section', undefined, 'story-section');
    threads.append(element('h3', 'Open threads'));
    appendList(threads, story.openThreads.map((thread) => (
      typeof thread === 'string' ? thread : [thread.title, thread.summary, pages(thread.sourcePages)].filter(Boolean).join(' · ')
    )));
    content.append(threads);
  }
}

function downloadStory() {
  const blob = new Blob([JSON.stringify(story, null, 2), '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = 'story.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

byId('chat-character').addEventListener('change', (event) => selectCharacter(event.target.value));
byId('memory-character').addEventListener('change', (event) => selectCharacter(event.target.value));
byId('chat-event').addEventListener('change', (event) => {
  if (chatPending || event.target.value === eventId) return;
  eventId = event.target.value;
  resetConversation();
  updatePerspective();
});
byId('new-chat').addEventListener('click', () => {
  resetConversation();
  if (canCompose()) byId('message').focus();
});
byId('message').addEventListener('input', updateControls);
byId('message').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!byId('send-message').disabled) byId('composer').requestSubmit();
});
byId('composer').addEventListener('submit', sendMessage);
byId('build-memory').addEventListener('click', buildMemory);
byId('download-story').addEventListener('click', downloadStory);
byId('reload-models').addEventListener('click', loadModels);
byId('retry-bootstrap').addEventListener('click', loadStory);

loadStory();
loadModels();
