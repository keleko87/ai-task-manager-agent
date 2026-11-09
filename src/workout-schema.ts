import { z } from "zod";

export const WorkoutExtractionSchema = z.object({
  workoutDate: z
    .string()
    .nullable()
    .describe("Fecha mencionada en el texto o null; no la deduzcas."),
  exercises: z.array(
    z.object({
      name: z.string().nullable().describe("Nombre mencionado o null."),
      sets: z.number().int().nullable().describe(
        "Número de series mencionado o null.",
      ),
      repetitions: z.number().int().nullable().describe(
        "Número de repeticiones mencionado o null.",
      ),
      weight: z
        .string()
        .nullable()
        .describe("Peso exactamente como se indicó, con unidad, o null."),
      observations: z
        .string()
        .nullable()
        .describe("Observaciones indicadas o null."),
    }),
  ),
}).strict();
