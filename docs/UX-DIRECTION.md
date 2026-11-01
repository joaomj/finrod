# UX direction after v0.3.0

**Status:** direction, decided 2026-10-27; phone interface decided
2026-11-01. These decisions are not requirements yet. Each release that
implements them gets its own PRD.

## Result

Finrod is a private ChatGPT-like assistant for a small household. Each
person has a separate assistant. The main input on the phone is
voice, because speaking is easier than typing for personal topics.

## Surface: home-screen web app

- Finrod stays a web app that each person adds to the iPhone home screen.
  No native iOS app is planned.
- Third-party messengers are rejected as the surface:
  - Telegram bot chats are not end-to-end encrypted. Telegram can read every
    message.
  - Messengers give one endless thread per bot and no custom UI for sources,
    memory, or approvals.
  - A self-hosted Matrix server with the Element X app was the strongest
    messenger option. It was rejected because it adds a service to operate
    and removes control of the UI.
- The home-screen app is preferred to a browser tab for these reasons:
  - It behaves the same for every user. A home-screen app runs on the iOS
    system web engine, independent of the browser that added it.
  - Web push on iOS works only for home-screen apps. Proactive features need
    this later.
  - It uses the full screen and has its own icon.
  - Browsers that sync history to a cloud account do not record the visits.
