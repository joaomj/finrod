# V3 sketch: memory (second brain)

**Status:** sketch, intentionally imprecise. V1 comes first. V2 comes second.

## Result

Finrod remembers the user across chats. Memory is portable, auditable, traceable, and private.

## Decisions so far

- Open-source components only. No closed memory service.
- Memory lives on the home server as files the user can read, edit, delete, and export.
- Every memory traces back to the conversation it came from.
- V1 raw logs are the source material. They need stable message identifiers so V3 can cite them.
- Candidate building blocks (not selected): agent-maintained Markdown wiki, local search with QMD, a small graph for relations, sqlite-vector as a possible local vector layer inside SQLite.

## Open questions

- What gets stored: raw logs only, curated pages only, or both.
- Which search pieces are needed for daily use.
- Where embeddings run, if vectors are used.

## Non-goals

- No vendor-held memory that cannot be exported.
- No memory shared between people.
- No silent retention the user cannot inspect.

## Relation to other phases

- V1 must preserve raw logs with stable identifiers.
- V2 connectors may supply facts that memory cites.
