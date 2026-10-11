import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { McpClient, StreamableHttpTransport, toLlmContent } from "@earendil-works/pi-mcp";

const names = ["web_search_exa", "web_fetch_exa"];
const url = "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa";

export async function openExa(signal: AbortSignal) {
  const client = new McpClient({ name: "finrod-phone", version: "0.1.0", requestTimeoutMs: 30_000 });
  const transport = new StreamableHttpTransport({ url, openGetStream: false, reconnect: { maxRetries: 0 },
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }) });
  try {
    await client.connect(transport);
    const listed = await client.listTools({ signal });
    const tools: AgentTool[] = names.map(name => {
      const tool = listed.find(tool => tool.name === name);
      if (!tool) throw new Error(`Exa did not provide ${name}. Reload before trying web research again.`);
      return { name, label: name === "web_search_exa" ? "Exa web search" : "Exa page retrieval",
        description: tool.description ?? name,
        parameters: Type.Unsafe({ ...tool.inputSchema, type: "object", properties: tool.inputSchema.properties ?? {} }),
        execute: async (_id, args, callSignal) => {
          const result = await client.callTool(name, args as Record<string, unknown>, callSignal ? { signal: callSignal } : {});
          const content = toLlmContent(result).filter(block => block.type === "text");
          if (result.isError) throw new Error(content.map(block => block.text).join("\n") || `Exa ${name} failed.`);
          return { content, details: undefined };
        } };
    });
    return { tools, close: () => client.close() };
  } catch (error) {
    try { await client.close(); } catch (closeError) { throw new AggregateError([error, closeError], "Exa connection and cleanup failed."); }
    throw new Error(`Cannot connect directly to Exa: ${error instanceof Error ? error.message : String(error)}. No model request was started.`, { cause: error });
  }
}
