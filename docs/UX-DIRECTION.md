# UX direction after v0.3.0

**Status:** direction, decided 2026-10-27. These
decisions are not requirements yet. Each release that implements them gets
its own PRD.

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
- A quiet time divider appears after a long pause. There are no other visible
  divisions.
- There is no daily split. Context is assembled when Finrod reads: each answer
  sees the recent messages plus memories retrieved from older ones. This
  handles interleaved topics.
- To return to an old topic, the user long-presses a message and selects
  **Reply**. Finrod includes that exchange in the context.
- Search sits at the top of the stream. Results jump to the message.
- Forget replaces conversation deletion. The user long-presses a message and
  forgets the message or the exchange. Memories derived from it go too.
- Incognito replaces temporary conversations. A toggle tints the input.
  Incognito messages are never saved and never become memories.
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
