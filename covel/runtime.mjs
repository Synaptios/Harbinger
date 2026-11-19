import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configureNativeStory } from './native-model-config.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const checkout = join(project, '.harbinger', 'covel');
const node = join(project, '.harbinger', 'toolchain', 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');

export function launchCovel({ databasePath, provider, port = 0, web = false, reportStalls = false, waitForProviders = reportStalls }) {
  const loaderPath = join(checkout, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  if (!existsSync(node) || !existsSync(loaderPath) || (web && !existsSync(join(checkout, 'dist', 'web', 'index.html')))) {
    throw new Error('Run npm run covel:setup before starting Harbinger on Covel.');
  }
  if (!provider?.url || !provider?.name) throw new Error('Set HARBINGER_MODEL_URL and HARBINGER_MODEL_NAME.');
  const sqlitePath = resolve(databasePath);
  const env = {
    ...process.env,
    HARBINGER_MODEL_URL: provider.url,
    HARBINGER_MODEL_NAME: provider.name,
    HARBINGER_MODEL_KEY: provider.key ?? '',
    HARBINGER_REASONING_EFFORT: provider.reasoningEffort ?? '',
    HARBINGER_MODEL_SETTINGS_MODULE: new URL('./model-settings.mjs', import.meta.url).href,
    HARBINGER_RATED_STORY_MODULE: web ? new URL('./safety.mjs', import.meta.url).href : '',
    HARBINGER_STORY_MEMORY_MODULE: web ? new URL('./story-memory.mjs', import.meta.url).href : '',
    HARBINGER_PROVIDER_ROUTES_MODULE: new URL('./provider-routes.mjs', import.meta.url).href,
    HARBINGER_MODEL_SETTINGS_PATH: `${sqlitePath}.model-settings.json`,
    HARBINGER_NATIVE_STORY_ROLE: '',
    HARBINGER_BENCHMARK_STALLS: reportStalls ? '1' : '',
    HARBINGER_WAIT_FOR_PROVIDERS: waitForProviders ? '1' : '',
  };
  return fork(join(checkout, 'apps', 'server', 'src', 'index.ts'), [], {
    cwd: checkout,
    execPath: node,
    execArgv: ['--import', pathToFileURL(loaderPath).href],
    env: {
      ...env,
      ...(web ? configureNativeStory(sqlitePath, env) : {}),
      NODE_ENV: 'production',
      HARBINGER_NATIVE_STUDIO: web ? '1' : '',
      STORE_BACKEND: 'sqlite',
      SQLITE_PATH: sqlitePath,
      SERVER_PORT: String(port),
      SERVE_STATIC: String(web),
      STATIC_DIR: './dist/web',
      COVEL_BIND_HOST: '127.0.0.1',
      COVEL_MEDIA_TOKEN_SECRET: env.COVEL_MEDIA_TOKEN_SECRET?.trim() || randomBytes(32).toString('base64url'),
      COVEL_HOME: join(dirname(sqlitePath), 'covel-home'),
      COVEL_PLUGINS_DIR: join(project, 'covel', 'plugins'),
      COVEL_WORLDS_DIR: join(project, 'covel', 'worlds'),
    },
  });
}
