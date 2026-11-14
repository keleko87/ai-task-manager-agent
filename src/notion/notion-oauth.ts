import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  auth,
  type OAuthClientProvider,
  type OAuthClientMetadata,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/client";

export const NOTION_MCP_URL = "https://mcp.notion.com/mcp";

export const REDIRECT_URL = "http://127.0.0.1:43871/oauth/callback";

export interface SecretStore {
  get(key: string): Promise<string | null>;

  set(key: string, value: string): Promise<void>;

  delete(key: string): Promise<void>;
}

export class KeychainStore implements SecretStore {
  private async entry(key: string) {
    if (process.platform !== "darwin") {
      throw new Error("Se requiere el llavero de macOS.");
    }

    const { AsyncEntry } = await import("@napi-rs/keyring");

    return new AsyncEntry("ai-task-manager-agent.notion-readonly", key);
  }

  async get(key: string) {
    return (await this.entry(key)).getPassword();
  }

  async set(key: string, value: string) {
    await (await this.entry(key)).setPassword(value);
  }

  async delete(key: string) {
    const entry = await this.entry(key);

    if ((await entry.getPassword()) !== null) {
      await entry.deletePassword();
    }
  }
}

export function parseCallback(value: string, state: string) {
  const url = new URL(value);
  const actual = Buffer.from(url.searchParams.get("state") ?? "");
  const expected = Buffer.from(state);

  if (
    !state ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("Estado OAuth inválido.");
  }

  if (url.searchParams.has("error")) {
    throw new Error("Autorización OAuth rechazada.");
  }

  const code = url.searchParams.get("code");

  if (!code) {
    throw new Error("Callback OAuth sin código.");
  }

  return { code, issuer: url.searchParams.get("iss") ?? undefined };
}

export class NotionOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl = REDIRECT_URL;

  readonly clientMetadata: OAuthClientMetadata = {
    client_name: "AI Task Manager — lectura",
    redirect_uris: [REDIRECT_URL],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  private expectedState = "";

  private server?: Server;

  private callback?: Promise<ReturnType<typeof parseCallback>>;

  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private store: SecretStore = new KeychainStore(),
    private review: (url: URL) => Promise<boolean> = async () => false,
    private open = async (url: URL) => {
      await promisify(execFile)("open", [url.toString()]);
    },
  ) {}

  state() {
    return (this.expectedState = randomBytes(32).toString("base64url"));
  }

  private async read<T>(key: string): Promise<T | undefined> {
    const value = await this.store.get(key);

    return value ? (JSON.parse(value) as T) : undefined;
  }

  clientInformation() {
    return this.read<StoredOAuthClientInformation>("client");
  }

  async saveClientInformation(value: StoredOAuthClientInformation) {
    await this.store.set("client", JSON.stringify(value));
  }

  tokens() {
    return this.read<StoredOAuthTokens>("tokens");
  }

  async saveTokens(value: StoredOAuthTokens) {
    await this.store.set("tokens", JSON.stringify(value));
  }

  discoveryState() {
    return this.read<OAuthDiscoveryState>("discovery");
  }

  async saveDiscoveryState(value: OAuthDiscoveryState) {
    await this.store.set("discovery", JSON.stringify(value));
  }

  async saveCodeVerifier(value: string) {
    await this.store.set("verifier", value);
  }

  async codeVerifier() {
    const value = await this.store.get("verifier");

    if (!value) {
      throw new Error("Falta verifier PKCE.");
    }

    return value;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    for (const key of scope === "all"
      ? ["client", "tokens", "verifier", "discovery"]
      : [scope]) {
      await this.store.delete(key);
    }
  }

  async redirectToAuthorization(url: URL) {
    if (!(await this.review(url))) {
      throw new Error(
        "OAuth requiere autorización manual; no se abrió el navegador.",
      );
    }

    this.callback = new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        const incoming = new URL(req.url ?? "/", REDIRECT_URL);

        if (req.method !== "GET" || incoming.pathname !== "/oauth/callback") {
          res.writeHead(404).end();

          return;
        }

        try {
          const result = parseCallback(incoming.toString(), this.expectedState);

          res
            .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
            .end("Puedes volver a la terminal.");

          resolve(result);
        } catch {
          res.writeHead(400).end("Callback rechazado.");

          reject(new Error("Callback OAuth rechazado."));
        }
      });

      this.server.once("error", () =>
        reject(new Error("No se pudo abrir el callback local OAuth.")),
      );

      this.timer = setTimeout(
        () => reject(new Error("Tiempo de espera OAuth agotado.")),
        180_000,
      );
    });

    void this.callback.catch(() => undefined);

    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);

        this.server!.listen(43871, "127.0.0.1", resolve);
      });

      await this.open(url);
    } catch {
      await this.close();

      throw new Error("No se pudo iniciar el navegador/callback OAuth.");
    }
  }

  async finish() {
    if (!this.callback) {
      throw new Error("No hay callback OAuth pendiente.");
    }

    return this.callback;
  }

  async close() {
    clearTimeout(this.timer);

    if (this.server?.listening) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }
}

export async function authorizeNotion(provider: NotionOAuthProvider) {
  try {
    if (
      (await auth(provider, { serverUrl: NOTION_MCP_URL })) === "AUTHORIZED"
    ) {
      return;
    }

    const callback = await provider.finish();

    if (
      (await auth(provider, {
        serverUrl: NOTION_MCP_URL,
        authorizationCode: callback.code,
        iss: callback.issuer,
      })) !== "AUTHORIZED"
    ) {
      throw new Error("OAuth no completado.");
    }
  } finally {
    await provider.close();
  }
}
