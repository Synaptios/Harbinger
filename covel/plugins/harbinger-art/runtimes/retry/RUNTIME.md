---
description: Retries a failed illustration for an already disclosed subject.
schedule:
  trigger: { type: manual }
  background: true
function: { model: image, timeoutMs: 105000 }
effects:
  reads: [plugin-data:self:display]
  writes: [plugin-data:self:display, 'media:*']
---
