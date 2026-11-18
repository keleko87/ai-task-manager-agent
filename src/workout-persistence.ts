import { createHash } from "node:crypto";
import { RunContext } from "@openai/agents";
import { saveWorkout } from "./tools/save-workout.js";
import { WorkoutExtractionSchema } from "./workout-schema.js";
import {
  createWorkoutDeduplicationKey,
  readWorkoutRecords,
  DuplicateWorkoutError,
} from "./storage/workout-store.js";
import type { NotionWorkoutInput } from "./notion/workout-to-notion-blocks.js";
import { workoutToNotionBlocks } from "./notion/workout-to-notion-blocks.js";
import type { createNotionWorkoutService } from "./notion/save-workout-to-notion.js";
import type { Preparation } from "./workout-orchestrator.js";

const localWrites = new Set<string>();

export async function prepareLocalWorkout(
  workout: NotionWorkoutInput,
  storagePath: string,
  enabled = true,
): Promise<Preparation> {
  // Zod creates an internal copy; external edits cannot change the approved snapshot.
  const extraction = WorkoutExtractionSchema.parse({
    workoutDate: workout.workoutDate,
    sessionName: workout.sessionName,
    exercises: workout.exercises,
  });
  const originalText = workout.originalText;
  const key = createWorkoutDeduplicationKey(extraction);

  if (
    (await readWorkoutRecords(storagePath)).some(
      (record) => createWorkoutDeduplicationKey(record) === key,
    )
  ) {
    return { status: "duplicate" };
  }

  const markdown = workoutToNotionBlocks(workout).markdown;
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        destination: "local",
        storagePath,
        extraction,
        originalText,
      }),
    )
    .digest("hex");
  let active = true;
  const expiresAt = Date.now() + 600_000;

  return {
    status: "ready",
    prepared: {
      preview: {
        destination: "local",
        target: storagePath,
        markdown,
        digest,
        writeEnabled: enabled,
      },
      cancel() {
        active = false;
      },
      async commit() {
        if (!active || Date.now() >= expiresAt || !enabled) {
          throw new Error("Autorización local ausente o caducada.");
        }

        active = false;

        if (localWrites.has(storagePath)) {
          throw new Error("Guardado local en curso.");
        }

        localWrites.add(storagePath);

        const context = {
          originalText,
          storagePath,
          approvedWorkoutJson: JSON.stringify(extraction) as string | null,
        };

        try {
          // The existing tool consumes its own TypeScript permission before writing and rechecks duplicates.
          await saveWorkout.invoke(
            new RunContext(context),
            JSON.stringify(extraction),
          );

          const records = await readWorkoutRecords(storagePath);
          const matching = records.filter(
            (record) =>
              createWorkoutDeduplicationKey(record) === key &&
              record.originalText === originalText,
          );

          if (matching.length !== 1) {
            throw new Error("Guardado local no verificado.");
          }

          return {
            status: "saved",
            verification: "VERIFIED",
            count: records.length,
          };
        } catch (error) {
          if (error instanceof DuplicateWorkoutError) {
            return { status: "duplicate" };
          }

          throw error;
        } finally {
          context.approvedWorkoutJson = null;

          localWrites.delete(storagePath);
        }
      },
    },
  };
}

export async function prepareNotionWorkout(
  service: ReturnType<typeof createNotionWorkoutService>,
  workout: NotionWorkoutInput,
  enabled = false,
): Promise<Preparation> {
  const result = await service.preview(workout, {}, "records-section-start");

  if (result.status !== "ready") {
    return result;
  }

  const { previewId, preview } = result;

  return {
    status: "ready",
    prepared: {
      preview: {
        destination: "notion",
        target: preview.destinationUrl,
        markdown: preview.markdown,
        digest: preview.digest,
        writeEnabled: enabled,
      },
      cancel: () => service.cancel(previewId),
      async commit() {
        if (!enabled) {
          throw new Error("Escritura Notion deshabilitada.");
        }

        return service.saveWorkoutToNotion({
          previewId,
          digest: preview.digest,
          approved: true,
        });
      },
    },
  };
}
