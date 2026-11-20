# Roadmap

Finrod is a personal AI assistant on the home server. The user talks to it
in Element over the tailnet. This file lists what comes next, in order.
[CHANGELOG.md](../CHANGELOG.md) records what has shipped.

## Near term

### Subscriptions as model providers

Finrod answers through the Claude subscription with
[pi-claude-directsdk](https://github.com/joaomj/pi-claude-directsdk).
Other subscriptions come later, one at a time.

Open: the Claude Code login is a file on the server's disk, unlike
Finrod's other secrets.

### Long voice notes

Test a voice note of several minutes against the 5-minute transcription
timeout (`TRANSCRIBE_TIMEOUT_MS` in `server/voice.ts`). Only short notes
have been tested.

## Medium term

### Files

Accept files sent in Element: PDF and plain text first. Finrod reads
them in the conversation, and the memory wiki can ingest them as raw
sources.

### Image generation

Generate images on request with an OpenRouter image model, and send them
back as Element images. Choose the model by measured quality and cost.

### Second user

Add a second user with their own Finrod core. The gateway sends each user's direct room to that user's core. Nothing is
shared between the cores: not chats, memories, or credentials.

## Far future: private mode

Private mode is for sensitive matters. In private mode:

- The local model on the home server answers. Nothing leaves the server.
- Finrod reads no memories and writes none.
- Finrod keeps no conversation log.

Default mode stays on remote models until local quality and speed on
the home server match them.

### Local model decision

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

## Ongoing: rules in code, not in the prompt

Models do not follow prompt rules reliably. Each rule in
`server/prompts/finrod.md` should move to code when code can enforce
it. pi-durable has the hooks for this (`beforeRequest`, `onYield`,
`beforeTool`, `afterTool` in `harness/types.d.ts`).

| Prompt rule | Enforcement in code | State |
| --- | --- | --- |
| Cite sources as links | The server attaches sources from the search results; delete the rule | Next |
| Avoid wide tables on a phone | The server turns tables into lists before it sends to Element | Next |
| Search for current facts instead of answering from memory | `onYield`: if the answer used no tool and a cheap classifier says it needs fresh data, nudge the model to search | Only if seen in real use; one extra call per answer |
| No filler and no closing offers | `onYield`: a cheap classifier flags them and a nudge asks for a rewrite | Only if seen in real use; one extra call when triggered |
| Read words in their everyday sense ("tempo" means weather) | None found; stays in the prompt | Prompt only |
