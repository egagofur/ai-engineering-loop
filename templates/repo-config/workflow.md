# Loop Overlay

This file adds hooks around the AI Engineering Loop. It does not replace the 8-stage OS.

## Required (cannot skip)
- Goal Contract
- verification
- Devil's Advocate
- Judge

## Hooks
- **before_grill**: none
- **after_freeze**: none
- **after_pass**: none

## Optional skips
none

Allowed optional skips: `blast_radius` (when the change is not business logic), `generate_adapter` (when adapter.md already exists).
Do not list Goal Contract, verification, Devil's Advocate, or Judge here.
