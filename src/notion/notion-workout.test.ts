import { describe, it, expect, vi } from "vitest";
import {
  createWorkoutReader,
  NOTION_PAGE_ID,
  assertDestination,
} from "./notion-read-service.js";
import { createNotionWorkoutService } from "./save-workout-to-notion.js";
import {
  NotionWorkoutInputSchema,
  normalizeWorkoutDate,
  workoutToNotionBlocks,
} from "./workout-to-notion-blocks.js";

const workout = NotionWorkoutInputSchema.parse({
  workoutDate: "2026-11-12",
  sessionName: "Fuerza",
  originalText: "  Press banca  ",
  exercises: [
    {
      name: "Press",
      sets: 2,
      repetitions: 8,
      weight: "60 kg",
      observations: "Bien",
    },
  ],
});

function fixture() {
  let page = {
    id: NOTION_PAGE_ID,
    title: "Pruebas",
    content: "TABLA APROBADA",
    complete: true,
    revision: "1",
  };
  const transport = { fetchPage: vi.fn(async () => ({ ...page })) };
  const reader = createWorkoutReader(transport);
  const append = vi.fn(async ({ markdown }: { markdown: string }) => {
    page.content += `\n\n${markdown}`;

    page.revision = "2";
  });
  const service = createNotionWorkoutService({ reader, writer: { append } });

  return { service, reader, transport, append, page };
}

async function ready(service: ReturnType<typeof createNotionWorkoutService>) {
  const result = await service.preview(workout, {}, "append-page-end");

  if (result.status !== "ready") {
    throw new Error("Expected preview");
  }

  return {
    previewId: result.previewId,
    digest: result.preview.digest,
    approved: true as const,
  };
}

describe("conversión", () => {
  it("conserva nota original, observaciones y series", () => {
    const result = workoutToNotionBlocks(workout);

    expect(result.blocks.at(-1)?.text).toBe("  Press banca  ");

    expect(result.markdown).toContain("Serie 2: 8");

    expect(result.markdown).toContain("Observaciones: Bien");
  });

  it("representa cargas y repeticiones diferentes por serie", () => {
    const result = workoutToNotionBlocks({
      ...workout,
      exercises: [
        {
          ...workout.exercises[0]!,
          individualSets: [
            { repetitions: 8, weight: "35 kg", observations: null },
            { repetitions: 6, weight: "30 kg", observations: "superserie" },
          ],
        },
      ],
    });

    expect(result.markdown).toContain("Serie 1: 8 · Carga: 35 kg");

    expect(result.markdown).toContain("Serie 2: 6 · Carga: 30 kg · superserie");
  });

  it("genera marcador canónico estable y distingue contenido", () => {
    const base = workoutToNotionBlocks(workout).marker;

    expect(
      workoutToNotionBlocks({ ...workout, sessionName: " FUERZA " }).marker,
    ).toBe(base);

    expect(
      workoutToNotionBlocks({ ...workout, workoutDate: "2026-11-13" }).marker,
    ).not.toBe(base);
  });

  it.each([null, "lunes", "2026-02-30", "hoy"])(
    "rechaza fecha ambigua %s",
    (date) => expect(() => normalizeWorkoutDate(date)).toThrow(),
  );

  it("resuelve relativas solo con referencia explícita", () =>
    expect(normalizeWorkoutDate("ayer", "2026-11-12")).toBe("2026-11-11"));

  it("no permite IDs ni campos desconocidos", () =>
    expect(() =>
      NotionWorkoutInputSchema.parse({ ...workout, pageId: "otro" }),
    ).toThrow());

  it("escapa etiquetas y encabezados inyectados", () =>
    expect(
      workoutToNotionBlocks({ ...workout, sessionName: "x\n## <page>" })
        .markdown,
    ).toContain("&lt;page&gt;"));

  it("rechaza series inconsistentes o excesivas", () =>
    expect(() =>
      workoutToNotionBlocks({
        ...workout,
        exercises: [{ ...workout.exercises[0]!, sets: 101 }],
      }),
    ).toThrow());
});

