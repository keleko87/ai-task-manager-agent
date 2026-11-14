import {
  MCPServerStreamableHttp,
  createMCPToolStaticFilter,
} from "@openai/agents";
import { z } from "zod";
import {
  createWorkoutReader,
  assertDestination,
  NOTION_PAGE_ID,
} from "./notion-read-service.js";
import { NOTION_MCP_URL, type NotionOAuthProvider } from "./notion-oauth.js";

export function createReadServer(
  authProvider: NotionOAuthProvider,
  enableControlledWrite = false,
) {
  return new MCPServerStreamableHttp({
    url: NOTION_MCP_URL,
    name: "notion-fixed-page-readonly",
    authProvider,
    timeout: 20_000,
    errorFunction: null,
    cacheToolsList: true,
    toolFilter: createMCPToolStaticFilter({
      allowed: enableControlledWrite
        ? ["notion-fetch", "notion-update-page"]
        : ["notion-fetch"],
    }),
  });
}

const Payload = z.object({
  id: z.string().optional(),
  url: z.string(),
  title: z.string(),
  text: z.string(),
  truncated: z.boolean().optional(),
  unknown_block_count: z.number().optional(),
  unknown_block_ids: z.array(z.string()).optional(),
  page_last_edited_at: z.string().optional(),
});

export function decodePage(result: unknown) {
  const envelope = result as { isError?: boolean; structuredContent?: unknown };

  if (envelope.isError) {
    throw new Error("Notion denegó la lectura o devolvió un error MCP.");
  }

  let data = envelope.structuredContent;

  if (!data && Array.isArray(result)) {
    const text = result.find((part) => part.type === "text")?.text;

    if (typeof text !== "string") {
      throw new Error("Respuesta MCP sin contenido.");
    }

    data = JSON.parse(text);
  }

  const page = Payload.parse(data);
  const url = new URL(page.url);

  if (
    !["app.notion.com", "www.notion.so", "notion.so"].includes(url.hostname) ||
    url.protocol !== "https:"
  ) {
    throw new Error("URL de página inválida.");
  }

  const id = page.id ?? url.pathname.match(/([a-f\d]{32})(?:\/|$)/i)?.[1];

  if (!id) {
    throw new Error("Respuesta sin identidad de página.");
  }

  assertDestination(id);

  if (
    !url.pathname
      .replaceAll("-", "")
      .includes(NOTION_PAGE_ID.replaceAll("-", ""))
  ) {
    throw new Error("URL de otra página.");
  }

  if (
    page.truncated ||
    (page.unknown_block_count ?? 0) > 0 ||
    page.unknown_block_ids?.length ||
    /<unknown(?:\s|>)/i.test(page.text)
  ) {
    throw new Error("Respuesta incompleta de Notion.");
  }

  const match = page.text.match(/<content>\n?([\s\S]*?)\n?<\/content>/);

  if (!match) {
    throw new Error("Respuesta sin contenido completo verificable.");
  }

  const revision =
    page.page_last_edited_at ?? page.text.match(/as of ([\dT:.Z+-]+):\n/)?.[1];

  if (!revision) {
    throw new Error("Respuesta sin revisión verificable.");
  }

  return {
    id,
    title: page.title,
    content: match[1]!,
    revision,
    complete: true as const,
  };
}

export function createMcpWorkoutReader(
  server: Pick<MCPServerStreamableHttp, "callTool">,
) {
  return createWorkoutReader({
    async fetchPage(id) {
      assertDestination(id);

      return decodePage(
        await server.callTool("notion-fetch", { id: NOTION_PAGE_ID }),
      );
    },
  });
}

export function safeNotionError(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : "";

  if (/401|invalid_grant|unauthorized/i.test(message)) {
    return "OAuth expirado o revocado. Repite la autorización.";
  }

  if (/403|forbidden|deneg|permission|not_found/i.test(message)) {
    return "Acceso denegado. Revisa la cuenta, workspace y permisos de la página.";
  }

  if (/incomplet|revisión|contenido|identidad|URL|destino/i.test(message)) {
    return "La respuesta no permite verificar identidad, integridad o revisión de la página.";
  }

  if (/manual|rechaz|agotado|callback|navegador/i.test(message)) {
    return "OAuth pendiente, cancelado o callback no disponible. Repite el comando de forma interactiva.";
  }

  return "No se pudo conectar o leer Notion. Revisa red y acceso al llavero; no se realizó ninguna escritura.";
}
