import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const covelCommit = '013ee2ccb7f58fdfb3f05157cf408ccb3e90d891';
const data = fileURLToPath(new URL('../.harbinger/', import.meta.url));
const checkout = join(data, 'covel');
const toolchain = join(data, 'toolchain');
const nodeBin = join(toolchain, 'node_modules', 'node', 'bin');
const pnpmDir = join(toolchain, 'node_modules', 'pnpm');
const suffix = process.platform === 'win32' ? '.exe' : '';
const node = join(nodeBin, 'node' + suffix);
const pnpm = join(pnpmDir, 'pnpm' + suffix);
const env = { ...process.env, PATH: [nodeBin, pnpmDir, process.env.PATH].join(delimiter) };

function run(command, args, cwd, commandEnv = env) {
  execFileSync(command, args, { cwd, env: commandEnv, stdio: 'inherit' });
}

mkdirSync(data, { recursive: true });
if (!existsSync(checkout)) {
  run('git', ['clone', '--depth', '1', '--branch', 'v0.0.54', 'https://github.com/ackness/covel', checkout], data);
}
const installedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
if (installedCommit !== covelCommit) throw new Error(`Covel must be checked out at ${covelCommit}.`);

// The earlier server patch also installed a legacy Settings API. Update only
// its exact generated files so setup can upgrade an existing Covel checkout.
function retireLegacySettingsRoute(patch, isApplied) {
  const route = 'apps/server/src/routes/harbinger-config.ts';
  const access = 'apps/server/tests/bootstrap/route-access.test.ts';
  const test = 'apps/server/tests/harbinger-config.test.ts';
  const replacedFiles = [
    [route, 'd1bbc147b65dbab981c5892f2ee2551ac0d99316'],
    [access, '72aaa6999e1ed43cb86b644a2e59df609065e2e0'],
    [test, 'f758da6ab1badf051dab420184c354053ebf4ab5'],
  ];
  if (!isApplied(replacedFiles.map(([path]) => '--exclude=' + path))) return;
  const git = args => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
  if (!replacedFiles.every(([path, hash]) => existsSync(join(checkout, path))
      && git(['hash-object', '--path=' + path, path]) === hash)) return;

  run('git', ['restore', '--source=HEAD', '--worktree', '--', access], checkout);
  unlinkSync(join(checkout, route));
  unlinkSync(join(checkout, test));
  run('git', ['apply', '--include=' + route, '--include=' + access, patch], checkout);
}

const patchesPath = fileURLToPath(new URL('./patches/', import.meta.url));
for (const name of readdirSync(patchesPath).filter(name => name.endsWith('.patch')).sort()) {
  const patch = fileURLToPath(new URL(`./patches/${name}`, import.meta.url));
  const isApplied = (filters = []) => spawnSync('git', ['apply', '--reverse', '--check', ...filters, patch], {
    cwd: checkout, stdio: 'ignore',
  }).status === 0;
  if (isApplied()) continue;
  if (name === 'harbinger-server.patch') retireLegacySettingsRoute(patch, isApplied);
  if (!isApplied()) run('git', ['apply', patch], checkout);
}

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Use npm run covel:setup.');
run(process.execPath, [npm, 'install', '--prefix', toolchain, '--no-audit', '--no-fund', 'node@26.12.1', 'pnpm@12.14.0'], data);
run(pnpm, ['--filter', '@covel/server...', '--filter', '@covel/web...', 'install', '--frozen-lockfile', '--ignore-scripts'], checkout);
run(node, ['scripts/ensure-plugin-sdk.mjs'], checkout);
run(pnpm, ['--filter', '@covel/web', 'exec', 'vite', 'build'], checkout, {
  ...env,
  VITE_HARBINGER_SETTINGS: 'true',
});
