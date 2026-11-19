import { readFileSync } from 'node:fs';
import { providerFromEnvironment } from '../app/model.mjs';
import { launchCovel } from './runtime.mjs';

if (!process.env.HINDSIGHT_URL) {
  try {
    const apiKey = readFileSync(new URL('../.harbinger/hindsight/api-key', import.meta.url), 'utf8').trim();
    if (apiKey) {
      process.env.HINDSIGHT_URL = 'http://127.0.0.1:8888';
      process.env.HINDSIGHT_API_KEY = apiKey;
    }
  } catch {
    // Local Hindsight is optional.
  }
}

const child = launchCovel({
  databasePath: process.env.HARBINGER_COVEL_DATABASE_PATH ?? '.harbinger/covel-story.sqlite',
  provider: providerFromEnvironment(),
  port: Number(process.env.HARBINGER_PORT ?? 4174),
  web: true,
  waitForProviders: true,
});

function stop() {
  if (child.exitCode === null && !child.killed) child.kill();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', code => {
  process.exitCode = code ?? (child.killed ? 0 : 1);
});
