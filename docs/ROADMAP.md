# Roadmap

Finrod is a browser-only AI chat companion. [Product requirements](PRD.md)
defines current scope. [Validation](VALIDATION.md) records observed behavior.
The plans below are not implemented privacy guarantees or release claims.

Keep conversation at the center. Do not add coding tools, workspaces, task
dashboards, shared accounts, or a hosted conversation backend. Pi is an
implementation choice, not a product requirement.

## Priority: reliable daily phone use

Complete acceptance on the user's iPhone/Brave and the second user's Chrome
phone. Confirm the second phone's platform before claiming compatibility.
User-reported iPhone conversation, reopening, personal-key research, and key
restoration are complete. These observations do not close the full release gate.

Verify phone-only setup, separate browser data and credentials, interruption,
export/restore, and daily-use reliability. Check keyboard behavior on the actual
phones. Assess large-history performance before claiming capacity.

Keep execution and history in the browser. Static hosting distributes application
files only. External providers receive the content required for inference and
research. Foreground operation is sufficient; unattended execution is not required.

**Gate:** both target users complete the [phone acceptance requirements](PRD.md#current-evidence-and-remaining-verification).
Record where execution and data reside. Report blockers without replacing local
execution with an undisclosed remote assistant.

## Planned local encryption and key protection

Protect local conversation history and saved credentials without introducing a
mandatory Finrod backend. This work is planned, not a current privacy guarantee.
The browser currently stores readable history and keys without application encryption.

Assess two distinct layers:

- **Device protection:** verify Apple Data Protection on the target iPhone and
  FileVault where applicable on a Mac. Record the protection provided by the
  actual browser, device configuration, and lock state. Device protection does
  not prevent access by an unlocked browser profile or malicious website code.
- **Application encryption:** assess authenticated encryption through the browser's
  Web Crypto API. Cover messages, research results, partial replies, titles,
  feedback, saved credentials, retained migration copies, and backups. Do not
  keep an unprotected decryption key beside encrypted records.

Prefer operating-system key protection when a supported integration exists.
Apple Keychain can protect small secrets and encryption keys for applications
that can access its native APIs. Do not assume that the phone browser can use
Keychain as a storage API. Verify a browser-supported unlock method before
selecting a design. Introducing a native app or mandatory bridge requires a
separate product decision.

Define unlock behavior, automatic locking, key recovery, cross-device restore,
and key-loss behavior before migration. Explain which metadata remains visible.
Encrypted backups require a recovery method independent of the original device.
Storage encryption does not hide context sent to inference providers or protect
plaintext while malicious application code can use an unlocked key.

**Gate:** demonstrate the selected protection on the target phones, tamper
rejection, lock behavior, and restore after device loss. Migrate existing history
with a recoverable backup. Report any limits of an operating-system-only design.
Do not claim end-to-end encryption or Keychain integration without evidence.

## Planned complete conversation-log export

Provide an explicit export for one selected conversation, similar to a Pi session
export. Keep the control in Settings or the chat menu, not a task dashboard.
The existing all-chat backup contains saved messages, but is not a complete
execution log. This capability is planned, not implemented.

The export must preserve chronological records and stable message, turn, and
call identifiers. Include submitted context, assistant messages, tool arguments
and results, errors, cancellations, completion states, and available timings.
Include model and provider identifiers, usage metadata, application version,
and relevant lifecycle and persistence events. Include title-generation events
without mixing title requests into the conversation's model context.

Distinguish recorded facts from missing information. Preserve provider-returned
content where available; do not invent unavailable internal reasoning or lost
progress. An export must report the interval and events it actually covers.

Offer a redacted diagnostic mode by default. Require explicit confirmation for
a complete content export containing private messages and research material.
Both modes must exclude saved API keys, authentication headers, bearer tokens,
and other configured credentials. Redaction is not a guarantee that arbitrary
conversation text contains no sensitive data; explain that boundary.

Keep collection and export local. Bound retained diagnostic data and define its
deletion behavior. Do not silently upload logs or add mandatory telemetry.
Use a versioned machine-readable format; a readable transcript can accompany it.
Exporting a log must not replay requests or change conversation history.

**Gate:** use an exported log to diagnose a successful research turn, a rate-limit
failure, and an interrupted turn. Verify ordering, tool-call matching, credential
redaction, explicit content consent, and coverage gaps. Verify export on the
actual phones, including any interaction with planned encrypted storage.

## Scope decisions

Local encryption and complete log export require explicit design approval before
implementation. Resolve unlock, recovery, consent, and retention decisions first.
Neither plan authorizes a native app, browser bridge, synchronization service,
or mandatory telemetry.

Voice, imported-source retrieval, saved-topic tools, background work, and other
delivery channels remain outside current scope. Add capabilities only when an
approved user outcome justifies them. Do not add infrastructure for hypothetical needs.

## References

- [Apple Data Protection](https://support.apple.com/guide/security/data-protection-overview-secf6276da8a/web): device encryption and protection classes.
- [Apple Keychain services](https://developer.apple.com/documentation/security/keychain-services): native APIs for protected small secrets and encryption keys.
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API): browser cryptographic operations, not native Keychain integration.
- [OWASP Cryptographic Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html): threat models, authenticated encryption, and key management.
- [Architecture](ARCHITECTURE.md): implemented behavior, not planned protection.
