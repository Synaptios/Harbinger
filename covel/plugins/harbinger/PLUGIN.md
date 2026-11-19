---
version: 0.1.0
displayName: Harbinger
description: Resolves and narrates The Bread Ledger.
provides:
  - contract: narrative-engine@2
    default: true
conflicts:
  - narrative-engine@2
contributes:
  actions:
    - testing-view
    - capture-save
    - journal-note
---

The Bread Ledger resolves player attempts in the Malory world and publishes the accepted scene.
