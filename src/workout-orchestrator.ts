import {
  NotionWorkoutInputSchema,
  WorkoutClarificationRequired,
  workoutToNotionBlocks,
  type NotionWorkoutInput,
} from "./notion/workout-to-notion-blocks.js";
import { WorkoutInterpretationSchema } from "./workout-interpreter.js";

export type WorkoutDestination = "local" | "notion";

export interface SavePreview {
  destination: WorkoutDestination;
  target: string;
  markdown: string;
  digest: string;
  writeEnabled: boolean;
}

export interface PreparedSave {
  preview: SavePreview;
  commit(): Promise<unknown>;

  cancel(): void;
}

export type Preparation =
  | { status: "ready"; prepared: PreparedSave }
  | { status: "duplicate" | "needs-clarification" };

export interface WorkoutFlowDependencies {
  interpret(text: string): Promise<unknown>;

  clarify(reason: string): Promise<string | null>;

  selectDestination(): Promise<WorkoutDestination | null>;

  prepare(
    destination: WorkoutDestination,
    workout: NotionWorkoutInput,
  ): Promise<Preparation>;

  show(preview: SavePreview): void;

  confirm(preview: SavePreview): Promise<"approve" | "cancel" | "edit">;
  referenceDate: string;
}

/** Model only extracts. Host UI selects destination and approves a frozen snapshot. */
export function createWorkoutOrchestrator(deps: WorkoutFlowDependencies) {
  let running = false;

  return {
    async run(originalText: string) {
      if (running) {
        throw new Error("Ya hay un flujo en curso.");
      }

      if (!originalText.trim()) {
        throw new Error("Falta la transcripción.");
      }

      running = true;

      let pending: PreparedSave | undefined;
      let prompt = originalText;

      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          let workout: NotionWorkoutInput;

          try {
            const interpretation = WorkoutInterpretationSchema.parse(
              await deps.interpret(prompt),
            );

            workout = NotionWorkoutInputSchema.parse({
              ...interpretation,
              originalText,
            });

            const conversion = workoutToNotionBlocks(workout, {
              referenceDate: deps.referenceDate,
            });

            workout.workoutDate = conversion.normalizedDate;
          } catch (error) {
            if (
              !(error instanceof WorkoutClarificationRequired) &&
              !(error instanceof Error && error.name === "ZodError")
            ) {
              throw error;
            }

            const clarification = await deps.clarify(
              "Aclara fecha, ejercicios o series inconsistentes. No se guardó nada.",
            );

            if (!clarification) {
              return { status: "cancelled" as const };
            }

            prompt += `\nAclaración explícita del usuario: ${clarification}`;

            continue;
          }

          const destination = await deps.selectDestination();

          if (destination === null) {
            return { status: "cancelled" as const };
          }

          if (destination !== "local" && destination !== "notion") {
            throw new Error("Destino no autorizado.");
          }

          const preparation = await deps.prepare(destination, workout);

          if (preparation.status !== "ready") {
            return preparation;
          }

          pending = preparation.prepared;

          const preview = structuredClone(pending.preview);

          if (preview.destination !== destination) {
            throw new Error("El destino de la vista previa no coincide.");
          }

          deps.show(structuredClone(preview));

          if (!preview.writeEnabled) {
            return { status: "preview-only" as const };
          }

          const decision = await deps.confirm(structuredClone(preview));

          if (decision === "edit") {
            pending.cancel();

            pending = undefined;

            const clarification = await deps.clarify(
              "Indica la corrección; la autorización anterior está invalidada.",
            );

            if (!clarification) {
              return { status: "cancelled" as const };
            }

            prompt += `\nCorrección explícita del usuario: ${clarification}`;

            continue;
          }

          if (decision !== "approve") {
            return { status: "cancelled" as const };
          }

          const result = await pending.commit();

          return { status: "completed" as const, destination, result };
        }

        return { status: "needs-clarification" as const };
      } finally {
        pending?.cancel();

        running = false;
      }
    },
  };
}
