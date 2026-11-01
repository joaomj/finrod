# Roadmap

Finrod is a personal AI assistant on the home server, used as a web app
over the tailnet. This file is the phase index.

## Phases

| Phase | Document | State |
| --- | --- | --- |
| v0.3.0 home-server web app | [PRD-v030.md](PRD-v030.md) | Built, not released |
| Post-v0.3.0 UX: voice, continuous stream, multiple users, encryption at rest | [UX-DIRECTION.md](UX-DIRECTION.md) | Direction |
| V2 connectors (MCP, OAuth, approval-gated writes) | [V2-CONNECTORS.md](V2-CONNECTORS.md) | Sketch |
| V3 memory (portable second brain) | [V3-MEMORY.md](V3-MEMORY.md) | Sketch, intentionally imprecise |

Each phase must be useful on its own. V1 comes first. V2 comes second.

## Inference modes

Finrod runs in two modes. Default mode uses a fast remote provider with
zero data retention (ZDR). Private mode uses the local model on the home
server.

The user selects private mode when the matter is sensitive. All other
traffic uses default mode.

Private mode is not part of v0.3.0. It comes in a later release.

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

## Rules in code, not in the prompt

Models do not follow prompt rules reliably. Each rule in
`server/prompts/finrod.md` should move to code when code can enforce
it. pi-durable has the hooks for this (`beforeRequest`, `onYield`,
`beforeTool`, `afterTool` in `harness/types.d.ts`).

| Prompt rule | Enforcement in code | State |
| --- | --- | --- |
| Do not announce a lookup ("let me check") | The server hides text written just before a tool call | Done |
| Know the date and time | The `clock` tool (`server/clock.ts`) | Done |
| Cite sources as links | The server attaches sources from the search results; delete the rule | Next |
| Remember lasting facts, one per memory, without mentioning it | A separate cheap model call after each user message returns a JSON list of facts. The chat model loses the `remember` tool. | Next |
| Avoid wide tables on a phone | The app scrolls tables sideways, or the server turns them into lists | Next |
| Search for current facts instead of answering from memory | `onYield`: if the answer used no tool and a cheap classifier says it needs fresh data, nudge the model to search | Only if seen in real use; one extra call per answer |
| No filler and no closing offers | `onYield`: a cheap classifier flags them and a nudge asks for a rewrite | Only if seen in real use; one extra call when triggered |
| Read words in their everyday sense ("tempo" means weather) | None found; stays in the prompt | Prompt only |

Observed 2026-11-01 with `deepseek/deepseek-v4.1-flash-1017`: the model
replied "Anotado" after a memory and saved two facts as one memory,
against the prompt.

## Retired: v0.2.0 browser product

- The browser-only chat is retired in favor of the server product. Its
  documents are in [retired/](retired/).
- Its browser history was test data and is disposable. There is no migration.

## References

- [CHANGELOG.md](../CHANGELOG.md): user-facing changes per release.
