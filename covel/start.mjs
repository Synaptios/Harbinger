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

const runtime = launchCovel({
  databasePath: process.env.HARBINGER_COVEL_DATABASE_PATH ?? '.harbinger/covel-story.sqlite',
  provider: providerFromEnvironment(),
  port: Number(process.env.HARBINGER_PORT ?? 4174),
  web: true,
  waitForProviders: true,
});

let stopping = false;
function stop() {
  stopping = true;
  runtime.stop();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
let startupError;
try {
  await runtime.ready;
} catch (error) {
  if (!stopping) startupError = error;
}
const { code, error } = await runtime.closed;
const failure = startupError ?? error;
if (failure) console.error(failure.message);
if (error || (failure && !code)) process.exitCode = 1;
else process.exitCode = code ?? (stopping ? 0 : 1);
