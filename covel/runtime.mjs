import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const checkout = join(project, '.harbinger', 'covel');
const node = join(project, '.harbinger', 'toolchain', 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');

export function launchCovel({ databasePath, provider, port = 0, web = false }) {
  const loaderPath = join(checkout, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  if (!existsSync(node) || !existsSync(loaderPath) || (web && !existsSync(join(checkout, 'dist', 'web', 'index.html')))) {
    throw new Error('Run npm run covel:setup before starting Harbinger on Covel.');
  }
  if (!provider?.url || !provider?.name) throw new Error('Set HARBINGER_MODEL_URL and HARBINGER_MODEL_NAME.');
  const sqlitePath = resolve(databasePath);
  return fork(join(checkout, 'apps', 'server', 'src', 'index.ts'), [], {
    cwd: checkout,
    execPath: node,
    execArgv: ['--import', pathToFileURL(loaderPath).href],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STORE_BACKEND: 'sqlite',
      SQLITE_PATH: sqlitePath,
      SERVER_PORT: String(port),
      SERVE_STATIC: String(web),
      STATIC_DIR: './dist/web',
      COVEL_BIND_HOST: '127.0.0.1',
      COVEL_HOME: join(dirname(sqlitePath), 'covel-home'),
      COVEL_PLUGINS_DIR: join(project, 'covel', 'plugins'),
      COVEL_WORLDS_DIR: join(project, 'covel', 'worlds'),
      HARBINGER_MODEL_URL: provider.url,
      HARBINGER_MODEL_NAME: provider.name,
      HARBINGER_MODEL_KEY: provider.key ?? '',
      HARBINGER_REASONING_EFFORT: provider.reasoningEffort ?? '',
    },
  });
}