- Accepted cost: iOS asks for microphone permission on every launch of a
  home-screen app
  ([WebKit 327237](https://bugs.webkit.org/show_bug.cgi?id=327237)).
  This is one tap per session.

## Interface on the phone

Decided 2026-11-01. The reference is
[pi-pocket](https://github.com/TannerMidd/pi-pocket): 738 stars, MIT,
mobile-first web app on Pi Durable 1.4.0, the same durability layer, and the
same pinned `pi-ai`, `chord` and `pi-mcp` versions as Finrod. Finrod takes its
craft and leaves its coding-agent surface behind.

The drawing of the six screens is
[`docs/ui/interface-2026-11-01.html`](ui/interface-2026-11-01.html), one
self-contained file with no dependencies.

### Layout

- One screen: header, conversation, composer. Search and memory open as
  sheets over the conversation; neither replaces it.
- The header holds the title, a search button and the menu. It does not
  carry status, progress or queue information.
- One divider per day, labelled “ontem” and “hoje”. No other visible
  divisions, and no split at every long pause.
- A user message is a rounded accent bubble. An attachment is a chip inside
  the bubble, not a separate block.
- An answer is a bordered card. The thumbs sit inside the card and stay
  marked after a vote.

### Research and sources

- Searches and fetched pages collapse into one small line under the answer,
  for example “3 páginas”. The line opens on tap.
- The line is collapsed by default. A source list never takes space unless
  the user asks for it.
- This replaces the current v0.3.0 behaviour, where the sources list stays
  visible under every researched answer.

### Memory

- A line under the answer that created it: “Lembrou: … · desfazer”.
- Pending memories appear as a strip in the composer of that conversation
  only. They never appear over the search sheet or the memory sheet.
- The memory sheet lists pending memories first, with approve and discard,
  then the stored memories, with edit and delete.
- Consequence of the decision below: forgetting and the pending review are
  the only controls over what Finrod keeps.

### Composer

- Three controls: attach, text field, and one round button.
- The round button sends on a tap and records on a long press. It always
  shows the send arrow; holding it turns the composer into the recording bar.
  The gesture is invisible, so the first screens show “toque envia · segure
  para falar” and the button draws a ring while pressed.
- The single button returns about 40 px to the field, which is what makes six
  lines usable on a 320 px wide phone.
- The field grows to a maximum of six lines, then scrolls inside itself.
- With the field empty, a tap sends nothing. The long press still records.
- A message sent while an answer runs waits in a queue shown above the
  composer, with a control to withdraw it.
- While recording, the composer becomes a recording bar: red dot, timer,
  waveform, pause, cancel and send. Audio uploads in pieces during the
  recording, so a locked screen loses only the audio after that moment.
- Answers remain text. Finrod does not speak a reply.

### Streaming

- Answer text appears inside the answer card, with a small cursor. There is no
  separate working screen and no typing indicator.

### Incognito: rejected

Decided 2026-11-01. There is no incognito mode and no tinted composer. This
replaces the incognito proposal of 2026-10-27, and with it the replacement for
v0.3.0 temporary conversations. Finrod currently writes every message before
it answers, so a sensitive exchange is recorded and can only be forgotten
afterwards.

### Keyboard

The keyboard resizes the application shell, not the page.

- On iOS, the keyboard changes `visualViewport.height` and `offsetTop` only.
  The shell follows both. `100dvh` alone does not react to the keyboard.
  Safari, Brave and the home-screen app all use WebKit on iOS, so one
  implementation covers them.
- On Android, Chrome resizes the layout viewport. The
  `interactive-widget=resizes-content` meta tag in `app/index.html` already
  covers this case.
- The page body does not scroll. Only the conversation scrolls. Otherwise iOS
  moves the header off screen when the field at the bottom takes focus.
- The bottom safe-area padding drops while the keyboard is open, so no dead
  gap remains above the keyboard.
- The app does not focus the field when it opens. The keyboard appears only
  when the user taps the field.
- The field text stays at 16 px. A smaller font makes iOS zoom on focus.
- With the keyboard open, the header disappears and the conversation takes
  the space. The conversation title is not needed while writing.
- Pending memories and the queue become one-line chips while the keyboard is
  open.
- When the keyboard opens, Finrod keeps the messages the user was reading in
  place if the user had scrolled up. If the user was at the end of the
  conversation, the newest message moves down to sit against the composer.
  iOS scrolls the page itself when the field takes focus, so the shell
  compensates through `visualViewport.height` and `offsetTop`.
- An answer that arrives while the keyboard is open enters the conversation.
  It does not take focus, close the keyboard or move the field.
- If the user has scrolled up, a small grey “N novas ↓” counter sits at the
  end of the conversation and opens the newest message. There is no floating
  pill.

### Not adopted from the reference

The left rail, the status line, the bars above the composer, the subagent
board, roles and take-turns, the session list with folders and tags, and the
file, browser, diff and artifact panels. These serve someone who supervises
coding agents. Finrod's conversation fills the phone screen.

### Open

Two loose ends from the single button:

- Whether the “segure para falar” hint stays on screen or appears only in the
  first sessions.
- Whether a tap with an empty field does nothing, or starts the recording
  bar.

## Voice

Voice moves from out of scope to the first feature after v0.3.0. It replaces
the [voice decision](PRD-v030.md#voice-decision) of v0.3.0 for later
releases.

- Expected use: long monologues of 1 to 3 minutes.
- Input is a record button in the app: tap to start, tap to stop, with pause
  and resume, a timer, and cancel.
- The app keeps the screen awake while it records. The Screen Wake Lock API
  works in home-screen apps since iOS 18.4
  ([WebKit 254545](https://bugs.webkit.org/show_bug.cgi?id=254545),
  [Safari 18.4 notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)).
  Phones must run iOS 18.4 or later.
- A web app cannot record while the screen is locked or another app is in
  front. The app uploads audio in chunks during the recording, so a lock or an
  app switch loses only the audio after that moment. The user can then resume.
- Transcription runs on the home server with local faster-whisper. Audio does
  not leave the house. The [STT eval](STT-EVAL.md) found local accuracy on par
  with the only ZDR provider model.
- The server transcribes chunks while the user speaks, so the text is ready
  shortly after the user stops. Measured speed is about 0.15x to 0.25x real
  time on the home server, which is 20 to 30 seconds for a 2-minute recording
  without chunked transcription.
- The message shows the transcript, collapsed. The user does not edit it. The
  user can re-record or tell Finrod that the transcript is wrong.
- The server deletes the audio after transcription by default. The transcript
  is the record. This replaces the earlier plan to keep audio plus
  transcript in the raw log.
- Finrod answers in text. Spoken answers are out of scope.
- After a long personal monologue, Finrod first reflects what it heard and
  asks before it gives advice. This is a prompt rule.
- Keyboard dictation is not the voice feature. Depending on language and
  device, iOS can send dictation audio to Apple. Whether pt-BR dictation runs
  only on the device is not verified.
- An iOS Shortcut for voice capture is out of scope for now. It conflicts with
  a key that only unlocks when the user is in the app.

### Open risk before the voice build

One unconfirmed report says recording works once in a home-screen app and
then fails after the app is closed and reopened, until the phone restarts
([Stack Overflow 79744644](https://stackoverflow.com/questions/79744644/mediarecorder-stucks-on-ios-as-pwa-app-how-to-clean-all-tracks)).
A test page on each user's phone must check these items before the build:

1. A 5-minute recording with the screen untouched.
2. Close the app, reopen it, and record again.
3. Switch apps during a recording, return, and confirm the uploaded chunks
   remain.
4. How often the microphone prompt appears.

## Conversation model: one continuous stream

Each user has one stream, not a list of conversations. The users ask about
unrelated topics (recipes, health, news) and rarely open old conversations.
Folders per conversation become messy and add sorting work.

- The app opens at the bottom of the stream, with the last messages visible
  and the input ready. There is no home screen or greeting.
- One divider per day, labelled “ontem” and “hoje”, decided 2026-11-01. There
  are no other visible divisions, and no split at every long pause. Context is
  assembled when Finrod reads: each answer sees the recent messages plus
  memories retrieved from older ones. This handles interleaved topics.
- To return to an old topic, the user long-presses a message and selects
  **Reply**. Finrod includes that exchange in the context.
- Search sits at the top of the stream. Results jump to the message.
- Forget replaces conversation deletion. The user long-presses a message and
  forgets the message or the exchange. Memories derived from it go too.
- Temporary conversations are dropped, not replaced. Incognito was rejected
  on 2026-11-01 (see “Incognito: rejected” above). Finrod writes every message
  before it answers, so forgetting after the fact is the only control.
- Later proactive output, such as reminders, arrives as a normal message in
  the stream.

## Visible memory

- When Finrod saves a memory, a small line under the answer shows it, with
  undo. Example: "Remembered: you are vegetarian."
- A "What Finrod knows" page lists all memories, with edit and delete.
- These two points let the user catch wrong memories at the moment they are
  made.

## Multiple users

- Each person signs in with a passkey and has a separate stream, memories,
  model provider, and credentials. Nothing is shared.
- Shared household facts are out of scope until the users ask for them.

## Privacy: encryption at rest per user

- Target: chats and memories are encrypted on disk with a key per user. The
  key derives from the user's passkey through the WebAuthn PRF extension
  (iOS 18 and later). The server holds the key in memory only while the user
  is signed in.
- This is not end-to-end encryption. Finrod decrypts on the server, so a
  person with root access who acts deliberately can still read the data. It
  protects against a stolen disk, leaked backups, and casual reading by the
  administrator.
- Finrod learns from a session (memory extraction and consolidation) only
  while the key is available. There is no background processing of private
  data while the user is away. Proactive features that need private data wait
  for a later decision.
- Each user needs a recovery key. Without it, a lost passkey loses all data.
- One instance per user is a deployment option, not a privacy measure. It
  isolates bugs and settings, but the administrator can still read the files.
- Not verified: WebAuthn PRF support inside an iOS home-screen app. A spike
  must confirm it before the design is final.

## Sequence

1. Release v0.3.0 as built, with separate conversations, and use it daily for
   a few weeks.
2. v0.4: voice, after the test page passes.
3. v0.5: the continuous stream and visible memory.
4. Not yet placed: multiple users with passkeys, and encryption at rest per user.

## Reference products

- Open WebUI and LibreChat are self-hosted, multi-user, ChatGPT-like apps.
  They do not solve iOS voice. Finrod's effort should go to what they lack:
  files the user owns, curated memory, connectors, and approval-gated actions.
- Pi (Inflection) used one continuous conversation.
