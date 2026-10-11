import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { AssistantEntry, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createMcpExtension } from "pi-mcp-client/durable";
import { describeError } from "./errors.js";
import type { AssistantReply } from "./reply.js";
import type { Config } from "./config.js";
import { knowledgeExtension } from "./extensions/knowledge.js";
import { sourcesExtension } from "./extensions/sources.js";
import { persona } from "./extensions/persona.js";

export async function openAssistant(config: Config) {
  const factories = { openrouter: openrouterProvider, anthropic: anthropicProvider, openai: openaiProvider };
  const providerName = config.model.provider;
  if (!Object.hasOwn(factories, providerName)) {
    throw new Error("FINROD_MODEL_PROVIDER: set openrouter, anthropic, or openai.");
  }
  const models = createModels();
  models.setProvider(factories[providerName as keyof typeof factories]());
  const model = models.getModel(providerName, config.model.modelId);
  if (!model) throw new Error("FINROD_MODEL: choose a model in the configured Pi provider catalog.");
  if (!await models.getAuth(model)) {
    throw new Error(`FINROD_MODEL_PROVIDER: configure the API credential for ${providerName}.`);
  }
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const registry = createRegistry();
  registry.install(persona);
  const knowledge = await knowledgeExtension(join(config.dataDir, "knowledge"));
  registry.install(knowledge);
  const sources = await sourcesExtension(config.dataDir);
  registry.install(sources);
  const mcp = await createMcpExtension({
    registry,
    cwd: config.dataDir,
    agentDir: join(config.dataDir, "mcp"),
    config: {
      exa: {
        url: "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa",
        ...(config.exa.apiKey ? { headers: { "x-api-key": config.exa.apiKey } } : {}),
        exposure: "hidden",
        toolExposure: { web_search_exa: "direct", web_fetch_exa: "direct" },
        timeoutMs: 30_000,
      },
    },
  });
  registry.install(mcp.extension);
  let harness: Harness | undefined;
  try {
    harness = await Harness.open(await openNodeSqliteStorage(join(config.dataDir, "conversation.sqlite")), {
      models, registry,
      onReport: error => console.error("Durable:", describeError(error)),
      settings: { toolExecution: "sequential", retry: { maxRetries: 2 }, stream: { timeoutMs: 120_000 } },
    }, context);
    await mcp.restore(harness, context);
    const tools = [...(knowledge.tools ?? []), ...(sources.tools ?? []), ...(mcp.extension.tools ?? [])];
    const root = await harness.root(context, { agent: { model: config.model, tools } });
    await root.configure({ model: config.model, tools }, context);
    harness.resume();
    const opened = harness;
    return {
      async answer(input: string, requestId: string): Promise<AssistantReply> {
        const submission = await root.submit({ type: "input", content: input, requestId }, context);
        const result = await submission.wait(context);
        if (result.status !== "done") {
          throw new Error(`Assistant request ${requestId} failed: ${result.reason}; ${JSON.stringify(result.detail ?? "No provider detail")}`);
        }
        if (result.type !== "input") throw new Error(`Assistant request ${requestId}: unexpected submission type.`);
        const entry = await root.commit(tx => tx.entry(AssistantEntry, result.answer), context);
        const text = entry?.model?.flatMap(message => message.role === "assistant"
          ? message.content.flatMap(block => block.type === "text" ? [block.text] : [])
          : []).join("\n");
        if (!text?.trim()) throw new Error(`Assistant request ${requestId}: no text answer was stored.`);
        const message = entry?.model?.find(message => message.role === "assistant");
        if (!message || message.role !== "assistant") throw new Error(`Assistant request ${requestId}: no model metadata.`);
        return {
          text,
          metadata: {
            requestId, conversationId: root.id, submissionId: submission.id,
            answerEntryId: result.answer, provider: message.provider, model: message.model,
          },
        };
      },
      async close(): Promise<void> {
        try { await opened.close(context); } finally { await mcp.close(); }
      },
    };
  } catch (error) {
    try { if (harness) await harness.close(context); } finally { await mcp.close(); }
    throw error;
  }
}
