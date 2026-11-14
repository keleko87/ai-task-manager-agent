import { tool } from "@openai/agents";
import { WorkoutExtractionSchema } from "../workout-schema.js";
import type { WorkoutRunContext } from "../workout-context.js";
import {
  appendWorkoutRecord,
  WorkoutRecordSchema,
} from "../storage/workout-store.js";

export const saveWorkout = tool<
  typeof WorkoutExtractionSchema,
  WorkoutRunContext
>({
  name: "saveWorkout",
  description:
    "Guarda un entrenamiento extraido. El runner siempre solicita aprobacion humana antes de ejecutar esta herramienta.",
  parameters: WorkoutExtractionSchema,
  needsApproval: true,
  errorFunction: null,
  execute: async (input, runContext) => {
    const workout = WorkoutExtractionSchema.parse(input);
    const context = runContext?.context;
    const workoutJson = JSON.stringify(workout);

    if (!context || context.approvedWorkoutJson !== workoutJson) {
      throw new Error(
        "saveWorkout requiere aprobacion explicita de la aplicacion.",
      );
    }

    context.approvedWorkoutJson = null;

    const record = WorkoutRecordSchema.parse({
      ...workout,
      originalText: context.originalText,
      savedAt: new Date().toISOString(),
    });
    const count = await appendWorkoutRecord(record, context.storagePath);

    return `Entrenamiento guardado correctamente. Total: ${count}.`;
  },
});
