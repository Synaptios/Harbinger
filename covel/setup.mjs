import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
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

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
}

mkdirSync(data, { recursive: true });
if (!existsSync(checkout)) {
  run('git', ['clone', '--depth', '1', '--branch', 'v0.0.54', 'https://github.com/ackness/covel', checkout], data);
}
const installedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
if (installedCommit !== covelCommit) throw new Error(`Covel must be checked out at ${covelCommit}.`);

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Use npm run covel:setup.');
run(process.execPath, [npm, 'install', '--prefix', toolchain, '--no-audit', '--no-fund', 'node@26.12.1', 'pnpm@12.14.0'], data);
run(pnpm, ['--filter', '@covel/server...', '--filter', '@covel/web...', 'install', '--frozen-lockfile', '--ignore-scripts'], checkout);
run(node, ['scripts/ensure-plugin-sdk.mjs'], checkout);
run(pnpm, ['--filter', '@covel/web', 'exec', 'vite', 'build'], checkout);
