# V2 sketch: connectors

**Status:** sketch. This file records direction, not requirements. V1 (Telegram chat on the home server) comes first.

## Result

Finrod reaches outside tools through connectors. The maintainer wires each connector in code. The user only completes authentication.

## Decisions so far

- Transport is Model Context Protocol (MCP) behind the scenes. The user never sees MCP.
- OAuth is the preferred authentication method.
- Web search is enabled by default and needs no user key. Most providers offer a free tier.
- Later connectors include Gmail and Google Drive. Order is open.
- Each person holds separate credentials and separate connector access. No cross-read between profiles.
- Reads run freely. Sends, posts, bookings, and purchases need explicit user approval in chat.

## Open questions

- How OAuth completes on a headless server (login on the phone, callback to the server).
- Where per-user tokens live on the server and how they stay separate.
- Which connector comes first after web search.
- How the assistant asks for approval for write actions.

## Non-goals

- No general plugin store or dynamic tool discovery.
- No shared credentials between people.
- No silent sends, posts, or purchases.

## Relation to other phases

- V1 provides the Telegram surface and raw logs. V2 adds reach.
- V3 (memory) may record which connector supplied which fact.
