---
description: Synthesizes the committed story outside the turn.
schedule:
  stage: post-turn
  needs: [{ contract: narrative-engine@2 }]
  detached: { maxQueueMs: 120000, maxExecutionMs: 240000 }
io:
  inputs:
    story:
      from: { contract: narrative-engine@2 }
      required: false
function: { model: speech, timeoutMs: 240000 }
effects:
  reads: ['media:*']
  writes: [plugin-data:self:audio, plugin-data:self:source, 'media:*']
---
