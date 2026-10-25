import { readFile, rename, writeFile } from "node:fs/promises";
import {
  authorizeMcp,
  McpOAuthProvider,
  type McpOAuthState,
  type McpOAuthStateStore,
  type OAuthClientInformationMixed,
} from "@earendil-works/pi-mcp/oauth";

export const EXA_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa";
export const EXA_CALLBACK_PATH = "/oauth/exa/callback";

/** OAuth state in one JSON file, mode 0600, replaced atomically so a crash never leaves half a token. */
class FileStore implements McpOAuthStateStore {
  constructor(private readonly file: string) {}

  async load(): Promise<McpOAuthState | undefined> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as McpOAuthState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(`Reading the Exa sign-in from ${this.file} failed.`, { cause: error });
    }
  }

  async save(state: McpOAuthState): Promise<void> {
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

/**
 * The user's own Exa account, connected through OAuth. Without it, web search uses Exa's free tier, which is
 * rate limited.
 */
export class ExaAuth {
  readonly provider: McpOAuthProvider;
  private readonly redirectUrl: string;
  private redirect: URL | undefined;

  constructor(file: string, publicUrl: string) {
    this.redirectUrl = `${publicUrl}${EXA_CALLBACK_PATH}`;
    this.provider = new McpOAuthProvider({
      serverUrl: EXA_URL,
      redirectUrl: this.redirectUrl,
      clientMetadata: { client_name: "Finrod" },
      store: new FileStore(file),
      onRedirect: (url) => {
        this.redirect = url;
      },
    });
  }

  async connected(): Promise<boolean> {
    return (await this.provider.tokens()) !== undefined;
  }

  /** Start a sign-in and return the Exa page to send the user to. */
  async start(): Promise<string> {
    // A client registered for another Finrod address cannot receive the callback here; register again.
    if (!redirectsTo(await this.provider.clientInformation(), this.redirectUrl)) await this.provider.invalidateCredentials("client");
    this.redirect = undefined;
    const result = await authorizeMcp(this.provider, { serverUrl: EXA_URL, skipRefresh: true });
    const redirect = this.takeRedirect();
    if (result !== "REDIRECT" || !redirect) throw new Error(`Exa sign-in did not return an authorization page (result ${result}).`);
    return redirect.href;
  }

  private takeRedirect(): URL | undefined {
    const redirect = this.redirect;
    this.redirect = undefined;
    return redirect;
  }

  /** Finish a sign-in from Exa's redirect back to Finrod. */
  async finish(params: URLSearchParams): Promise<void> {
    const refused = params.get("error");
    if (refused) throw new Error(`Exa refused the connection: ${params.get("error_description") ?? refused}`);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state || state !== (await this.provider.state())) {
      throw new Error("This sign-in does not match one Finrod started. Start it again from the Finrod menu.");
    }
    const iss = params.get("iss");
    await authorizeMcp(this.provider, { serverUrl: EXA_URL, authorizationCode: code, ...(iss ? { iss } : {}) });
  }

  /** Forget the tokens and client; web search goes back to the free tier. */
  async disconnect(): Promise<void> {
    await this.provider.invalidateCredentials("all");
  }
}

function redirectsTo(client: OAuthClientInformationMixed | undefined, redirectUrl: string): boolean {
  return client === undefined || ("redirect_uris" in client && client.redirect_uris.includes(redirectUrl));
}
