import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { McpClient, StreamableHttpTransport, toLlmContent } from "@earendil-works/pi-mcp";
import { redact } from "./redaction.js";

const names = ["web_search_exa", "web_fetch_exa"];
const url = "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa";

export function exaToolFailure(name: string, text: string, isError: boolean): string | undefined {
  if (isError) return text || `Exa ${name} failed.`;
  // Exa can return its free-access limit as ordinary MCP text instead of an error.
  if (names.includes(name) && /^You['’]ve hit Exa['’]s free MCP rate limit\b/i.test(text.trimStart())) return text;
  return undefined;
}

export async function openExa(signal: AbortSignal, apiKey: string) {
  const key = apiKey.trim();
  if (/[\r\n]/.test(key)) throw new Error("Exa API key: enter the key on one line, without line breaks.");
  const safeError = (error: unknown) => redact(error instanceof Error ? error.message : String(error), [key]);
  const client = new McpClient({ name: "finrod-phone", version: "0.1.0", requestTimeoutMs: 30_000 });
  const transport = new StreamableHttpTransport({ url, ...(key ? { headers: { "x-api-key": key } } : {}), openGetStream: false, reconnect: { maxRetries: 0 },
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
          try {
            const result = await client.callTool(name, args as Record<string, unknown>, callSignal ? { signal: callSignal } : {});
            const content = toLlmContent(result).filter(block => block.type === "text").map(block => ({ ...block, text: redact(block.text, [key]) }));
            const failure = exaToolFailure(name, content.map(block => block.text).join("\n"), result.isError === true);
            if (failure) throw new Error(failure);
            return { content, details: undefined };
          } catch (error) { throw new Error(`Exa ${name}: ${safeError(error)}`, { cause: error }); }
        } };
    });
    return { tools, close: async () => {
      try { await client.close(); }
      catch (error) { throw new Error(`Cannot close the Exa connection: ${safeError(error)}`, { cause: error }); }
    } };
  } catch (error) {
    try { await client.close(); } catch (closeError) { throw new AggregateError([error, closeError], `Exa connection and cleanup failed: ${safeError(error)}; ${safeError(closeError)}`); }
    throw new Error(`Cannot connect directly to Exa: ${safeError(error)}. No model request was started.`, { cause: error });
  }
}
