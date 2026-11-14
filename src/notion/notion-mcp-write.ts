import type { MCPServerStreamableHttp } from "@openai/agents";
import {
  assertDestination,
  NOTION_PAGE_ID,
  type WorkoutReader,
} from "./notion-read-service.js";
import type { NotionAppendTransport } from "./save-workout-to-notion.js";
import { insertRecord, RECORD_SECTION } from "./notion-record-section.js";

/** Host-only capability. SDK filtering is not a permission boundary. */
export function createMcpWorkoutWriter(
  server: Pick<MCPServerStreamableHttp, "callTool" | "listTools">,
  reader: WorkoutReader,
  enabled = false,
): NotionAppendTransport {
  return {
    async append(request) {
      assertDestination(request.pageId);

      if (!enabled) {
        throw new Error("Escritura MCP deshabilitada por defecto.");
      }

      const tools = await server.listTools();

      if (!tools.some((tool) => tool.name === "notion-update-page")) {
        throw new Error("MCP no ofrece notion-update-page.");
      }

      const latest = await reader.read();

      if (latest.content.includes(request.marker)) {
        throw new Error("Marcador duplicado; reconcilia el destino.");
      }

      if (
        latest.revision !== request.expectedRevision ||
        latest.content !== request.expectedContent
      ) {
        throw new Error("La página cambió antes de escribir.");
      }

      insertRecord(latest.content, request.markdown);

      // Target only the unique section heading. Existing table and all other blocks remain intact.
      // MCP has no atomic expectedRevision: this is optimistic validation, not a server-side CAS.
      const result = await server.callTool("notion-update-page", {
        page_id: NOTION_PAGE_ID,
        command: "update_content",
        content_updates: [
          {
            old_str: RECORD_SECTION,
            new_str: `${RECORD_SECTION}\n\n${request.markdown}`,
            replace_all_matches: false,
          },
        ],
        allow_async: false,
      });
      const envelope = result as {
        isError?: boolean;
        structuredContent?: unknown;
      };

      if (envelope.isError) {
        throw new Error("MCP rechazó la escritura; comprueba el destino.");
      }

      let payload = envelope.structuredContent;

      if (!payload && Array.isArray(result)) {
        const text = result.find((part) => part.type === "text")?.text;

        if (typeof text === "string") {
          try {
            payload = JSON.parse(text);
          } catch {
            throw new Error("Resultado MCP incierto; comprueba el destino.");
          }
        }
      }

      const response = payload as
        | { warnings?: unknown[]; async_task?: unknown; object?: string }
        | undefined;

      if (
        !response ||
        response.warnings?.length ||
        response.async_task ||
        response.object === "async_task"
      ) {
        throw new Error(
          "Resultado MCP incierto o asíncrono; no reintentar sin releer.",
        );
      }
    },
  };
}
