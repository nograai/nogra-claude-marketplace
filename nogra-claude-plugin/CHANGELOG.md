# Changelog

## 0.1.0-beta - 2026-05-18

- Added Nogra dispatch scope-shaping guidance for one-run, phased and review
  execution choices without turning execution shapes into hard enums.
- Added optional brief `executionShape.toolFamilies` guidance so adapter tools
  can follow Manager-authored toolbank families without requiring a
  provider-tool enum.
- Added the local ledger helper for safe `.nogra/` writes, terminal run
  finalization and consistency checks.
- Added statusline support for active local transport runs without provider
  polling or synthetic heartbeats.
- Added smoke checks for routing, ledger consistency and statusline rendering.
- Added marketplace metadata for author, license, homepage and repository.
