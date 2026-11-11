import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WorkoutExtractionSchema } from "../workout-schema.js";

export const DEFAULT_WORKOUTS_PATH = fileURLToPath(
  new URL("../../data/workouts.json", import.meta.url),
);

export const WorkoutRecordSchema = WorkoutExtractionSchema.extend({
  originalText: z.string(),
  savedAt: z.string().datetime(),
}).strict();

export type WorkoutRecord = z.infer<typeof WorkoutRecordSchema>;

export interface WorkoutFileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<unknown>;
}

const defaultFileSystem: WorkoutFileSystem = { readFile, mkdir, writeFile };

export class DuplicateWorkoutError extends Error {
  constructor() {
    super("Este entrenamiento ya esta guardado para la misma fecha.");
    this.name = "DuplicateWorkoutError";
  }
}

function normalizeText(value: string | null): string | null {
  return value?.trim().toLocaleLowerCase("es") ?? null;
}

export function createWorkoutDeduplicationKey(
  workout: Pick<WorkoutRecord, "workoutDate" | "exercises">,
): string {
  return JSON.stringify({
    workoutDate: normalizeText(workout.workoutDate),
    exercises: workout.exercises.map((exercise) => ({
      name: normalizeText(exercise.name),
      sets: exercise.sets,
      repetitions: exercise.repetitions,
      weight: normalizeText(exercise.weight),
      observations: normalizeText(exercise.observations),
    })),
  });
}

export function resolveWorkoutStoragePath(configuredPath?: string): string {
  return configuredPath ? resolve(process.cwd(), configuredPath) : DEFAULT_WORKOUTS_PATH;
}

export async function appendWorkoutRecord(
  record: WorkoutRecord,
  filePath: string,
  fileSystem: WorkoutFileSystem = defaultFileSystem,
): Promise<number> {
  let existingRecords: WorkoutRecord[] = [];

  try {
    const fileContents = await fileSystem.readFile(filePath, "utf8");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(fileContents);
    } catch (error) {
      throw new Error(`El archivo ${filePath} contiene JSON invalido. No se modifico.`, {
        cause: error,
      });
    }

    const parsedRecords = z.array(WorkoutRecordSchema).safeParse(parsedJson);
    if (!parsedRecords.success) {
      throw new Error(
        `Los entrenamientos existentes en ${filePath} no superan la validacion Zod. No se modifico.`,
        { cause: parsedRecords.error },
      );
    }
    existingRecords = parsedRecords.data;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      existingRecords = [];
    } else {
      throw error;
    }
  }

  const incomingKey = createWorkoutDeduplicationKey(record);
  if (
    existingRecords.some(
      (existing) => createWorkoutDeduplicationKey(existing) === incomingKey,
    )
  ) {
    throw new DuplicateWorkoutError();
  }

  const updatedRecords = [...existingRecords, record];
  try {
    await fileSystem.mkdir(dirname(filePath), { recursive: true });
    await fileSystem.writeFile(
      filePath,
      `${JSON.stringify(updatedRecords, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    throw new Error(`No se pudo escribir el archivo ${filePath}.`, { cause: error });
  }

  return updatedRecords.length;
}