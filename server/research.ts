import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { McpClient, StreamableHttpTransport, toLlmContent, type CallToolResult } from "@earendil-works/pi-mcp";
import { adaptOAuthProvider, McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";
import { EXA_URL, type ExaAuth } from "./exa-auth.js";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Call one Exa MCP tool over a fresh connection, so no session can go stale between chats. With a connected Exa
 * account the call carries its token; otherwise it uses the rate-limited free tier.
 */
async function callExa(auth: ExaAuth, name: string, args: Record<string, unknown>, signal: AbortSignal | undefined) {
  const authProvider = (await auth.connected()) ? adaptOAuthProvider(auth.provider) : undefined;
  const client = new McpClient({ name: "finrod", version: "0.3.0", requestTimeoutMs: REQUEST_TIMEOUT_MS });
  let result: CallToolResult;
  try {
    await client.connect(
      new StreamableHttpTransport({ url: EXA_URL, openGetStream: false, reconnect: { maxRetries: 0 }, ...(authProvider ? { authProvider } : {}) }),
    );
    result = await client.callTool(name, args, signal ? { signal } : {});
  } catch (error) {
    await client.close().catch((closeError: unknown) => console.error(`Exa ${name}: closing after a failure also failed.`, closeError));
    if (error instanceof McpOAuthAuthorizationRequiredError) {
      throw new Error(`Exa ${name} failed: the Exa sign-in expired. Reconnect Exa from the Finrod menu.`, { cause: error });
    }
    throw new Error(`Exa ${name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  await client.close().catch((error: unknown) => console.error(`Exa ${name}: closing the connection failed.`, error));
  const content = toLlmContent(result);
  const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  // Exa reports its free-tier limit as ordinary text, not as an error result.
  if (result.isError === true || /^You['’]ve hit Exa['’]s free MCP rate limit\b/i.test(text.trimStart())) {
    throw new Error(`Exa ${name} failed: ${text || "no details returned"}`);
  }
  return content;
}

/** Web search and page reading through Exa, as the given account or the free tier. */
export function research(auth: ExaAuth) {
  const webSearch = defineTool({
    name: "web_search",
    description:
      "Search the web for current or factual information: news, prices, exchange rates, schedules, people, companies, documentation. Returns page titles, URLs, dates, and highlights.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Describe the ideal page in natural language, not just keywords." }),
      objective: Type.String({ minLength: 1, maxLength: 4096, description: "What this search must find, and which facts to pull out." }),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Number of results (default 5)." })),
    }),
    replay: "safe",
    execute: async (args, _api, context) => ({
      output: await callExa(auth, "web_search_exa", { ...args, numResults: args.numResults ?? 5 }, context.abortSignal),
    }),
  });

  const webFetch = defineTool({
    name: "web_fetch",
    description: "Read the full text of web pages by URL, when search highlights are not enough.",
    parameters: Type.Object({
      urls: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 5, description: "Page URLs to read." }),
    }),
    replay: "safe",
    execute: async (args, _api, context) => ({
      output: await callExa(auth, "web_fetch_exa", { urls: args.urls, maxCharacters: 6000 }, context.abortSignal),
    }),
  });

  return defineExtension({ name: "research", tools: [webSearch, webFetch] });
}
