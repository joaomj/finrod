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

Finrod is a browser-only chat companion. Verify reliable daily use on the target phones.
The repository does not support a hosted conversation service or another delivery channel.
New delivery channels require explicit product approval.
Keep browser conversations and saved credentials local by default.
Static hosting distributes application files only; external inference and research remain separate privacy boundaries.

## Release delivery

Published, checked stable GitHub releases automatically deploy to the existing `finrod-preview` Cloudflare Pages project.
Keep `https://finrod-preview.pages.dev` stable so browser history and credentials stay on the same origin.
Do not deploy ordinary commits, PRs, older releases, drafts, or prereleases to production.
Creating or pushing release tags and publishing releases still require explicit user approval.
Manual uploads, retries, DNS changes, and changes to another host require separate approval.
Read `docs/RELEASING.md`, `docs/OPERATIONS.md`, and `docs/VALIDATION.md` for the active flow and its evidence.

## Implementation choices

Pi stays behind the chat interface. Its capabilities make functionality integration easier through extensions and Model Context Protocol (MCP) support.
Pi itself is not a product requirement. Users do not need to know or operate Pi.

The browser uses Pi agent-core and Pi MCP. Pi Durable and SQLite remain only for migrating earlier browser histories.
These are implementation facts, not permanent product constraints.
Reuse existing capabilities and repository conventions. Do not build a duplicate agent engine or plugin framework.
Evaluate changes against user outcomes, privacy, reliability, and maintenance cost, not loyalty to a particular runtime.
Runtime changes require a clear benefit to the product. Do not change the runtime merely to enforce a framework preference.

## Scope references

Read `docs/PRD.md` for browser behavior and phone acceptance.
Read `docs/ROADMAP.md` for future scope and `docs/ARCHITECTURE.md` for the current browser implementation.
Keep product requirements separate from implementation facts and unverified proposals.
