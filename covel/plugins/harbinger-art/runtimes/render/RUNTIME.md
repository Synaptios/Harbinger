---
description: Illustrates new places and characters after the turn commits.
schedule: { stage: post-turn, detached: true }
presentation: { budget: { calls: 4, generations: 4 } }
io:
  inputs:
    story:
      from: { contract: narrative-engine@2 }
      required: false
function: { model: image, timeoutMs: 380000 }
effects:
  reads: [plugin-data:self:display, plugin-data:self:stage]
  writes: [plugin-data:self:display, plugin-data:self:stage, 'media:*']
---
