# Validation

This record separates controlled browser checks, live desktop checks, and
user-reported phone observations. Successful transport does not establish answer
accuracy, source quality, or every recovery behavior. No private messages or
credentials belong in this document.

## User-reported iPhone/Brave checks

The user tested the stable HTTPS preview at **https://finrod-preview.pages.dev**.

| Area | Evidence | Limit |
| --- | --- | --- |
| Conversation | Two conversations completed on iPhone/Brave | Does not establish long-history performance |
| Reopening | Saved chats remained available after closing and reopening | Does not establish interruption recovery or abrupt device termination |
| Research | Live research worked with a personal Exa key after the updated deployment | Does not establish guaranteed quota or factual accuracy |
| Credentials | The personal Exa key survived closing and reopening | Does not establish application encryption |

The exported library parsed and recovered without repairs. Both chats were
completed, saved titles and votes were present, and tool calls matched results.
The inspected export did not contain the configured provider key. This inspection
is not a guarantee that arbitrary conversation content contains no sensitive data.

## Controlled browser coverage

`test/web.test.mjs` contains three default scenarios with controlled OpenRouter
and Exa responses:

1. **Phone user:** create a real earlier Durable database, migrate browser history,
   research, preserve separate chat context, generate a delayed title, reopen,
   enforce the writer lock, export/restore, and save/remove independent keys.
2. **Interrupted tool:** reopen unfinished work as failed, avoid replay, and supply
   valid tool context on the next turn.
3. **Storage and provider failures:** prevent inference after failed input saving,
   preserve visible failures, avoid title retries, redact credentials, report
   ordinary-text Exa limits as failures, and reject keyed requests without fallback.

The Exa rate-limit regression failed on the pre-fix code for the intended reason:
ordinary rate-limit text appeared as successful research. It passed after the
repair. The same three scenarios cover the repair; no separate test-only runtime
hooks were added.

After the browser-only cleanup, browser typechecking and bundling passed. All
three controlled scenarios passed with no live provider calls. Dependency cleanup
removed 45 packages. JavaScript syntax checks and `git diff --check` also passed.
Remote CI, dependency audit, and CodeQL were not run locally for this cleanup.

Run `npm test` for the controlled checks. Run `npm run check` for browser types.
The two optional live scenarios are skipped unless explicitly enabled. See
[Browser](BROWSER.md#verification) for browser installation and live-check flags.

## Previous desktop evidence

Desktop Brave checks confirmed direct native MCP search and a complete Haiku
research conversation through OpenRouter and Exa with a cited source. These
checks describe the earlier runtime verification, not live title generation.

Desktop and phone-sized walkthroughs checked Markdown, safe links, image
suppression, sidebar behavior, scroll navigation, and saved-key restoration.
Reduced viewport height was checked without a real phone keyboard. An isolated
migration preserved all 22 previous browser records and the original recovery
copy. These observations do not establish actual-phone keyboard or migration behavior.

## Remaining acceptance checks

- Complete phone-only setup and export/restore on the actual iPhone.
- Observe interruption and valid next-turn context on the actual phone.
- Confirm the second user's phone platform and Chrome session.
- Verify independent local history and credentials for both users.
- Check the actual phone keyboard and abrupt device termination.
- Assess large-history performance before claiming capacity.
- Review remote CI after the user merges or pushes the branch.

No new release or deployment is implied by repository cleanup. The preview's
existing personal-key build remains deployed. See [Product requirements](PRD.md)
for the complete acceptance gate and [Roadmap](ROADMAP.md) for planned protection.
