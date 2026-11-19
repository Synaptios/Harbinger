---
version: 0.1.0
displayName: Narration
description: Reads accepted story passages in narrator and character voices.
contributes:
  settings:
    - key: automatic
      type: toggle
      label: Generate narration automatically
      default: true
    - key: narrator
      type: text
      label: Narrator voice
      default: Dennis
    - key: cast
      type: text
      label: "Cast voices (Name=Voice, Name=Voice)"
      default: Alice=Ashley
  ui:
    right:
      - ./narration.json
---

Choose the speech model in AI Roles. Inworld voice IDs are case sensitive.
