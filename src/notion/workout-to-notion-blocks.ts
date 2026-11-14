import { createHash } from "node:crypto";
import { z } from "zod";
import { WorkoutExtractionSchema } from "../workout-schema.js";

const ExerciseSchema = WorkoutExtractionSchema.shape.exercises.element
  .extend({
    // Explicit series preserve variable loads, reps and supersets without inference.
    individualSets: z
      .array(
        z
          .object({
            repetitions: z.number().int().positive().safe().nullable(),
            weight: z.string().nullable(),
            observations: z.string().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .strict();

export const NotionWorkoutInputSchema = WorkoutExtractionSchema.extend({
  exercises: z.array(ExerciseSchema),
  sessionName: z.string().nullable().default(null),
  originalText: z
    .string()
    .refine((value) => value.trim().length > 0, "La nota original está vacía"),
}).strict();

export type NotionWorkoutInput = z.infer<typeof NotionWorkoutInputSchema>;

export type NotionWorkoutBlock = {
  type:
    "heading_2" | "heading_3" | "paragraph" | "bulleted_list_item" | "quote";
  text: string;
};

export interface WorkoutToNotionOptions {
  referenceDate?: string;
  maxSeriesPerExercise?: number;
}

export interface NotionWorkoutConversion {
  normalizedDate: string;
  sessionName: string | null;
  deduplicationKey: string;
  marker: string;
  blocks: NotionWorkoutBlock[];
  markdown: string;
}

export class WorkoutClarificationRequired extends Error {}

function iso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function normalizeWorkoutDate(
  value: string | null,
  referenceDate?: string,
): string {
  const input = value?.trim().toLocaleLowerCase("es");

  if (input && iso(input)) {
    return input;
  }

  if (
    (input === "hoy" || input === "ayer") &&
    referenceDate &&
    iso(referenceDate)
  ) {
    const date = new Date(`${referenceDate}T00:00:00Z`);

    if (input === "ayer") {
      date.setUTCDate(date.getUTCDate() - 1);
    }

    return date.toISOString().slice(0, 10);
  }

  throw new WorkoutClarificationRequired(
    "Aclara la fecha exacta; hoy/ayer requieren una referencia explícita.",
  );
}

const canonicalText = (value: string | null) =>
  value?.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es") ||
  null;

function canonical(value: unknown): unknown {
  if (typeof value === "string") {
    return canonicalText(value);
  }

  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, canonical(val)]),
    );
  }

  return value;
}

function render(block: NotionWorkoutBlock): string {
  // Escape literal user text, including HTML/Notion tags and newlines.
  const text = block.text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+!|~-]/g, "\\$&");

  if (
    block.type === "paragraph" &&
    /^Registro ID: workout-agent:v1:[a-f0-9]{64}$/.test(block.text)
  ) {
    return `Registro ID: \`${block.text.slice(13)}\``;
  }

  if (block.type === "quote") {
    const fence = "`".repeat(
      Math.max(
        3,
        ...(block.text.match(/`+/g) ?? []).map((run) => run.length + 1),
      ),
    );

    return `${fence}text\n${block.text}\n${fence}`;
  }

  const prefix = {
    heading_2: "### ",
    heading_3: "#### ",
    paragraph: "",
    bulleted_list_item: "- ",
  }[block.type];

  return prefix + text.replace(/\r?\n/g, " \\\n");
}

export function workoutToNotionBlocks(
  input: NotionWorkoutInput,
  options: WorkoutToNotionOptions = {},
): NotionWorkoutConversion {
  const workout = NotionWorkoutInputSchema.parse(input);
  const normalizedDate = normalizeWorkoutDate(
    workout.workoutDate,
    options.referenceDate,
  );
  const sessionName = workout.sessionName?.trim() || null;

  if (
    !workout.exercises.length ||
    workout.exercises.some((ex) => !ex.name?.trim())
  ) {
    throw new WorkoutClarificationRequired(
      "Aclara los ejercicios y sus nombres.",
    );
  }

  const blocks: NotionWorkoutBlock[] = [];

  for (const ex of workout.exercises) {
    if (
      (ex.sets ?? 0) > (options.maxSeriesPerExercise ?? 100) ||
      (ex.individualSets &&
        ex.sets !== null &&
        ex.sets !== ex.individualSets.length)
    ) {
      throw new WorkoutClarificationRequired("Revisa el número de series.");
    }

    blocks.push({ type: "heading_3", text: ex.name! });

    const sets =
      ex.individualSets ??
      (ex.sets === null
        ? []
        : Array.from({ length: ex.sets }, () => ({
            repetitions: ex.repetitions,
            weight: ex.weight,
            observations: null,
          })));

    if (!sets.length) {
      blocks.push({
        type: "bulleted_list_item",
        text: `Series: no indicadas · Repeticiones por serie: ${ex.repetitions ?? "no indicadas"} · Carga: ${ex.weight ?? "no indicada"}`,
      });
    }

    sets.forEach((set, index) =>
      blocks.push({
        type: "bulleted_list_item",
        text: `Serie ${index + 1}: ${set.repetitions ?? "repeticiones no indicadas"} · Carga: ${set.weight ?? "no indicada"}${set.observations ? ` · ${set.observations}` : ""}`,
      }),
    );

    if (ex.observations) {
      blocks.push({
        type: "paragraph",
        text: `Observaciones: ${ex.observations}`,
      });
    }
  }

  const deduplicationKey = createHash("sha256")
    .update(
      JSON.stringify(
        canonical({ ...workout, workoutDate: normalizedDate, sessionName }),
      ),
    )
    .digest("hex");
  const marker = `workout-agent:v1:${deduplicationKey}`;

  blocks.unshift(
    {
      type: "heading_2",
      text: normalizedDate + (sessionName ? ` · ${sessionName}` : ""),
    },
    { type: "paragraph", text: `Registro ID: ${marker}` },
  );

  blocks.push(
    { type: "heading_3", text: "Nota original" },
    { type: "quote", text: input.originalText },
  );

  return {
    normalizedDate,
    sessionName,
    deduplicationKey,
    marker,
    blocks,
    markdown: blocks.map(render).join("\n\n"),
  };
}
