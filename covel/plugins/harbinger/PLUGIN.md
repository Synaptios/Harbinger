---
version: 0.1.0
displayName: Harbinger
description: Resolves and narrates The Bread Ledger.
provides:
  - narrative-engine@2
conflicts:
  - narrative-engine@2
contributes:
  actions:
    - testing-view
    - capture-save
    - journal-note
  ui:
    right:
      - ./ui/journal.json
      - ./ui/testing.json
---

The Bread Ledger resolves player attempts in the Malory world and publishes the accepted scene.
