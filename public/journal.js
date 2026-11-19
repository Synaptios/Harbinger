import { workspace } from './app.js';

const mobile = window.matchMedia('(max-width: 40rem)');
const toggle = document.createElement('button');
toggle.type = 'button';
toggle.className = 'journal-toggle';
toggle.textContent = 'Journal';
toggle.hidden = true;
toggle.setAttribute('aria-expanded', 'false');
workspace.toolbar.append(toggle);
const topBar = workspace.toolbar.closest('.top-bar');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--journal-toolbar-height', topBar.offsetHeight + 'px');
}).observe(topBar);

const panel = workspace.panel;
panel.classList.add('journal-panel');
panel.setAttribute('aria-label', 'Journal');

const sheet = document.createElement('dialog');
sheet.id = 'journal-sheet';
sheet.className = 'journal-sheet';
sheet.setAttribute('aria-labelledby', 'journal-title');
document.body.append(sheet);

const content = document.createElement('div');
content.className = 'journal';
content.innerHTML = `
  <header class="journal-heading">
    <h2 id="journal-title">Journal</h2>
    <button class="journal-close" type="button" aria-label="Close Journal">Close</button>
  </header>
  <label class="journal-search">
    Search the Journal
    <input type="search" autocomplete="off" spellcheck="false">
  </label>
  <p class="journal-count" role="status" aria-label="Journal results"></p>
  <div class="journal-entries"></div>
  <form class="journal-notes">
    <label>
      Private notes
      <textarea rows="4" maxlength="4000"></textarea>
    </label>
    <button type="submit">Save notes</button>
    <p class="journal-note-status" role="status" aria-label="Notes status"></p>
  </form>
`;
const closeButton = content.querySelector('.journal-close');
const search = content.querySelector('input[type="search"]');
const count = content.querySelector('.journal-count');
const entries = content.querySelector('.journal-entries');
const notesForm = content.querySelector('.journal-notes');
const note = notesForm.querySelector('textarea');
const saveNotes = notesForm.querySelector('button');
const notesStatus = notesForm.querySelector('[role="status"]');
const categories = [
  ['People', ['person']],
  ['Places', ['place']],
  ['Clues', ['claim', 'clue']],
  ['Promises', ['promise']],
];
let open = false;
let readingOffset;
let currentId;
let notesLoaded = false;

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function sourceLink(entry, label, key) {
  const source = textElement('a', label + ' · ' + entry.source, 'journal-source');
  source.href = '#' + encodeURIComponent(entry.passageId);
  source.dataset.journalLink = key;
  source.addEventListener('click', event => {
    const passage = document.getElementById(entry.passageId);
    if (!passage) return;
    event.preventDefault();
    if (mobile.matches) setOpen(false, { focus: false });
    passage.focus({ preventScroll: true });
    passage.scrollIntoView({ block: 'start' });
  });
  return source;
}

function entryCard(entry, knownSources) {
  const article = document.createElement('article');
  article.className = 'journal-entry';
  const label = { reported: 'Reported', firsthand: 'Firsthand', disputed: 'Disputed' }[entry.status] ?? 'Account';
  const links = document.createElement('div');
  links.className = 'journal-sources';
  links.append(sourceLink(entry, 'View source', entry.id));
  const prior = knownSources.get(entry.supersedes);
  if (prior) links.append(sourceLink(prior, 'Prior account', entry.id + ':prior'));

  article.append(
    textElement('span', label, 'journal-label'),
    textElement('h4', entry.title),
    textElement('p', entry.text),
    links,
  );
  return article;
}

function render() {
  const save = workspace.save;
  toggle.hidden = !save;
  const query = search.value.trim().toLowerCase();
  const knownSources = new Map((save?.observations ?? []).map(item => [item.id, item]));
  const observations = [...knownSources.values()].filter(item =>
    [item.title, item.text, item.source, item.status].some(value => value?.toLowerCase().includes(query)),
  );
  const focused = document.activeElement?.dataset.journalLink;
  let resultCount = 0;
  const groups = categories.flatMap(([heading, kinds]) => {
    const known = observations.filter(item => kinds.includes(item.kind));
    if (!known.length) return [];
    resultCount += known.length;
    const section = document.createElement('section');
    section.append(textElement('h3', heading), ...known.map(entry => entryCard(entry, knownSources)));
    return section;
  });
  entries.replaceChildren(...groups);
  count.textContent = resultCount === 1 ? '1 entry' : resultCount + ' entries';
  if (focused) {
    const link = [...entries.querySelectorAll('[data-journal-link]')].find(item => item.dataset.journalLink === focused);
    (link ?? search).focus({ preventScroll: true });
  }
}

function layout() {
  if (mobile.matches) {
    panel.hidden = true;
    sheet.append(content);
    if (open && !sheet.open) sheet.showModal();
    if (!open && sheet.open) sheet.close();
  } else {
    if (sheet.open) sheet.close();
    panel.append(content);
    panel.hidden = !open;
  }
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-controls', mobile.matches ? sheet.id : panel.id);
}

async function syncSave() {
  const id = workspace.save?.id;
  if (id === currentId) {
    render();
    return;
  }
  currentId = id;
  notesLoaded = false;
  search.value = '';
  note.value = '';
  note.disabled = true;
  saveNotes.disabled = true;
  notesStatus.textContent = '';
  render();
  if (!id) return;
  try {
    const saved = await workspace.request('/api/saves/' + id + '/notes');
    if (id !== currentId) return;
    note.value = saved.note;
    notesLoaded = true;
    note.disabled = false;
    saveNotes.disabled = false;
  } catch (error) {
    if (id === currentId) notesStatus.textContent = error.message;
  }
}

function setOpen(value, { focus = true } = {}) {
  if (value && mobile.matches) readingOffset = window.scrollY;
  open = value;
  layout();
  if (!focus) return;
  (open && mobile.matches ? closeButton : toggle).focus({ preventScroll: true });
  if (!open && mobile.matches && readingOffset !== undefined) window.scrollTo(0, readingOffset);
}

toggle.addEventListener('click', () => setOpen(!open));
closeButton.addEventListener('click', () => setOpen(false));
sheet.addEventListener('cancel', event => {
  event.preventDefault();
  setOpen(false);
});
mobile.addEventListener('change', layout);
search.addEventListener('input', render);
notesForm.addEventListener('submit', async event => {
  event.preventDefault();
  const id = currentId;
  if (!id || !notesLoaded || saveNotes.disabled) return;
  const text = note.value;
  saveNotes.disabled = true;
  try {
    await workspace.request('/api/saves/' + id + '/notes', 'PUT', { note: text });
    if (id === currentId) notesStatus.textContent = note.value === text ? 'Notes saved.' : 'Earlier notes saved. Your latest edit remains here.';
  } catch (error) {
    if (id === currentId) notesStatus.textContent = error.message;
  } finally {
    if (id === currentId) saveNotes.disabled = false;
  }
});
window.addEventListener('harbinger:save', () => void syncSave());
layout();
void syncSave();
