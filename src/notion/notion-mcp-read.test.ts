import { describe, it, expect, vi } from "vitest";
import {
  decodePage,
  createMcpWorkoutReader,
  createReadServer,
  safeNotionError,
} from "./notion-mcp-read.js";
import {
  NotionOAuthProvider,
  parseCallback,
  type SecretStore,
} from "./notion-oauth.js";
import { NOTION_PAGE_ID, NOTION_PAGE_URL } from "./notion-read-service.js";

const data = {
  id: NOTION_PAGE_ID,
  url: NOTION_PAGE_URL,
  title: "Pruebas",
  text: "<content>\nTABLA APROBADA\n</content>",
  page_last_edited_at: "2026-11-07T21:00:00Z",
};
const result = (value: unknown) =>
  Object.assign([], { structuredContent: value });

describe("MCP lectura", () => {
  it("decodifica respuesta real y metadatos", () =>
    expect(decodePage(result(data))).toMatchObject({
      content: "TABLA APROBADA",
      complete: true,
      id: NOTION_PAGE_ID,
    }));

  it("admite JSON en bloques de texto", () =>
    expect(
      decodePage([{ type: "text", text: JSON.stringify(data) }]).title,
    ).toBe("Pruebas"));

  it.each([
    { truncated: true },
    { unknown_block_count: 1 },
    { unknown_block_ids: ["x"] },
    { text: "<content><unknown /></content>" },
    { id: "otro" },
    { url: "https://example.com/" },
    { text: "sin envoltura" },
    { page_last_edited_at: undefined },
  ])("rechaza respuesta insegura %j", (extra) =>
    expect(() => decodePage(result({ ...data, ...extra }))).toThrow(),
  );

  it("solo llama fetch con el ID fijo", async () => {
    const callTool = vi.fn(async () => result(data));

    await createMcpWorkoutReader({ callTool } as never).read();

    expect(callTool).toHaveBeenCalledExactlyOnceWith("notion-fetch", {
      id: NOTION_PAGE_ID,
    });
  });

  it("propaga errores MCP", () =>
    expect(() => decodePage(Object.assign([], { isError: true }))).toThrow());

  it("solo anuncia fetch en el filtro", () => {
    const server = createReadServer(new NotionOAuthProvider());

    expect(server.toolFilter).toEqual(
      expect.objectContaining({ allowedToolNames: ["notion-fetch"] }),
    );
  });

  it("no muestra secretos en errores", () =>
    expect(
      safeNotionError(new Error("fetch failed token=secret")),
    ).not.toContain("secret"));
});

describe("OAuth", () => {
  function fixture() {
    const values = new Map<string, string>();
    const store: SecretStore = {
      get: async (key) => values.get(key) ?? null,
      set: async (key, val) => {
        values.set(key, val);
      },
      delete: async (key) => {
        values.delete(key);
      },
    };

    return { values, provider: new NotionOAuthProvider(store) };
  }

  it("persiste y recupera tokens mediante SecretStore", async () => {
    const { provider, values } = fixture();

    await provider.saveTokens({ access_token: "test", token_type: "Bearer" });

    expect(await provider.tokens()).toMatchObject({ access_token: "test" });

    expect(values.has("tokens")).toBe(true);

    await provider.invalidateCredentials("tokens");

    expect(await provider.tokens()).toBeUndefined();
  });

  it("conserva PKCE y rechaza verifier ausente", async () => {
    const { provider } = fixture();

    await expect(provider.codeVerifier()).rejects.toThrow();

    await provider.saveCodeVerifier("pkce");

    expect(await provider.codeVerifier()).toBe("pkce");
  });

  it("requiere revisión antes de abrir navegador", async () => {
    const { provider } = fixture();

    await expect(
      provider.redirectToAuthorization(new URL("https://example.com/auth")),
    ).rejects.toThrow("manual");
  });

  it("verifica state, denegación y código", () => {
    expect(
      parseCallback(
        "http://127.0.0.1/oauth/callback?state=ok&code=test&iss=https://issuer",
        "ok",
      ),
    ).toEqual({ code: "test", issuer: "https://issuer" });

    for (const query of [
      "state=otro&code=test",
      "state=ok&error=access_denied",
      "state=ok",
    ]) {
      expect(() => parseCallback(`http://127.0.0.1/?${query}`, "ok")).toThrow();
    }
  });

  it("genera un state distinto en cada intento", () => {
    const { provider } = fixture();

    expect(provider.state()).not.toBe(provider.state());
  });
});
