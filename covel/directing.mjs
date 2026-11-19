const decisionBudgetMs = 6000;

function fixedSlot(gateway, id, fallbackTag) {
  if (!gateway) return;
  const presetId = `slot-${id}`;
  try {
    if (gateway.resolveSlot({ presetId, fallbackTag })?.presetId === presetId) return presetId;
  } catch {
    // A missing or unusable optional role leaves authored behavior available.
  }
}

export function complexStateRole(gateway) {
  if (!gateway) return;
  try {
    const id = gateway.resolveSlot({ presetId: 'state' })?.presetId;
    if (id === 'slot-state-ultra' || id?.startsWith('harbinger-tier-state-ultra-')) {
      return fixedSlot(gateway, 'state-complex', 'text') ? 'state-complex' : undefined;
    }
  } catch {
    // Use the ordinary State path when the tier is unavailable.
  }
}

export function inspectionDirector(gateway, turnSignal, noteStall, { waitForProviders, noteWait } = {}) {
  const triggerSlot = fixedSlot(gateway, 'triggers', 'evaluation');
  const stagingSlot = fixedSlot(gateway, 'staging', 'text');
  if (!triggerSlot && !stagingSlot) return;
  return async ({ locationId, options }) => {
    const signal = waitForProviders ? turnSignal : AbortSignal.any([turnSignal, AbortSignal.timeout(decisionBudgetMs)]);
    const state = { locationId, options };
    async function run(operation, call) {
      const started = performance.now();
      let completed = false;
      try {
        const value = await call();
        completed = true;
        return value;
      } catch (error) {
        if (signal.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError' || error?.code === 'TIMEOUT') {
          noteStall?.(operation);
        }
        throw error;
      } finally {
        const durationMs = Math.round(performance.now() - started);
        if (durationMs >= decisionBudgetMs) noteWait?.({
          operation, thresholdMs: decisionBudgetMs, durationMs, outcome: completed ? 'completed' : 'failed',
        });
      }
    }
    const [trigger, staging] = await Promise.allSettled([
      triggerSlot && run('director-trigger', () => gateway.evaluate?.({
        presetId: triggerSlot,
        state,
        questions: { opportunity: {
          type: 'choice',
          instructions: 'Pick an available way for the player to encounter the missed inspection. Both options preserve their freedom to read the order or leave.',
          criteria: Object.fromEntries(options.map(({ id, title }) => [id, title])),
        } },
        signal,
      })),
      stagingSlot && run('director-staging', () => gateway.generateObject({
        presetId: stagingSlot,
        system: 'Choose what should get the reader’s attention when they encounter a missed inspection. Choose evidence to distinguish what the player sees from what they must still verify, or cost to foreground the work the closure interrupts.',
        prompt: JSON.stringify(state),
        schema: { type: 'object', properties: { focus: { type: 'string', enum: ['evidence', 'cost'] } }, required: ['focus'], additionalProperties: false },
        signal,
      })),
    ]);
    return {
      choice: trigger.status === 'fulfilled' ? trigger.value?.answers?.opportunity?.choice : undefined,
      focus: staging.status === 'fulfilled' ? staging.value?.object?.focus : undefined,
    };
  };
}
