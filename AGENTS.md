# AGENTS.md

## Product direction

Finrod is an AI chat companion, not a coding platform or a general-purpose agent interface.
The target experience is close to ChatGPT's core chat experience, without its additional product surfaces.

- Keep conversation at the center: messages, replies, history, and capabilities that support chat.
- Keep necessary settings and recovery controls secondary to the conversation.
- Do not add Dots, Projects, Codex, Work, workspaces, task dashboards, terminals, or coding-platform controls.
- Product features define requirements. A framework's capabilities are not a reason to add product features.
- New interaction modes or separate product surfaces require explicit user approval.

## Delivery priority

Prioritize the browser chat experience and verify reliable daily use on the target phones.
Telegram is a delivery channel, not a product requirement.
Keep the existing Telegram installation working, but do not expand its feature scope.
Necessary maintenance and security fixes remain in scope.
Do not require Telegram feature parity before accepting the browser experience.
Decide whether to retire Telegram after daily browser use demonstrates comfort and reliability.
Telegram retirement is not approved. Preserve the existing installation and its data.

## Implementation choices

Pi runs in the background because it makes functionality integration easier through extensions and Model Context Protocol (MCP) support.
Pi itself is not a product requirement. Users do not need to know or operate Pi.

The current server uses Pi Durable. The current browser uses Pi agent-core and Pi MCP.
These are implementation facts, not permanent product constraints.
Reuse existing capabilities and repository conventions. Do not build a duplicate agent engine or plugin framework.
Evaluate changes against user outcomes, privacy, reliability, and maintenance cost, not loyalty to a particular runtime.
Runtime changes require a clear benefit to the product. Do not change the runtime merely to enforce a framework preference.

## Scope references

Read `docs/PHONE-PRD.md` for phone-local behavior and `docs/PRD.md` for the server release.
Read `docs/ROADMAP.md` for future scope and `docs/ARCHITECTURE.md` for the current server implementation.
Keep product requirements separate from implementation facts and unverified proposals.
