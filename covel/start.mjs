import { providerFromEnvironment } from '../app/model.mjs';
import { launchCovel } from './runtime.mjs';

const child = launchCovel({
  databasePath: process.env.HARBINGER_COVEL_DATABASE_PATH ?? '.harbinger/covel-story.sqlite',
  provider: providerFromEnvironment(),
  port: Number(process.env.HARBINGER_PORT ?? 4174),
  web: true,
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
