import { workspace } from './app.js';

const button = document.createElement('button');
button.type = 'button';
button.className = 'testing-toggle';
button.textContent = 'Testing view';
button.setAttribute('aria-haspopup', 'dialog');
workspace.toolbar.append(button);

const dialog = document.createElement('dialog');
dialog.className = 'testing-dialog';
dialog.setAttribute('aria-labelledby', 'testing-title');
dialog.innerHTML = `
  <header class="testing-heading">
    <h2 id="testing-title">Testing view</h2>
    <button type="button" class="testing-close" aria-label="Close testing view">Close</button>
  </header>
  <p class="testing-warning"><strong>Story spoilers.</strong> This view includes private NPC thoughts and director decisions.</p>
  <button type="button" class="testing-reveal">Reveal private thoughts</button>
  <p class="testing-status" role="status" aria-label="Testing view status"></p>
  <label class="testing-sort" hidden>
    Sort turns
    <select>
      <option value="new">Newest first</option>
      <option value="old">Oldest first</option>
    </select>
  </label>
  <div class="testing-turns"></div>
`;
document.body.append(dialog);

const close = dialog.querySelector('.testing-close');
const reveal = dialog.querySelector('.testing-reveal');
const status = dialog.querySelector('.testing-status');
const sort = dialog.querySelector('.testing-sort');
const order = sort.querySelector('select');
const turns = dialog.querySelector('.testing-turns');
let snapshot;
let sourceSaveId;
let readingOffset;
let revealAttempt = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function thoughtCard(thought) {
  const article = element('article', undefined, 'testing-thought');
  article.setAttribute('aria-label', thought.name);
  const heading = element('header', undefined, 'testing-actor');
  heading.append(element('h4', thought.name), element('span', thought.presence === 'offstage' ? 'Offstage' : 'Onstage'));
  article.append(heading, element('blockquote', thought.text));
  if (thought.sources.length) {
    const sources = element('ul', undefined, 'testing-sources');
    for (const source of thought.sources) sources.append(element('li', source));
    article.append(element('h5', 'Sources'), sources);
  }
  return article;
}

function render() {
  const grouped = new Map();
  const group = turn => {
    if (!grouped.has(turn)) grouped.set(turn, { thoughts: [], directions: [] });
    return grouped.get(turn);
  };
  for (const thought of snapshot.thoughts) group(thought.turn).thoughts.push(thought);
  for (const direction of snapshot.directions) group(direction.turn ?? -1).directions.push(direction);
  const chronology = [...grouped].sort(([a], [b]) => order.value === 'new' ? b - a : a - b);
  const sections = chronology.map(([turn, info]) => {
    const name = turn < 0 ? 'Earlier turns' : turn === 0 ? 'Opening' : 'Turn ' + turn;
    const section = element('section', undefined, 'testing-turn');
    section.setAttribute('aria-label', name);
    section.append(element('h3', name), ...info.thoughts.map(thoughtCard));
    for (const direction of info.directions) {
      const reason = element('div', undefined, 'testing-direction');
      reason.append(element('h4', 'Director · ' + direction.situation), element('p', direction.reason));
      section.append(reason);
    }
    return section;
  });
  turns.replaceChildren(...sections);
}

function dismiss() {
  revealAttempt++;
  dialog.close();
  snapshot = undefined;
  turns.replaceChildren();
  sort.hidden = true;
  reveal.hidden = false;
  reveal.disabled = false;
  status.textContent = '';
  button.focus({ preventScroll: true });
  window.scrollTo(0, readingOffset);
}

button.addEventListener('click', () => {
  sourceSaveId = workspace.save?.id;
  if (!sourceSaveId) return;
  readingOffset = window.scrollY;
  order.value = 'new';
  dialog.showModal();
  reveal.focus({ preventScroll: true });
});
close.addEventListener('click', dismiss);
dialog.addEventListener('cancel', event => {
  event.preventDefault();
  dismiss();
});
reveal.addEventListener('click', async () => {
  const requestNumber = ++revealAttempt;
  reveal.disabled = true;
  status.textContent = 'Loading private thoughts…';
  try {
    const result = await workspace.request('/api/saves/' + sourceSaveId + '/testing');
    if (requestNumber !== revealAttempt) return;
    snapshot = result;
    render();
    reveal.hidden = true;
    sort.hidden = false;
    status.textContent = result.thoughts.length || result.directions.length ? '' : 'No thoughts or director decisions have been recorded.';
    order.focus({ preventScroll: true });
  } catch (error) {
    if (requestNumber !== revealAttempt) return;
    status.textContent = error.message;
    reveal.disabled = false;
  }
});
order.addEventListener('change', render);

function syncButton() {
  button.hidden = !workspace.save;
  if (dialog.open && workspace.save?.id !== sourceSaveId) dismiss();
}

window.addEventListener('harbinger:save', syncButton);
syncButton();
