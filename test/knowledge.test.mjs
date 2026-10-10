import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels, fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { knowledgeExtension } from "../dist/extensions/knowledge.js";

test("saved topics support correction, restart, bounded paths, and deletion through Durable", { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "finrod-knowledge-"));
  const wiki = join(directory, "knowledge");
  const page = join(wiki, "weekend.md");
  const outside = join(directory, "outside.md");
  await writeFile(outside, "Private file outside the wiki");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const extension = await knowledgeExtension(wiki);
  registry.install(extension);
  const open = async () => {
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "session.sqlite")), {
      models, registry, settings: { toolExecution: "sequential", compaction: { enabled: false } },
    }, context);
    const root = await harness.root(context, { agent: {
      model: { provider: faux.getModel().provider, modelId: faux.getModel().id }, tools: extension.tools,
    } });
    return { harness, root };
  };
  let { harness, root } = await open();
  const call = async (name, args, requestId) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Acknowledged")]),
    ]);
    const settled = await (await root.submit({ type: "input", content: `${name} requested`, requestId }, context)).wait(context);
    assert.equal(settled.status, "done");
    const view = await root.context(context);
    return view.messages.filter(message => message.role === "toolResult").at(-1);
  };
  try {
    await call("topic_save", { topic: "weekend", markdown: "# Weekend\nVisit on Saturday." }, "save");
    assert.match(await readFile(page, "utf8"), /Visit on Saturday/);
    await call("topic_save", { topic: "weekend", markdown: "# Weekend\nVisit on Sunday." }, "correct");
    await harness.close(context);
    ({ harness, root } = await open());
    const before = faux.state.callCount;
    const replay = await (await root.submit({ type: "input", content: "topic_save requested", requestId: "save" }, context)).wait(context);
    assert.equal(replay.status, "done");
    assert.equal(faux.state.callCount, before);
    const read = await call("topic_read", { topic: "weekend" }, "read");
    assert.equal(read.isError, false);
    assert.match(read.content.map(block => block.text ?? "").join(""), /Visit on Sunday/);
    assert.doesNotMatch(await readFile(page, "utf8"), /Saturday/);
    const blocked = await call("topic_save", { topic: "../outside", markdown: "Overwrite private file" }, "escape");
    assert.equal(blocked.isError, true);
    assert.equal(await readFile(outside, "utf8"), "Private file outside the wiki");
    await call("topic_delete", { topic: "weekend" }, "delete");
    await assert.rejects(readFile(page), { code: "ENOENT" });
    const listing = await call("topics_list", {}, "list");
    assert.match(listing.content.map(block => block.text ?? "").join(""), /No saved topics/);
  } finally {
    await harness.close(context);
    await rm(directory, { recursive: true, force: true });
  }
});
