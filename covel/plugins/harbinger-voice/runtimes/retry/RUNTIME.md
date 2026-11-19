---
description: Renders missing narration for a committed passage.
schedule:
  trigger: { type: manual }
  background: true
function: { model: speech, timeoutMs: 240000 }
effects:
  reads: [plugin-data:self:audio, plugin-data:self:source, 'media:*']
  writes: [plugin-data:self:audio, plugin-data:self:source, 'media:*']
---
