---
version: 0.1.0
displayName: Illustrations
description: Generates art for locations and characters as the story reveals them.
contributes:
  settings:
    - key: automatic
      type: toggle
      label: Automatic illustrations
      default: true
    - key: quality
      type: select
      label: Image quality
      default: low
      options:
        - value: low
          label: Low
        - value: medium
          label: Medium
        - value: high
          label: High
  extensions:
    - point: ui.slot@1
      id: backdrop
      slot: stage.backdrop@1
      order: 20
      watch: [display, stage]
    - point: ui.slot@1
      id: cast
      slot: stage.cast@1
      order: 20
      watch: [stage]
    - point: ui.slot@1
      id: portraits
      slot: character.visual@1
      order: 20
      watch: [display]
  ui:
    right:
      - ./gallery.json
---

Illustrates accepted public scenes and the cast the player has met.
