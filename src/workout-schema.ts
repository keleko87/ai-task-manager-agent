import { z } from "zod";

export const WorkoutExtractionSchema = z.object({
  workoutDate: z
    .string()
    .nullable()
    .default(null)
    .describe("Fecha mencionada en el texto o null; no la deduzcas."),
  exercises: z.array(
    z.object({
      name: z
        .string()
        .nullable()
        .default(null)
        .describe("Nombre mencionado o null."),
      sets: z.number().int().positive().safe().nullable().describe(
        "Número de series mencionado o null.",
      ).default(null),
      repetitions: z.number().int().positive().safe().nullable().describe(
        "Número de repeticiones mencionado o null.",
      ).default(null),
      weight: z
        .string()
        .nullable()
        .default(null)
        .describe("Peso exactamente como se indicó, con unidad, o null."),
      observations: z
        .string()
        .nullable()
        .default(null)
        .describe("Observaciones indicadas o null."),
    }),
  ),
}).strict();

export type WorkoutExtraction = z.infer<typeof WorkoutExtractionSchema>;

export function parseWorkoutToolArguments(argumentsJson: string): WorkoutExtraction {
  let candidate: unknown;
  try {
    candidate = JSON.parse(argumentsJson);
  } catch (error) {
    throw new Error("saveWorkout recibio JSON invalido.", { cause: error });
  }
  return WorkoutExtractionSchema.parse(candidate);
}
