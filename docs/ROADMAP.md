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

## Inference modes

Finrod runs in two modes. Default mode uses a fast remote provider with
zero data retention (ZDR). Private mode uses the local model on the home
server.

The user selects private mode when the matter is sensitive. All other
traffic uses default mode.

Local operation is the long-term aspiration. Remote remains the default
until local quality and speed on the home server match it.

## Local model decision

The local model is `LiquidAI/LFM2.5-1.2B-Instruct-GGUF`, file
`LFM2.5-1.2B-Instruct-QAD-Q4_0.gguf` (quantization-aware distillation,
Q4_0 format). Rerun files live in `~/finrod-eval` on the home server.

Evidence (measured 2026-10-19 on the home server, Intel i5-7500T with
4 threads, llama.cpp 8681 in rootless Podman): pt-BR chat is fluent at
about 36 tokens/s generation; forced tool calls emit valid JSON; a full
Exa web-search loop returned a correct pt-BR answer with sources.

The 2.6B QAD sibling volunteers tool calls and answers in more depth,
but it needs a 512+ token budget (long thinking prefix) and runs at
about 16 tokens/s. It stays an option, not the default.

Harness rules from the test: force the tool call
(`tool_choice: required`) on the 1.2B; give the 2.6B 512 or more
max tokens, or it returns silence.

## Retired: v0.2.0 browser product

- The browser-only chat ([PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md),
  [BROWSER.md](BROWSER.md)) is retired in favor of the server product.
- Its browser history was test data and is disposable. There is no migration.
- Static hosting and the release flow in [RELEASING.md](RELEASING.md) and
  [OPERATIONS.md](OPERATIONS.md) describe the old product until replaced.
- [VALIDATION.md](VALIDATION.md) records v0.2.0 observations only.

## References

- [CHANGELOG.md](../CHANGELOG.md): user-facing changes per release.
