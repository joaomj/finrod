import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { downloadVoice } from "../dist/telegram/voice.js";

test("voice download discards interrupted audio, recovers on retry, and preserves failure after bounded attempts", { timeout: 15000 }, async () => {
  const audio = Buffer.from("complete voice recording");
  const requests = new Map();
  const server = createServer((request, response) => {
    const count = (requests.get(request.url) ?? 0) + 1;
    requests.set(request.url, count);
    response.setHeader("Connection", "close");
    if (request.url === "/recover" && count === 2) {
      response.end(audio);
      return;
    }
    response.writeHead(200, { "Content-Length": 100 });
    response.write("partial audio that must be discarded");
    setImmediate(() => response.destroy());
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(Buffer.from(await downloadVoice(`${base}/recover`)), audio);
    assert.equal(requests.get("/recover"), 2);
    await assert.rejects(downloadVoice(`${base}/unavailable`), error => {
      assert.match(error.message, /failed after 3 attempt/);
      assert.ok(error.cause instanceof Error, "Keep the final transport error");
      assert.ok(error.cause.cause instanceof Error, "Keep the underlying interrupted-transfer error");
      return true;
    });
    assert.equal(requests.get("/unavailable"), 3);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
