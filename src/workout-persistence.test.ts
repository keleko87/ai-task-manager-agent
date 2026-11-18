import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareLocalWorkout,
  prepareNotionWorkout,
} from "./workout-persistence.js";
import {
  NotionWorkoutInputSchema,
  workoutToNotionBlocks,
} from "./notion/workout-to-notion-blocks.js";
import {
  createNotionWorkoutService,
  NotionVerificationError,
} from "./notion/save-workout-to-notion.js";
import {
  createWorkoutReader,
  NOTION_PAGE_ID,
} from "./notion/notion-read-service.js";
import { insertRecord } from "./notion/notion-record-section.js";

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function file() {
  const path = await mkdtemp(join(tmpdir(), "workout-flow-"));

  paths.push(path);

  return join(path, "workouts.json");
}

const workout = NotionWorkoutInputSchema.parse({
  workoutDate: "2026-11-18",
  originalText: "  Nota\nOriginal  ",
  exercises: [
    {
      name: "Press",
      sets: 2,
      individualSets: [
        { repetitions: 8, weight: "35 kg", observations: null },
        { repetitions: 8, weight: "32,5 kg", observations: "Cómodo" },
      ],
    },
  ],
});

async function readyLocal(path: string, enabled = true) {
  const result = await prepareLocalWorkout(workout, path, enabled);

  if (result.status !== "ready") {
    throw new Error("preview");
  }

  return result.prepared;
}

function notionFixture() {
  const page = {
    id: NOTION_PAGE_ID,
    title: "Pruebas",
    content: "## Registros de prueba\n\n### Registro semanal\nTABLA",
    revision: "1",
    complete: true,
  };
  const read = vi.fn(async () => ({ ...page }));
  const reader = createWorkoutReader({ fetchPage: read });
  const append = vi.fn(async ({ markdown }: { markdown: string }) => {
    page.content = insertRecord(page.content, markdown);
  });
  const service = createNotionWorkoutService({ reader, writer: { append } });

  return { service, append, page, read };
}

describe("adaptadores de persistencia", () => {
  it("serializa escrituras Notion entre servicios del mismo proceso", async () => {
    const f = notionFixture();
    const secondService = createNotionWorkoutService({
      reader: createWorkoutReader({ fetchPage: async () => ({ ...f.page }) }),
      writer: { append: f.append },
    });
    const first = await prepareNotionWorkout(f.service, workout, true);
    const second = await prepareNotionWorkout(secondService, workout, true);

    if (first.status !== "ready" || second.status !== "ready") {
      throw new Error("preview");
    }

    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });

    f.append.mockImplementation(async ({ markdown }) => {
      entered();

      await gate;

      f.page.content = insertRecord(f.page.content, markdown);
    });

    const pending = first.prepared.commit();

    await started;

    await expect(second.prepared.commit()).rejects.toThrow("guardado en curso");

    release();

    await expect(pending).resolves.toMatchObject({ status: "saved" });

    expect(f.append).toHaveBeenCalledOnce();
  });

  it("local utiliza saveWorkout y relee series individuales sin tocar Notion", async () => {
    const path = await file();
    const prepared = await readyLocal(path);

    expect(await prepared.commit()).toMatchObject({
      status: "saved",
      verification: "VERIFIED",
    });

    const records = JSON.parse(await readFile(path, "utf8"));

    expect(records[0].originalText).toBe(workout.originalText);

    expect(records[0].exercises[0].individualSets).toEqual(
      workout.exercises[0]?.individualSets,
    );

    await expect(prepared.commit()).rejects.toThrow("Autorización");

    expect((await prepareLocalWorkout(workout, path)).status).toBe("duplicate");
  });

  it("cancelación no escribe JSON", async () => {
    const path = await file();
    const prepared = await readyLocal(path);

    prepared.cancel();

    await expect(prepared.commit()).rejects.toThrow();

    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preview local deshabilitado no permite commit", async () => {
    const path = await file();

    await expect((await readyLocal(path, false)).commit()).rejects.toThrow();
  });

  it("series distintas no se colapsan como duplicado local", async () => {
    const path = await file();

    await (await readyLocal(path)).commit();

    const changed = structuredClone(workout);

    changed.exercises[0]!.individualSets![1]!.weight = "30 kg";

    expect((await prepareLocalWorkout(changed, path)).status).toBe("ready");
  });

  it("Notion está deshabilitado por defecto sin JSON fallback", async () => {
    const f = notionFixture();
    const result = await prepareNotionWorkout(f.service, workout);

    if (result.status !== "ready") {
      throw new Error("preview");
    }

    await expect(result.prepared.commit()).rejects.toThrow("deshabilitada");

    expect(f.append).not.toHaveBeenCalled();

    result.prepared.cancel();
  });

  it("Notion aprobado conserva permiso y devuelve VERIFIED", async () => {
    const f = notionFixture();
    const result = await prepareNotionWorkout(f.service, workout, true);

    if (result.status !== "ready") {
      throw new Error("preview");
    }

    expect(await result.prepared.commit()).toMatchObject({
      status: "saved",
      verification: { status: "VERIFIED" },
    });

    expect(f.append).toHaveBeenCalledOnce();

    await expect(result.prepared.commit()).rejects.toThrow("Autorización");
  });

  it.each(["NOT_FOUND", "INDETERMINATE"])(
    "propaga estado remoto %s sin repetir",
    async (status) => {
      const f = notionFixture();
      const result = await prepareNotionWorkout(f.service, workout, true);

      if (result.status !== "ready") {
        throw new Error("preview");
      }

      f.append.mockImplementation(async () => {
        if (status === "INDETERMINATE") {
          f.read.mockRejectedValue(new Error("timeout"));
        }
      });

      try {
        await result.prepared.commit();

        throw new Error("Expected verification error");
      } catch (error) {
        expect(error).toBeInstanceOf(NotionVerificationError);

        expect((error as NotionVerificationError).verification.status).toBe(
          status,
        );
      }

      expect(f.append).toHaveBeenCalledOnce();
    },
  );

  it("Notion duplicado no genera permiso", async () => {
    const f = notionFixture();

    f.page.content += workoutToNotionBlocks(workout).marker;

    expect((await prepareNotionWorkout(f.service, workout, true)).status).toBe(
      "duplicate",
    );

    expect(f.append).not.toHaveBeenCalled();
  });
});