describe("lectura y autorización", () => {
  it("fija el ID antes de leer", async () => {
    const f = fixture();

    await f.reader.read();

    expect(f.transport.fetchPage).toHaveBeenCalledWith(NOTION_PAGE_ID);

    expect(() => assertDestination("otro")).toThrow();
  });

  it("rechaza destino incorrecto", async () => {
    const f = fixture();

    f.page.id = "otro" as typeof NOTION_PAGE_ID;

    await expect(f.reader.read()).rejects.toThrow();
  });

  it("rechaza lecturas incompletas", async () => {
    const f = fixture();

    f.page.complete = false;

    await expect(f.reader.read()).rejects.toThrow();
  });

  it("propaga denegación de permisos", async () => {
    const f = fixture();

    f.transport.fetchPage.mockRejectedValue(new Error("403"));

    await expect(f.service.preview(workout)).rejects.toThrow("403");

    expect(f.append).not.toHaveBeenCalled();
  });

  it("requiere decidir ubicación", async () => {
    const f = fixture();

    expect((await f.service.preview(workout)).status).toBe(
      "needs-clarification",
    );

    expect(f.append).not.toHaveBeenCalled();
  });

  it("bloquea registros legacy sin marcador", async () => {
    const f = fixture();

    f.page.content += " Semana 1 (7 nov) 2026";

    expect(
      (await f.service.preview({ ...workout, workoutDate: "2026-11-07" }))
        .status,
    ).toBe("needs-clarification");
  });

  it("bloquea duplicados", async () => {
    const f = fixture();

    f.page.content += workoutToNotionBlocks(workout).marker;

    expect((await f.service.preview(workout)).status).toBe("duplicate");
  });

  it("cancela y consume permisos una sola vez", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    f.service.cancel(auth.previewId);

    await expect(f.service.saveWorkoutToNotion(auth)).rejects.toThrow();

    expect(f.append).not.toHaveBeenCalled();
  });

  it("rechaza aprobación alterada", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    await expect(
      f.service.saveWorkoutToNotion({ ...auth, digest: "otro" }),
    ).rejects.toThrow();
  });

  it("escritura está deshabilitada sin transporte", async () => {
    const f = fixture();
    const service = createNotionWorkoutService({ reader: f.reader });

    await expect(
      service.saveWorkoutToNotion(await ready(service)),
    ).rejects.toThrow("deshabilitada");
  });

  it("caduca la autorización", async () => {
    const f = fixture();
    let time = 0;
    const service = createNotionWorkoutService({
      reader: f.reader,
      writer: { append: f.append },
      now: () => time,
    });
    const auth = await ready(service);

    time = 600_000;

    await expect(service.saveWorkoutToNotion(auth)).rejects.toThrow();
  });

  it("verifica duplicado inmediatamente antes de escribir", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    f.page.content += workoutToNotionBlocks(workout).marker;

    expect((await f.service.saveWorkoutToNotion(auth)).status).toBe(
      "duplicate",
    );

    expect(f.append).not.toHaveBeenCalled();
  });

  it("bloquea cambios concurrentes", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    f.page.content += "cambio";

    await expect(f.service.saveWorkoutToNotion(auth)).rejects.toThrow("cambió");

    expect(f.append).not.toHaveBeenCalled();
  });

  it("no declara éxito tras fallo remoto", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    f.append.mockRejectedValue(new Error("network"));

    await expect(f.service.saveWorkoutToNotion(auth)).rejects.toThrow(
      "network",
    );
  });

  it("no declara éxito sin verificación", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    f.append.mockImplementation(async () => {});

    await expect(f.service.saveWorkoutToNotion(auth)).rejects.toThrow(
      "no verificada",
    );
  });

  it("detecta pérdida de contenido aprobado", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    f.append.mockImplementation(async ({ markdown }) => {
      f.page.content = markdown;
    });

    await expect(f.service.saveWorkoutToNotion(auth)).rejects.toThrow(
      "no verificada",
    );
  });

  it("guarda solo el contenido aprobado y conserva tabla", async () => {
    const f = fixture();
    const auth = await ready(f.service);

    expect((await f.service.saveWorkoutToNotion(auth)).status).toBe("saved");

    expect(f.page.content).toContain("TABLA APROBADA");

    expect(f.append).toHaveBeenCalledWith({
      pageId: NOTION_PAGE_ID,
      markdown: workoutToNotionBlocks(workout).markdown,
      expectedRevision: "1",
    });

    await expect(f.service.saveWorkoutToNotion(auth)).rejects.toThrow();
  });
});
