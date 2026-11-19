const opening = document.querySelector('#opening');
const story = document.querySelector('#story');
const passages = document.querySelector('#passages');
const choices = document.querySelector('#choices');
const composer = document.querySelector('#composer');
const action = document.querySelector('#action');
const status = document.querySelector('#status');
const jump = document.querySelector('#new-passage');
const begin = document.querySelector('#begin');

let currentSave;
let pending = false;

export const workspace = {
  toolbar: document.querySelector('#workspace-tools'),
  panel: document.querySelector('#workspace-panel'),
  get save() { return currentSave; },
  get pending() { return pending; },
  openSave,
  request,
};

export async function request(path, method = 'GET', data) {
  const options = { method };
  if (data !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  }
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? 'The app could not finish that action.');
  return body;
}

function make(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function show(save, { follow = false } = {}) {
  const sameSave = currentSave?.id === save.id;
  currentSave = save;
  localStorage.setItem('harbinger.active', save.id);
  opening.hidden = true;
  story.hidden = false;
  composer.hidden = save.ended;
  document.querySelector('#save-name').textContent = save.name;
  document.querySelector('#scene-location').textContent = save.scene.location + ' / ' + save.scene.time;
  if (!sameSave) passages.replaceChildren();
  for (const passage of save.passages.slice(passages.children.length)) {
    const article = make('article', null, 'passage');
    article.id = passage.id;
    article.tabIndex = -1;
    article.append(make('p', passage.time, 'passage-time'), make('h2', passage.heading));
    if (passage.playerText) article.append(make('p', passage.playerText, 'played-action'));
    for (const paragraph of passage.paragraphs) article.append(make('p', paragraph));
    passages.append(article);
  }
  choices.replaceChildren(...save.choices.map(label => {
    const button = make('button', label, 'suggestion');
    button.type = 'button';
    button.disabled = pending;
    button.addEventListener('click', () => void submit(label, button));
    return button;
  }));
  if (follow) {
    const latest = passages.lastElementChild;
    latest?.focus({ preventScroll: true });
    latest?.scrollIntoView({ block: 'start' });
    jump.hidden = true;
  } else if (sameSave && passages.lastElementChild) {
    jump.href = '#' + passages.lastElementChild.id;
    jump.hidden = false;
  }
  window.dispatchEvent(new Event('harbinger:save'));
}

async function openSave(id) {
  const save = await request('/api/saves/' + id);
  if (currentSave?.id !== id) action.value = '';
  show(save, { follow: true });
}

function busy(busyState) {
  pending = busyState;
  for (const button of document.querySelectorAll('#choices button, #composer button')) button.disabled = busyState;
  window.dispatchEvent(new Event('harbinger:pending'));
}

async function submit(text, trigger) {
  if (pending || !text.trim()) return;
  const save = currentSave;
  const follows = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 190;
  busy(true);
  status.textContent = 'Resolving the turn…';
  try {
    const result = await request('/api/saves/' + save.id + '/turns', 'POST', {
      text, revision: save.revision, requestId: crypto.randomUUID(),
    });
    if (result.clarification) {
      status.textContent = result.clarification;
      return;
    }
    if (action.value === text) action.value = '';
    show(result, { follow: follows || Boolean(trigger) });
    status.textContent = 'Turn saved.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy(false);
  }
}

composer.addEventListener('submit', event => {
  event.preventDefault();
  void submit(action.value);
});

begin.addEventListener('click', async () => {
  begin.disabled = true;
  try {
    show(await request('/api/saves', 'POST', {}), { follow: true });
  } catch (error) {
    status.textContent = error.message;
  } finally {
    begin.disabled = false;
  }
});

const active = localStorage.getItem('harbinger.active');
if (active) {
  await openSave(active).catch(error => {
    status.textContent = error.message;
  });
}
