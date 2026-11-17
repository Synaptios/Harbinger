'use strict';

const saveKey = 'bellwether.campaign';
const modelKey = 'bellwether.model';
const element = id => document.getElementById(id);
const modelSelect = element('model-select');
const newGameButton = element('new-game');
const newGameDialog = element('new-game-dialog');
const log = element('turn-log');
const form = element('action-form');
const actionInput = element('action');
const actionButton = element('submit-action');
const suggestions = element('suggestions');
const retryLoad = element('retry-load');
let models = [];
let game;
let busy = false;
let pendingTurn;

function readPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

async function request(path, payload) {
  const options = payload === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  const response = await fetch(path, options);
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) {
    const error = new Error(value?.error || `The game server returned HTTP ${response.status}.`);
    error.status = response.status;
    error.code = value?.code;
    throw error;
  }
  return value;
}

function textElement(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function updateControls() {
  const ready = Boolean(game && modelSelect.value);
  newGameButton.disabled = busy || !models.length;
  modelSelect.disabled = busy || !models.some(model => model.available);
  actionInput.disabled = !ready;
  actionInput.readOnly = busy;
  actionButton.disabled = busy || !ready || !actionInput.value.trim();
  form.setAttribute('aria-busy', String(busy));
  for (const button of suggestions.children) button.disabled = busy || !ready;
}

function setFeedback(text = '', kind = '') {
  const message = element('action-message');
  message.textContent = text;
  message.dataset.kind = kind;
  element('key-hint').hidden = Boolean(text);
}

function selectedModel() {
  return models.find(model => model.id === modelSelect.value);
}

function renderModelInfo() {
  element('model-description').textContent = selectedModel()?.description ?? '';
}

function renderModels(preferred) {
  const options = models.map(model => {
    const option = new Option(model.available ? model.label : `${model.label} (unavailable)`, model.id);
    option.disabled = !model.available;
    return option;
  });
  modelSelect.replaceChildren(...options);
  const available = models.filter(model => model.available);
  modelSelect.value = available.find(model => model.id === readPreference(modelKey))?.id
    ?? available.find(model => model.id === preferred)?.id
    ?? available[0]?.id
    ?? '';
  renderModelInfo();
}

function renderTranscript(turns) {
  const fragment = document.createDocumentFragment();
  for (const turn of turns) {
    const entry = document.createElement('article');
    entry.className = 'turn';
    if (turn.action) {
      const player = textElement('p', '', 'player-action');
      player.append(textElement('span', 'Your action', 'entry-label'), document.createTextNode(turn.action));
      entry.append(player);
    }
    const narration = textElement('div', '', 'narration');
    narration.append(textElement('span', 'Game master', 'entry-label'));
    for (const paragraph of turn.narration.split(/\n\s*\n/)) {
      if (paragraph.trim()) narration.append(textElement('p', paragraph.trim()));
    }
    entry.append(narration);
    fragment.append(entry);
  }
  log.replaceChildren(fragment);
  log.setAttribute('aria-busy', 'false');
  log.scrollTop = log.scrollHeight;
}

function renderSuggestions(items) {
  suggestions.replaceChildren(...items.map(suggestion => {
    const button = textElement('button', suggestion, 'suggestion');
    button.type = 'button';
    button.addEventListener('click', () => {
      actionInput.value = suggestion;
      updateControls();
      actionInput.focus();
    });
    return button;
  }));
  suggestions.hidden = items.length === 0;
}

function renderJournalList(key, items, emptyText, format) {
  const rows = items.map(item => {
    const { title, detail, status } = format(item);
    const row = document.createElement('li');
    if (title) {
      const heading = textElement('div', '', 'journal-item-heading');
      heading.append(textElement('strong', title));
      if (status) heading.append(textElement('span', status, 'journal-status'));
      row.append(heading);
    }
    if (detail) row.append(textElement('p', detail));
    return row;
  });
  element(`${key}-count`).textContent = String(items.length);
  element(key).replaceChildren(...(rows.length ? rows : [textElement('li', emptyText, 'empty-journal')]));
}

function renderGame(value) {
  game = value;
  const lastTurn = game.turns.at(-1);
  const turnCounter = element('turn-counter');
  element('scene-name').textContent = game.scene.name;
  element('scene-detail').textContent = game.scene.detail;
  turnCounter.textContent = lastTurn?.number ? `Turn ${lastTurn.number}` : 'Opening scene';
  turnCounter.hidden = false;
  renderTranscript(game.turns);
  renderSuggestions(lastTurn?.suggestions ?? []);
  renderJournalList('threads', game.threads, 'No story threads yet.', item => ({ title: item.title, detail: item.detail, status: item.status }));
  renderJournalList('facts', game.facts, 'No confirmed facts yet.', item => ({ detail: item.text }));
  renderJournalList('claims', game.claims, 'No rumors heard yet.', item => ({ title: item.speaker, detail: item.text }));
  renderJournalList('cast', game.cast, 'No one met yet.', item => ({ title: item.name, detail: item.detail }));
  renderJournalList('inventory', game.inventory, 'You are carrying nothing.', item => ({ title: item.name, detail: item.detail }));
  element('save-status').textContent = savePreference(saveKey, game.id)
    ? 'Campaign saved · Resumes in this browser'
    : 'Campaign saved · Browser storage unavailable';
}

async function createGame() {
  const result = await request('/api/games', {});
  pendingTurn = undefined;
  actionInput.value = '';
  renderGame(result.game);
}

async function initialize() {
  if (busy) return;
  busy = true;
  retryLoad.hidden = true;
  updateControls();
  setFeedback();
  log.setAttribute('aria-busy', 'true');
  log.replaceChildren(textElement('p', 'Loading the campaign…', 'empty-message'));
  try {
    const config = await request('/api/models');
    models = config.models;
    renderModels(config.defaultModel);
    const savedId = readPreference(saveKey);
    if (savedId) {
      try {
        renderGame((await request(`/api/games/${encodeURIComponent(savedId)}`)).game);
        return;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    await createGame();
  } catch (error) {
    log.setAttribute('aria-busy', 'false');
    log.replaceChildren(textElement('p', 'The campaign could not be loaded.', 'empty-message'));
    setFeedback(error.message, 'error');
    retryLoad.hidden = false;
  } finally {
    busy = false;
    updateControls();
  }
}

async function startNewGame() {
  if (busy) return;
  busy = true;
  updateControls();
  setFeedback('Starting a new campaign…');
  try {
    await createGame();
    setFeedback();
    retryLoad.hidden = true;
    window.scrollTo(0, 0);
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    busy = false;
    updateControls();
  }
}

function createRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function submitAction(event) {
  event.preventDefault();
  const action = actionInput.value.trim();
  const model = selectedModel();
  if (busy || !game || !model || !action) return;
  const path = `/api/games/${encodeURIComponent(game.id)}`;
  if (!pendingTurn || pendingTurn.revision !== game.revision || pendingTurn.action !== action || pendingTurn.model !== model.id) {
    pendingTurn = { action, model: model.id, revision: game.revision, requestId: createRequestId() };
  }
  busy = true;
  updateControls();
  setFeedback('The game master is writing…');
  try {
    const result = await request(`${path}/turns`, pendingTurn);
    actionInput.value = '';
    pendingTurn = undefined;
    renderGame(result.game);
    setFeedback();
  } catch (error) {
    setFeedback(error.message, 'error');
    if (error.code === 'revision_conflict') {
      try {
        renderGame((await request(path)).game);
        setFeedback('The latest turn is loaded. Your action is still in the composer.', 'error');
      } catch {
        setFeedback('The campaign could not be refreshed. Reload this page to try again.', 'error');
      }
    }
  } finally {
    busy = false;
    updateControls();
  }
}

retryLoad.addEventListener('click', initialize);
modelSelect.addEventListener('change', () => {
  savePreference(modelKey, modelSelect.value);
  renderModelInfo();
  updateControls();
});
newGameButton.addEventListener('click', () => {
  if (!game) {
    startNewGame();
    return;
  }
  newGameDialog.returnValue = '';
  newGameDialog.showModal();
});
newGameDialog.addEventListener('close', () => {
  if (newGameDialog.returnValue === 'start') startNewGame();
});
actionInput.addEventListener('input', updateControls);
actionInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!actionButton.disabled) form.requestSubmit();
  }
});
form.addEventListener('submit', submitAction);
initialize();
