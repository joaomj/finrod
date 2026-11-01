// Preloaded into the real server process: answers OpenRouter chat requests locally so no test touches the network.
// FINROD_STUB_HANG=1 makes an answer stop after its first words and never finish, as when the process dies mid-answer.
const encoder = new TextEncoder();

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://openrouter.ai/api/v1/chat/completions")) {
    throw new Error(`Test stub: unexpected network request to ${url}`);
  }
  const request = JSON.parse(init.body);
  const lastUser = request.messages.findLast((message) => message.role === "user");
  const asked = typeof lastUser.content === "string" ? lastUser.content : lastUser.content.map((part) => part.text ?? "").join(" ");
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const body = new ReadableStream({
    async start(controller) {
      const send = (text) => controller.enqueue(encoder.encode(text));
      send(chunk({ role: "assistant", content: "Stub answer" }));
      if (process.env.FINROD_STUB_HANG === "1") return;
      await sleep(300);
      send(chunk({ content: ` to: ${asked}` }));
      send(chunk({}, "stop"));
      send(`data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: request.model, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
      send("data: [DONE]\n\n");
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
