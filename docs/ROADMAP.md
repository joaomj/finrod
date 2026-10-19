# Roadmap

Finrod is a personal AI assistant on the home server, reached through
Telegram. The project `AGENTS.md` was removed; this file is the phase index.

## Phases

| Phase | Document | State |
| --- | --- | --- |
| v0.3.0 Telegram assistant | [PRD-v030.md](PRD-v030.md) | Agreed, not implemented |
| V2 connectors (MCP, OAuth, approval-gated writes) | [V2-CONNECTORS.md](V2-CONNECTORS.md) | Sketch |
| V3 memory (portable second brain) | [V3-MEMORY.md](V3-MEMORY.md) | Sketch, intentionally imprecise |

Each phase must be useful on its own. V1 comes first. V2 comes second.

## Retired: v0.2.0 browser product

- The browser-only chat ([PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md),
  [BROWSER.md](BROWSER.md)) is retired in favor of the server product.
- Its browser history was test data and is disposable. There is no migration.
- Static hosting and the release flow in [RELEASING.md](RELEASING.md) and
  [OPERATIONS.md](OPERATIONS.md) describe the old product until replaced.
- [VALIDATION.md](VALIDATION.md) records v0.2.0 observations only.

## References

- [CHANGELOG.md](../CHANGELOG.md): user-facing changes per release.
