import { describe, expect, it, vi } from "vitest";
import { createMcpWorkoutWriter } from "./notion-mcp-write.js";
import { createWorkoutReader, NOTION_PAGE_ID } from "./notion-read-service.js";
import { insertRecord, RECORD_SECTION } from "./notion-record-section.js";
import { createNotionWorkoutService } from "./save-workout-to-notion.js";
import {
  NotionWorkoutInputSchema,
  workoutToNotionBlocks,
} from "./workout-to-notion-blocks.js";

const workout = NotionWorkoutInputSchema.parse({
  workoutDate: "2026-11-14",
  originalText: "  Nota\n```\n<page>literal</page>  ",
  exercises: [{ name: "Press", sets: 1, repetitions: 8, weight: "35 kg" }],
});

function fixture(enabled = true) {
  const page = {
    id: NOTION_PAGE_ID,
    title: "Pruebas",
    content: `${RECORD_SECTION}\n\n### Noviembre 2026\n\n| TABLA APROBADA |\n\n## Destino futuro\nNo tocar`,
    revision: "1",
    complete: true,
  };
  const reader = createWorkoutReader({
    fetchPage: vi.fn(async () => ({ ...page })),
  });
  const callTool = vi.fn(async () =>
    Object.assign([], { structuredContent: { success: true } }),
  );
  const listTools = vi.fn(async () => [{ name: "notion-update-page" }]);
  const writer = createMcpWorkoutWriter(
    { callTool, listTools } as never,
    reader,
    enabled,
  );
  const conversion = workoutToNotionBlocks(workout);
  const request = {
    pageId: NOTION_PAGE_ID,
    markdown: conversion.markdown,
    marker: conversion.marker,
    expectedContent: page.content,
    expectedRevision: page.revision,
  };

  return { page, reader, callTool, listTools, writer, request };
}

describe("transporte MCP de escritura controlada", () => {
  it("está deshabilitado por defecto", async () => {
    const f = fixture(false);

    await expect(f.writer.append(f.request)).rejects.toThrow("deshabilitada");

    expect(f.callTool).not.toHaveBeenCalled();
  });

  it("rechaza destino incluso con un cast", async () => {
    const f = fixture();

    await expect(
      f.writer.append({
        ...f.request,
        pageId: "otro" as typeof NOTION_PAGE_ID,
      }),
    ).rejects.toThrow("autorizado");

    expect(f.callTool).not.toHaveBeenCalled();
  });

  it("inserta exclusivamente bajo el encabezado único", async () => {
    const f = fixture();

    await f.writer.append(f.request);

    expect(f.callTool).toHaveBeenCalledExactlyOnceWith("notion-update-page", {
      page_id: NOTION_PAGE_ID,
      command: "update_content",
      content_updates: [
        {
          old_str: RECORD_SECTION,
          new_str: `${RECORD_SECTION}\n\n${f.request.markdown}`,
          replace_all_matches: false,
        },
      ],
      allow_async: false,
    });
  });

  it("bloquea cambios y duplicados antes de ejecutar MCP", async () => {
    const f = fixture();

    f.page.content += f.request.marker;

    await expect(f.writer.append(f.request)).rejects.toThrow("duplicado");

    expect(f.callTool).not.toHaveBeenCalled();
  });

  it("bloquea revisión distinta", async () => {
    const f = fixture();

    f.page.revision = "2";

    await expect(f.writer.append(f.request)).rejects.toThrow("cambió");
  });

  it.each(["sin sección", `${RECORD_SECTION}\n${RECORD_SECTION}`])(
    "rechaza ancla ausente o ambigua",
    (content) => expect(() => insertRecord(content, "nuevo")).toThrow(),
  );

  it("propaga fallo MCP", async () => {
    const f = fixture();

    f.callTool.mockResolvedValue(Object.assign([], { isError: true }) as never);

    await expect(f.writer.append(f.request)).rejects.toThrow("rechazó");
  });

  it("no reintenta ante pérdida de conexión", async () => {
    const f = fixture();

    f.callTool.mockRejectedValue(new Error("connection lost"));

    await expect(f.writer.append(f.request)).rejects.toThrow("connection lost");

    expect(f.callTool).toHaveBeenCalledOnce();
  });

  it("reconcilia un timeout después de que Notion guardó", async () => {
    const f = fixture();

    f.callTool.mockImplementation(async () => {
      f.page.content = insertRecord(f.page.content, f.request.markdown);

      throw new Error("timeout");
    });

    const service = createNotionWorkoutService({
      reader: f.reader,
      writer: f.writer,
    });
    const preview = await service.preview(workout, {}, "records-section-start");

    if (preview.status !== "ready") {
      throw new Error("preview");
    }

    expect(
      (
        await service.saveWorkoutToNotion({
          previewId: preview.previewId,
          digest: preview.preview.digest,
          approved: true,
        })
      ).status,
    ).toBe("saved");

    expect(f.callTool).toHaveBeenCalledOnce();

    expect(f.page.content).toContain("| TABLA APROBADA |");

    expect(f.page.content).toContain("## Destino futuro\nNo tocar");
  });

  it("preserva transcripción exacta en un bloque literal y evita escape de fence", () => {
    expect(workoutToNotionBlocks(workout).markdown).toContain(
      `\`\`\`\`text\n${workout.originalText}\n\`\`\`\``,
    );
  });

  it("la vista previa entregada no puede mutar el permiso interno", async () => {
    const f = fixture();
    const service = createNotionWorkoutService({
      reader: f.reader,
      writer: f.writer,
    });
    const preview = await service.preview(workout, {}, "records-section-start");

    if (preview.status !== "ready") {
      throw new Error("preview");
    }

    preview.preview.markdown = "alterado";

    f.callTool.mockImplementation(async () => {
      f.page.content = insertRecord(f.page.content, f.request.markdown);

      return Object.assign([], { structuredContent: { success: true } });
    });

    await service.saveWorkoutToNotion({
      previewId: preview.previewId,
      digest: preview.preview.digest,
      approved: true,
    });

    expect(f.page.content).not.toContain("alterado");
  });
});
