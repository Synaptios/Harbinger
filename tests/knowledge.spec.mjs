import { expect, test } from '@playwright/test';
import { startApp } from './app-fixture.mjs';

async function openStory(request, url) {
  const response = await request.post(`${url}/api/saves`, { data: {} });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function play(request, url, save, text) {
  const response = await request.post(`${url}/api/saves/${save.id}/turns`, {
    data: { text, revision: save.revision, requestId: `knowledge-${save.revision}` },
  });
  expect(response.ok()).toBe(true);
  const next = await response.json();
  expect(next.revision).toBe(save.revision + 1);
  return next;
}

const lastWords = save => save.passages.at(-1).paragraphs.join(' ');

test('Alice and Martin respond differently to the proclamation they heard', async ({ request }) => {
  const app = await startApp();
  try {
    let save = await openStory(request, app.url);
    save = await play(request, app.url, save, 'Ask Alice about the proclamation');
    expect(lastWords(save)).toContain('Ink and a loud voice cost less than a witness.');
    save = await play(request, app.url, save, 'Ask Martin about the proclamation');
    expect(lastWords(save)).toContain('I take a sealed notice seriously.');
    expect(lastWords(save)).toContain('The proclamation says he fell against Launcelot.');
    expect(save.observations.filter(item => item.kind === 'claim').every(item => item.status === 'reported')).toBe(true);
    expect(JSON.stringify(save)).not.toContain('Mordred commissioned');
  } finally {
    await app.close();
  }
});

test('a witnessed disclosure changes Martin’s account and Alice remembers who kept her confidence', async ({ request }) => {
  const app = await startApp();
  try {
    const prepare = async () => {
      let save = await openStory(request, app.url);
      save = await play(request, app.url, save, 'Promise Alice discretion');
      save = await play(request, app.url, save, 'Ask Alice what brought Guenever to London');
      expect(lastWords(save)).toContain('She took refuge in the Tower');
      return save;
    };
    let trusted = await prepare();
    let broken = await prepare();
    trusted = await play(request, app.url, trusted, 'Keep Alice’s confidence');
    broken = await play(request, app.url, broken, 'Tell Martin what Alice said about the Queen');

    await app.restart();
    const reload = async save => (await request.get(`${app.url}/api/saves/${save.id}`)).json();
    trusted = await play(request, app.url, await reload(trusted), 'Ask Martin what brought Guenever to London');
    broken = await play(request, app.url, await reload(broken), 'Ask Martin what brought Guenever to London');
    expect(lastWords(trusted)).toContain('Wedding supplies are the only business I have on record.');
    expect(lastWords(broken)).toContain('I’ll enter the Tower as the clerk’s account.');

    trusted = await play(request, app.url, trusted, 'Ask Alice about your promise');
    broken = await play(request, app.url, broken, 'Ask Alice about your promise');
    expect(lastWords(trusted)).toContain('You kept your word when Martin pressed you.');
    expect(lastWords(broken)).toContain('I heard you tell him.');
    expect(lastWords(broken)).not.toContain('The blue loaf wakes at low tide');
    expect(trusted.observations.some(item => item.kind === 'promise' && item.source === 'Conversation with Alice')).toBe(true);
  } finally {
    await app.close();
  }
});

test('alternate versions and future news stay separate from timely, authorized evidence', async ({ request }) => {
  const app = await startApp();
  try {
    let save = await openStory(request, app.url);
    save = await play(request, app.url, save, 'Ask Martin whether Arthur has reached Dover');
    expect(lastWords(save)).toContain('Dover has sent no account I can enter.');
    expect(lastWords(save)).not.toContain('Arthur has landed at Dover');
    save = await play(request, app.url, save, 'Promise Alice discretion');
    save = await play(request, app.url, save, 'Ask Alice what brought Guenever to London');
    save = await play(request, app.url, save, 'Ask Alice whether Guenever married Mordred');
    expect(lastWords(save)).toContain('She went to the Tower.');
    save = await play(request, app.url, save, 'Keep Alice’s confidence');
    save = await play(request, app.url, save, 'Go with Alice to the river');
    expect(JSON.stringify(save)).not.toContain('The blue loaf wakes at low tide');
    expect(JSON.stringify(save)).not.toContain('Mordred commissioned');

    save = await play(request, app.url, save, 'Ask Alice about the carter’s words');
    const shared = save.observations.find(item => item.text.includes('The blue loaf wakes at low tide'));
    expect(shared).toMatchObject({ source: 'Alice at the landing', status: 'reported' });
    expect(shared.passageId).toBe(save.passages.at(-1).id);
    save = await play(request, app.url, save, 'Read the carter’s sealed statement');
    expect(lastWords(save)).toContain('I saw Mordred commission the letters');
    expect(save.observations.some(item => item.source === 'Signed statement carried from the Tower')).toBe(true);
  } finally {
    await app.close();
  }
});
