import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  compareRecord,
  verifySavedRecord,
} from "./notion-record-verification.js";
import { insertRecord } from "./notion-record-section.js";
import { createWorkoutReader, NOTION_PAGE_ID } from "./notion-read-service.js";
import {
  workoutToNotionBlocks,
  NotionWorkoutInputSchema,
} from "./workout-to-notion-blocks.js";

const input = NotionWorkoutInputSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../examples/notion-workout.json", import.meta.url),
      "utf8",
    ),
  ),
);
const record = workoutToNotionBlocks(input);
const before =
  "## Registros de prueba\n\n### Noviembre 2026\n\n| TABLA APROBADA |\n\n## Destino futuro\nConservar";
const normalized = insertRecord(before, record.markdown)
  .replace(/\\-/g, "-")
  .replace(/`(workout-agent:v1:[a-f0-9]+)`/g, "<code>$1</code>")
  .replace(/\n\n- Serie/g, "\n- Serie")
  .replace("```text", "```txt");
const page = (content = normalized) => ({
  id: NOTION_PAGE_ID,
  content,
  title: "Pruebas",
  complete: true as const,
  revision: "2",
});
const check = (content = normalized) =>
  compareRecord(page(content), record.markdown, record.marker, before);

describe("verificación estructural", () => {
  it("reproduce las normalizaciones observadas en la primera escritura", () =>
    expect(check().status).toBe("VERIFIED"));

  it("verifica representación exacta", () =>
    expect(check(insertRecord(before, record.markdown)).status).toBe(
      "VERIFIED",
    ));

  it("admite CRLF y espacios no significativos fuera de la transcripción", () =>
    expect(
      check(normalized.replace("Serie 1:", "Serie   1:").replace(/\n/g, "\r\n"))
        .status,
    ).toBe("VERIFIED"));

  it("admite rich text de presentación", () =>
    expect(
      check(
        normalized.replace(
          "#### Press banca de prueba",
          "<h4><b>Press banca de prueba</b></h4>",
        ),
      ).status,
    ).toBe("VERIFIED"));

  it.each([
    ["2026-11-14", "2026-11-15"],
    ["Press banca de prueba", "Sentadilla"],
    ["Serie 1: 8", "Serie 1: 9"],
    ["Carga: 35 kg", "Carga: 36 kg"],
    ["Serie 2: 10", "Serie 3: 10"],
    ["Datos de ejemplo:", "Datos corregidos:"],
    ["Ejemplo de prueba:", "Nota alterada:"],
    ["| TABLA APROBADA |", "| TABLA ALTERADA |"],
  ])("no ignora cambio real %s", (from, to) =>
    expect(check(normalized.replace(from, to)).status).toBe("INDETERMINATE"),
  );

  it("no ignora espacios significativos de la nota literal", () =>
    expect(
      check(normalized.replace("Ejemplo de prueba:", "  Ejemplo de prueba:"))
        .status,
    ).toBe("INDETERMINATE"));

  it("no basta encontrar solo el marcador", () =>
    expect(
      check(
        `## Registros de prueba\n\n### Prueba\nRegistro ID: <code>${record.marker}</code>`,
      ).status,
    ).toBe("INDETERMINATE"));

  it("rechaza marcador duplicado incluso fuera del registro", () =>
    expect(check(normalized + `\n${record.marker}`).status).toBe(
      "INDETERMINATE",
    ));

  it("no admite el registro fuera de la sección", () =>
    expect(
      check(normalized.replace("## Registros de prueba", "## Otra sección"))
        .status,
    ).toBe("INDETERMINATE"));

  it("sin marcador en lectura completa devuelve NOT_FOUND", () =>
    expect(check(before).status).toBe("NOT_FOUND"));

  it("lectura incompleta no demuestra ausencia", () =>
    expect(
      compareRecord(
        { ...page(before), complete: false } as never,
        record.markdown,
        record.marker,
      ).status,
    ).toBe("INDETERMINATE"));

  it("rechaza bloques desconocidos", () =>
    expect(check(normalized + "\n<unknown />").status).toBe("INDETERMINATE"));

  it("rechaza nota con fence sin cerrar", () =>
    expect(
      check(normalized.replace(/```\n\n### Noviembre/, "\n\n### Noviembre"))
        .status,
    ).toBe("INDETERMINATE"));

  it("comprobación aislada de solo lectura verifica registro existente", async () => {
    const fetchPage = vi.fn(async () => page());
    const result = await verifySavedRecord(
      createWorkoutReader({ fetchPage }),
      record.markdown,
      record.marker,
    );

    expect(result.status).toBe("VERIFIED");

    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(NOTION_PAGE_ID);
  });

  it.each(["timeout", "403", "connection lost"])(
    "error de lectura %s es INDETERMINATE",
    async (message) => {
      const read = vi.fn(async () => {
        throw new Error(message);
      });

      expect(
        (await verifySavedRecord({ read }, record.markdown, record.marker))
          .status,
      ).toBe("INDETERMINATE");

      expect(read).toHaveBeenCalledOnce();
    },
  );
});
