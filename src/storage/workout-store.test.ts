import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendWorkoutRecord,
  createWorkoutDeduplicationKey,
  DEFAULT_WORKOUTS_PATH,
  DuplicateWorkoutError,
  resolveWorkoutStoragePath,
  type WorkoutRecord,
} from "./workout-store.js";

let temporaryDirectory: string;

async function createTempDirectory(): Promise<string> {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "ai-task-manager-tests-"));

  return temporaryDirectory;
}

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function makeRecord(overrides: Partial<WorkoutRecord> = {}): WorkoutRecord {
  return {
    workoutDate: "2026-11-09",
    exercises: [
      {
        name: "sentadillas",
        sets: 3,
        repetitions: 8,
        weight: "60 kg",
        observations: null,
      },
    ],
    originalText: "Hice sentadillas",
    savedAt: "2026-11-09T12:00:00.000Z",
    ...overrides,
  };
}

describe("appendWorkoutRecord", () => {
  it("crea el archivo y sus carpetas si no existen", async () => {
    const directory = await createTempDirectory();
    const filePath = join(directory, "nested", "workouts.json");

    await expect(appendWorkoutRecord(makeRecord(), filePath)).resolves.toBe(1);

    const saved = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as WorkoutRecord[];

    expect(saved).toHaveLength(1);

    expect(saved[0]?.originalText).toBe("Hice sentadillas");
  });

  it("anade registros sin sobrescribir los anteriores", async () => {
    const directory = await createTempDirectory();
    const filePath = join(directory, "workouts.json");
    const first = makeRecord();
    const second = makeRecord({
      workoutDate: "2026-11-10",
      originalText: "Hice sentadillas al dia siguiente",
    });

    await appendWorkoutRecord(first, filePath);

    await expect(appendWorkoutRecord(second, filePath)).resolves.toBe(2);

    const saved = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as WorkoutRecord[];

    expect(saved.map((record) => record.workoutDate)).toEqual([
      "2026-11-09",
      "2026-11-10",
    ]);
  });

  it("rechaza JSON corrupto sin modificarlo", async () => {
    const directory = await createTempDirectory();
    const filePath = join(directory, "workouts.json");

    await writeFile(filePath, "{broken", "utf8");

    await expect(appendWorkoutRecord(makeRecord(), filePath)).rejects.toThrow(
      /JSON invalido/,
    );

    await expect(readFile(filePath, "utf8")).resolves.toBe("{broken");
  });

  it("rechaza registros existentes que no cumplen Zod", async () => {
    const directory = await createTempDirectory();
    const filePath = join(directory, "workouts.json");

    await writeFile(
      filePath,
      JSON.stringify([{ workoutDate: "ayer" }]),
      "utf8",
    );

    await expect(appendWorkoutRecord(makeRecord(), filePath)).rejects.toThrow(
      /no superan la validacion Zod/,
    );
  });

  it("propaga errores de escritura y no afirma que guardo", async () => {
    const directory = await createTempDirectory();
    const filePath = join(directory, "workouts.json");
    const fileSystem = {
      readFile: vi.fn(async () => {
        const error = Object.assign(new Error("missing"), { code: "ENOENT" });

        throw error;
      }),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => {
        throw new Error("disk full");
      }),
    };

    await expect(
      appendWorkoutRecord(makeRecord(), filePath, fileSystem),
    ).rejects.toThrow(/No se pudo escribir/);
  });
});

describe("resolveWorkoutStoragePath", () => {
  it("usa la ruta de data/workouts.json por defecto", () => {
    expect(resolveWorkoutStoragePath()).toBe(DEFAULT_WORKOUTS_PATH);
  });

  it("resuelve una ruta configurada desde el directorio actual", () => {
    expect(resolveWorkoutStoragePath(".tmp/test.json")).toBe(
      join(process.cwd(), ".tmp", "test.json"),
    );
  });
});

describe("deduplicacion", () => {
  it("detecta duplicados exactos independientemente del texto y guardado", async () => {
    const directory = await createTempDirectory();
    const filePath = join(directory, "workouts.json");
    const first = makeRecord();
    const repeated = makeRecord({
      originalText: "Otra forma de describirlo",
      savedAt: "2026-11-09T13:00:00.000Z",
    });

    expect(createWorkoutDeduplicationKey(first)).toBe(
      createWorkoutDeduplicationKey(repeated),
    );

    await appendWorkoutRecord(first, filePath);

    await expect(
      appendWorkoutRecord(repeated, filePath),
    ).rejects.toBeInstanceOf(DuplicateWorkoutError);

    const saved = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as WorkoutRecord[];

    expect(saved).toHaveLength(1);
  });

  it("permite los mismos ejercicios en fechas distintas", async () => {
    const directory = await createTempDirectory();
    const filePath = join(directory, "workouts.json");

    await appendWorkoutRecord(makeRecord(), filePath);

    await expect(
      appendWorkoutRecord(makeRecord({ workoutDate: "2026-11-10" }), filePath),
    ).resolves.toBe(2);
  });
});
