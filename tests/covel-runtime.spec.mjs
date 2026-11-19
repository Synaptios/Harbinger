import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { expect, test } from '@playwright/test';
import { launchCovel } from '../covel/runtime.mjs';

test.skip(!process.env.HARBINGER_TEST_COVEL, 'Run the Covel suite with HARBINGER_TEST_COVEL=1.');

async function startRuntime(info, options) {
  await mkdir(info.outputDir, { recursive: true });
  return launchCovel({
    databasePath: info.outputPath('story.sqlite'),
    provider: { url: 'http://127.0.0.1:1/v1/responses', name: 'runtime-fixture' },
    ...options,
  });
}

test('Covel reports a listening origin and repeated stops share shutdown', async ({}, info) => {
  const runtime = await startRuntime(info);
  try {
    const origin = await runtime.ready;
    const response = await fetch(`${origin}/api/sessions`, { signal: AbortSignal.timeout(5_000) });
    expect(response.ok).toBe(true);
    await response.body.cancel();

    const shutdown = runtime.stop();
    expect(runtime.stop()).toBe(shutdown);
    expect(await shutdown).toBe(await runtime.closed);
    await expect(fetch(`${origin}/api/sessions`, { signal: AbortSignal.timeout(5_000) })).rejects.toThrow();
  } finally {
    await runtime.stop();
  }
});

test('Covel rejects readiness and stops the child at the startup deadline', async ({}, info) => {
  const runtime = await startRuntime(info, { readyTimeoutMs: 1 });
  try {
    await expect(runtime.ready).rejects.toThrow('Covel did not become ready in time.');
    expect(await runtime.closed).toMatchObject({ signal: 'SIGTERM' });
  } finally {
    await runtime.stop();
  }
});

test('Covel rejects readiness when the child exits before opening its port', async ({}, info) => {
  const occupied = createServer();
  let runtime;
  try {
    occupied.listen({ host: '127.0.0.1', port: 0, exclusive: true });
    await once(occupied, 'listening');
    runtime = await startRuntime(info, { port: occupied.address().port });

    await expect(runtime.ready).rejects.toThrow('Covel stopped before becoming ready');
    const result = await runtime.closed;
    expect(result.code).toBeGreaterThan(0);
    expect(await runtime.stop()).toBe(result);
  } finally {
    await runtime?.stop();
    if (occupied.listening) await new Promise(resolve => occupied.close(resolve));
  }
});
