import { workspace } from './app.js';

const libraryButton = document.createElement('button');
libraryButton.className = 'saves-trigger';
libraryButton.type = 'button';
libraryButton.textContent = 'Saves';
libraryButton.setAttribute('aria-haspopup', 'dialog');
workspace.toolbar.append(libraryButton);

const library = document.createElement('dialog');
library.className = 'save-library';
library.setAttribute('aria-labelledby', 'save-library-heading');
library.innerHTML = `
  <div class="save-library-heading">
    <h2 id="save-library-heading">Save library</h2>
    <button type="button" data-close autofocus>Close</button>
  </div>
  <ul class="save-list" aria-label="Local saves"></ul>
  <div class="save-library-controls">
    <button type="button" data-duplicate>Duplicate current save</button>
  </div>
  <div class="save-library-transfer">
    <a data-export hidden>Export complete save (includes hidden state)</a>
    <a data-story hidden>Export shareable story</a>
    <label for="save-import">Import complete save</label>
    <input id="save-import" type="file" accept=".json,application/json">
  </div>
  <p class="save-library-status" role="status"></p>
`;
document.body.append(library);

const list = library.querySelector('.save-list');
const duplicate = library.querySelector('[data-duplicate]');
const completeExport = library.querySelector('[data-export]');
const storyExport = library.querySelector('[data-story]');
const importInput = library.querySelector('#save-import');
const saveStatus = library.querySelector('.save-library-status');
let saveList = [];
let working = false;

function syncControls() {
  const waitForTurn = workspace.pending;
  duplicate.disabled = !workspace.save || waitForTurn || working;
  importInput.disabled = waitForTurn || working;
  for (const [link, file] of [[completeExport, 'export'], [storyExport, 'story']]) {
    link.hidden = !workspace.save;
    if (duplicate.disabled) {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
    } else {
      link.href = '/api/saves/' + workspace.save.id + '/' + file;
      link.removeAttribute('aria-disabled');
    }
  }
  for (const button of list.querySelectorAll('button')) button.disabled = waitForTurn || working;
}

function renderList() {
  list.replaceChildren(...saveList.map(save => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = save.name;
    if (save.id === workspace.save?.id) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => void run(async () => {
      await workspace.openSave(save.id);
      library.close();
    }));
    item.append(button);
    return item;
  }));
  syncControls();
}

async function refresh() {
  saveList = await workspace.request('/api/saves');
  renderList();
}

async function run(operation) {
  if (working) return;
  working = true;
  syncControls();
  try {
    await operation();
  } catch (error) {
    saveStatus.textContent = error.message;
  } finally {
    working = false;
    syncControls();
  }
}

libraryButton.addEventListener('click', () => {
  library.showModal();
  saveStatus.textContent = '';
  void run(refresh);
});

library.querySelector('[data-close]').addEventListener('click', () => library.close());
duplicate.addEventListener('click', () => void run(async () => {
  const save = await workspace.request('/api/saves/' + workspace.save.id + '/duplicate', 'POST', {});
  await refresh();
  saveStatus.textContent = 'Created ' + save.name + '.';
}));
importInput.addEventListener('change', () => void run(async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  if (file.size > 16 * 1024 * 1024) throw new Error('The selected save is too large to import.');
  let bundle;
  try {
    bundle = JSON.parse(await file.text());
  } catch {
    throw new Error('Choose a valid Harbinger complete save.');
  }
  const save = await workspace.request('/api/saves/import', 'POST', bundle);
  await refresh();
  saveStatus.textContent = 'Imported ' + save.name + '.';
}));
window.addEventListener('harbinger:pending', syncControls);
window.addEventListener('harbinger:save', () => {
  if (library.open) renderList();
});
