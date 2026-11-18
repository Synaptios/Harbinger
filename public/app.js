'use strict';

const find = (id) => document.getElementById(id);
const settings = find('settings');
const modelSearch = find('model-search');
const modelSelect = find('model-select');
const modelStatus = find('model-status');
const catalogErrors = find('catalog-errors');
const reloadModels = find('reload-models');
const systemPrompt = find('system-prompt');
const newChat = find('new-chat');
const transcript = find('transcript');
const emptyState = find('empty-state');
const form = find('chat-form');
const chatInput = find('chat-input');
const sendMessage = find('send-message');
const chatStatus = find('chat-status');
const chatError = find('chat-error');

const providerNames = { openai: 'OpenAI', openrouter: 'OpenRouter' };
const modelKey = 'harbinger.model';
const promptKey = 'harbinger.systemPrompt';
let models = [];
let selectedKey = readPreference(modelKey) ?? '';
let messages = [];
let loadingModels = true;
let sending = false;

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
  } catch {
    // Settings still work when browser storage is unavailable.
  }
}

async function request(path, body) {
  const options = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || `Request failed (HTTP ${response.status}).`);
  }
  return data;
}

function modelValue(model) {
  return `${model.provider}:${model.id}`;
}

function selectable(model) {
  return model.available && model.chat;
}

function selectedModel() {
  return models.find((model) => modelValue(model) === selectedKey && selectable(model));
}

function updateControls() {
  const ready = Boolean(selectedModel());
  chatInput.disabled = !ready;
  chatInput.readOnly = sending;
  sendMessage.disabled = !ready || sending || !chatInput.value.trim();
  sendMessage.textContent = sending ? 'Sending…' : 'Send';
  newChat.disabled = sending || (!messages.length && !chatInput.value);
  form.setAttribute('aria-busy', String(sending));
}

function modelOption(model) {
  const label = model.label === model.id ? model.id : `${model.label} · ${model.id}`;
  let suffix = '';
  if (!model.chat) suffix = ' (non-chat)';
  else if (!model.available) suffix = ' (unavailable)';
  const option = new Option(label + suffix, modelValue(model));
  option.disabled = !selectable(model);
  return option;
}

function renderModels() {
  const query = modelSearch.value.trim().toLowerCase();
  const terms = query.split(/\s+/);
  const matching = models.filter((model) => {
    const description = `${providerNames[model.provider]} ${model.id} ${model.label}`.toLowerCase();
    return terms.every((term) => description.includes(term));
  });
  const current = selectedModel();
  const groups = [];

  if (current && !matching.includes(current)) {
    const group = document.createElement('optgroup');
    group.label = 'Current selection';
    group.append(modelOption(current));
    groups.push(group);
  }

  for (const [provider, label] of Object.entries(providerNames)) {
    const entries = matching.filter((model) => model.provider === provider);
    if (!entries.length) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    group.append(...entries.map(modelOption));
    groups.push(group);
  }

  if (!current) {
    const placeholder = loadingModels ? 'Loading models…' : 'No chat model available';
    groups.unshift(new Option(placeholder, ''));
  }

  modelSelect.replaceChildren(...groups);
  modelSelect.value = current ? modelValue(current) : '';
  modelSelect.disabled = loadingModels || !current;
  modelSearch.disabled = loadingModels || !models.length;
  const count = matching.filter(selectable).length;
  if (query) {
    modelStatus.textContent = count === 0 ? 'No matching chat models' :
      `${count} matching chat ${count === 1 ? 'model' : 'models'}`;
  } else {
    modelStatus.textContent = current ? `${providerNames[current.provider]} · ${current.id}` : '';
  }
  updateControls();
}

function showCatalogErrors(errors) {
  const items = errors.map((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  });
  catalogErrors.replaceChildren(...items);
  catalogErrors.hidden = !items.length;
  reloadModels.hidden = !items.length && models.some(selectable);
}

async function loadModels() {
  loadingModels = true;
  reloadModels.disabled = true;
  renderModels();

  try {
    const data = await request('/api/models');
    if (!Array.isArray(data.models)) throw new Error('The server returned an invalid model list.');
    models = data.models.filter((model) => Object.hasOwn(providerNames, model.provider));

    if (!selectedModel()) {
      const first = models.find(selectable);
      selectedKey = first ? modelValue(first) : '';
    }

    const errors = Object.entries(providerNames).flatMap(([provider, label]) =>
      data.errors?.[provider] ? [`${label}: ${data.errors[provider]}`] : []);
    showCatalogErrors(errors);
  } catch (error) {
    showCatalogErrors([error.message]);
  } finally {
    loadingModels = false;
    reloadModels.disabled = false;
    if (!models.some(selectable)) settings.open = true;
    renderModels();
  }
}

function showChatError(message = '') {
  chatError.textContent = message;
}

function appendMessage(message) {
  const entry = document.createElement('article');
  entry.className = 'message';
  entry.dataset.role = message.role;

  const speaker = document.createElement('h3');
  speaker.textContent = message.role === 'user' ? 'You' : 'Assistant';
  const body = document.createElement('p');
  body.textContent = message.content;

  entry.append(speaker, body);
  emptyState.hidden = true;
  transcript.append(entry);
  transcript.scrollTop = entry.offsetTop - 24;
  return entry;
}

modelSearch.addEventListener('input', renderModels);
modelSelect.addEventListener('change', () => {
  selectedKey = modelSelect.value;
  savePreference(modelKey, selectedKey);
  renderModels();
});
reloadModels.addEventListener('click', loadModels);

systemPrompt.value = readPreference(promptKey) ?? '';
systemPrompt.addEventListener('input', () => savePreference(promptKey, systemPrompt.value));

chatInput.addEventListener('input', updateControls);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    if (!sendMessage.disabled) form.requestSubmit();
  }
});

newChat.addEventListener('click', () => {
  messages = [];
  transcript.replaceChildren(emptyState);
  emptyState.hidden = false;
  chatInput.value = '';
  chatStatus.textContent = 'New chat started.';
  showChatError();
  updateControls();
  chatInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const model = selectedModel();
  const draft = chatInput.value;
  const content = draft.trim();
  if (!model || !content || sending) return;

  const userMessage = { role: 'user', content };
  const pendingEntry = appendMessage(userMessage);
  chatInput.value = '';
  sending = true;
  chatStatus.textContent = 'Waiting for a response.';
  showChatError();
  updateControls();

  try {
    const data = await request('/api/chat', {
      provider: model.provider,
      model: model.id,
      system: systemPrompt.value,
      messages: [...messages, userMessage],
    });
    if (typeof data.message !== 'string' || !data.message.trim()) {
      throw new Error('The model returned an empty reply.');
    }
    const reply = { role: 'assistant', content: data.message };
    messages.push(userMessage, reply);
    appendMessage(reply);
  } catch (error) {
    pendingEntry.remove();
    emptyState.hidden = messages.length > 0;
    chatInput.value = draft;
    showChatError(error.message);
  } finally {
    sending = false;
    chatStatus.textContent = '';
    updateControls();
  }
});

settings.open = !window.matchMedia('(max-width: 720px)').matches;
loadModels();
