import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHarbinger } from '../app/server.mjs';

export async function startApp(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-test-'));
  let server;
  const databasePath = join(directory, 'story.sqlite');
  const start = async (port = 0) => {
    server = createHarbinger({ databasePath, ...options });
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  return {
    url: await start(),
    async restart() {
      const { port } = server.address();
      await stop();
      return start(port);
    },
    async close() {
      await stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
