const mediaPlugins = ['harbinger-art', 'harbinger-voice'];
const sessionsPath = '/api/sessions';

function loopbackOrigin(baseUrl) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)
    || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the origin of the local Covel server.');
  }
  return url.origin;
}

async function call(origin, path, method = 'GET') {
  const response = await fetch(origin + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Covel returned HTTP ${response.status}.`);
  return response.json();
}

function shouldEnable(session, pluginId) {
  return session.worldId === 'bread-ledger' && session.status === 'active'
    && session.activePlugins?.includes('harbinger') && !session.activePlugins.includes(pluginId)
    && !session.metadata?.pluginSelection?.excluded?.includes(pluginId);
}

export async function adoptBreadLedgerMedia(baseUrl) {
  const origin = loopbackOrigin(baseUrl);
  const { items } = await call(origin, `${sessionsPath}?worldId=bread-ledger`);
  if (!Array.isArray(items)) throw new Error('Covel did not return a session list.');

  const updated = [];
  const failed = [];
  for (const entry of items) {
    const path = `${sessionsPath}/${encodeURIComponent(entry.id)}`;
    const enabled = [];
    for (const pluginId of mediaPlugins.filter(plugin => shouldEnable(entry, plugin))) {
      try {
        // Recheck saved preferences before the settled native activation.
        const session = await call(origin, path);
        if (!shouldEnable(session, pluginId)) continue;
        const result = await call(origin, `${path}/plugins/${pluginId}`, 'PUT');
        if (!result.activePluginIds?.includes(pluginId)) throw new Error('Covel did not activate the plugin.');
        enabled.push(pluginId);
      } catch (error) {
        failed.push({ sessionId: entry.id, pluginId, error: error.message });
      }
    }
    if (enabled.length) updated.push({ sessionId: entry.id, enabled });
  }
  return { updated, failed };
}
