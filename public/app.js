const opening = document.querySelector('#opening');
const story = document.querySelector('#story');
const passages = document.querySelector('#passages');
const choices = document.querySelector('#choices');
const composer = document.querySelector('#composer');
const action = document.querySelector('#action');
const status = document.querySelector('#status');
const jump = document.querySelector('#new-passage');
const begin = document.querySelector('#begin');
const retry = document.querySelector('#retry');

let currentSave;
let pending = false;
let failedTurn;

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
  if (follow && !document.querySelector('dialog[open]')) {
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
  if (currentSave?.id !== id) {
    action.value = localStorage.getItem('harbinger.draft.' + id) ?? '';
    await restoreTurn(save);
  }
  show(save, { follow: true });
}

async function restoreTurn(save) {
  failedTurn = undefined;
  retry.hidden = true;
  const key = 'harbinger.request.' + save.id;
  const stored = localStorage.getItem(key);
  if (!stored) return;
  let earlier;
  try {
    earlier = JSON.parse(stored);
  } catch {
    localStorage.removeItem(key);
    return;
  }
  if (save.revision > earlier.revision) {
    try {
      const receipt = await request('/api/saves/' + save.id + '/receipt?requestId=' + encodeURIComponent(earlier.requestId));
      localStorage.removeItem(key);
      if (receipt.committed && action.value === earlier.text) {
        action.value = '';
        localStorage.removeItem('harbinger.draft.' + save.id);
      }
      if (receipt.committed) status.textContent = 'Turn saved.';
      return;
    } catch {
      // The request can still be retried under its original ID.
    }
  }
  failedTurn = earlier;
  retry.hidden = false;
  status.textContent = 'The last turn has an unconfirmed response. You can retry it.';
}

function busy(busyState) {
  pending = busyState;
  for (const button of document.querySelectorAll('#choices button, #composer button')) button.disabled = busyState;
  window.dispatchEvent(new Event('harbinger:pending'));
}

async function submit(text, trigger) {
  if (pending || !text.trim()) return;
  const save = currentSave;
  const turn = failedTurn?.text === text && failedTurn?.saveId === save.id
    ? failedTurn
    : { text, revision: save.revision, requestId: crypto.randomUUID(), saveId: save.id };
  const recovering = turn === failedTurn;
  const requestKey = 'harbinger.request.' + save.id;
  localStorage.setItem(requestKey, JSON.stringify(turn));
  const follows = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 190;
  retry.hidden = true;
  busy(true);
  status.textContent = 'Resolving the turn…';
  try {
    let result = await request('/api/saves/' + save.id + '/turns', 'POST', {
      text, revision: turn.revision, requestId: turn.requestId,
    });
    if (recovering && !result.clarification) result = await request('/api/saves/' + save.id);
    failedTurn = undefined;
    localStorage.removeItem(requestKey);
    if (result.clarification) {
      status.textContent = result.clarification;
      return;
    }
    if (action.value === text) {
      action.value = '';
      localStorage.removeItem('harbinger.draft.' + save.id);
    }
    show(result, { follow: follows || Boolean(trigger) });
    status.textContent = 'Turn saved.';
  } catch (error) {
    failedTurn = turn;
    if (action.value === text || !action.value) {
      action.value = text;
      localStorage.setItem('harbinger.draft.' + save.id, text);
    }
    status.textContent = error.message;
    retry.hidden = false;
  } finally {
    busy(false);
  }
}

retry.addEventListener('click', () => {
  if (failedTurn) void submit(failedTurn.text, retry);
});

action.addEventListener('input', () => {
  if (currentSave) localStorage.setItem('harbinger.draft.' + currentSave.id, action.value);
});

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
