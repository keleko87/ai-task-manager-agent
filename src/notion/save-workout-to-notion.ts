import { createHash, randomUUID } from "node:crypto";
import {
  assertDestination,
  NOTION_PAGE_ID,
  NOTION_PAGE_URL,
  type WorkoutReader,
  type WorkoutPage,
} from "./notion-read-service.js";
import {
  workoutToNotionBlocks,
  type NotionWorkoutInput,
  type WorkoutToNotionOptions,
} from "./workout-to-notion-blocks.js";

export interface WorkoutPreview {
  destinationId: typeof NOTION_PAGE_ID;
  destinationUrl: string;
  placement: "append-page-end";
  markdown: string;
  marker: string;
  digest: string;
}

/** This capability belongs to trusted application code, never to the model. */
export interface NotionAppendTransport {
  append(request: {
    pageId: typeof NOTION_PAGE_ID;
    markdown: string;
    expectedRevision: string;
  }): Promise<void>;
}

export interface WriteAuthorization {
  previewId: string;
  digest: string;
  approved: true;
}

type Prepared = {
  preview: Readonly<WorkoutPreview>;
  page: WorkoutPage;
  expiresAt: number;
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function checkDuplicate(
  page: WorkoutPage,
  marker: string,
  date: string,
): "duplicate" | "needs-clarification" | undefined {
  if (page.content.includes(marker)) {
    return "duplicate";
  }

  // Legacy approved records have no marker. Same-date content needs human reconciliation.
  const [year, month, day] = date.split("-");
  const months = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];

  if (
    page.content.includes(date) ||
    (page.content.includes(year!) &&
      new RegExp(`\\b${Number(day)}\\s+${months[Number(month) - 1]}`, "i").test(
        page.content,
      ))
  ) {
    return "needs-clarification";
  }
}

/** No Agents SDK registration: only the host can preview and authorize this flow. */
export function createNotionWorkoutService(options: {
  reader: WorkoutReader;
  writer?: NotionAppendTransport;
  now?: () => number;
}) {
  const pending = new Map<string, Prepared>();
  const now = options.now ?? Date.now;
  let busy = false;

  return {
    async preview(
      workout: NotionWorkoutInput,
      conversionOptions: WorkoutToNotionOptions = {},
      placement?: "append-page-end",
    ) {
      const conversion = workoutToNotionBlocks(workout, conversionOptions);
      const page = await options.reader.read();
      const conflict = checkDuplicate(
        page,
        conversion.marker,
        conversion.normalizedDate,
      );

      if (conflict) {
        return { status: conflict } as const;
      }

      if (!placement) {
        return { status: "needs-clarification" as const };
      }

      if (placement !== "append-page-end") {
        throw new Error("Ubicación no autorizada.");
      }

      const content = {
        destinationId: NOTION_PAGE_ID,
        destinationUrl: NOTION_PAGE_URL,
        placement,
        markdown: conversion.markdown,
        marker: conversion.marker,
      };
      const preview: WorkoutPreview = {
        ...content,
        digest: hash(JSON.stringify(content)),
      };
      const previewId = randomUUID();

      pending.set(previewId, {
        preview: Object.freeze(preview),
        page,
        expiresAt: now() + 600_000,
      });

      return {
        status: "ready" as const,
        previewId,
        preview: structuredClone(preview),
      };
    },
    cancel(previewId: string): void {
      pending.delete(previewId);
    },
    async saveWorkoutToNotion(authorization: WriteAuthorization) {
      const prepared = pending.get(authorization.previewId);

      // Consume before any await: cancellation, failure or retries require a new preview.
      pending.delete(authorization.previewId);

      if (
        !prepared ||
        authorization.approved !== true ||
        authorization.digest !== prepared.preview.digest ||
        now() >= prepared.expiresAt
      ) {
        throw new Error(
          "Autorización específica ausente, caducada o inválida.",
        );
      }

      if (!options.writer) {
        throw new Error(
          "Escritura deshabilitada: falta transporte OAuth verificado.",
        );
      }

      if (busy) {
        throw new Error("Ya hay un guardado en curso.");
      }

      busy = true;

      try {
        const { preview, page } = prepared;

        assertDestination(preview.destinationId);

        const latest = await options.reader.read();

        if (latest.content.includes(preview.marker)) {
          return { status: "duplicate" as const };
        }

        if (
          latest.revision !== page.revision ||
          latest.content !== page.content
        ) {
          throw new Error("La página cambió; genera otra vista previa.");
        }

        await options.writer.append({
          pageId: NOTION_PAGE_ID,
          markdown: preview.markdown,
          expectedRevision: latest.revision,
        });

        const verified = await options.reader.read();

        if (
          !verified.content.includes(preview.marker) ||
          !verified.content.includes(latest.content)
        ) {
          throw new Error(
            "Escritura no verificada; no se declara éxito. Revisa el destino antes de reintentar.",
          );
        }

        return {
          status: "saved" as const,
          marker: preview.marker,
          url: NOTION_PAGE_URL,
        };
      } finally {
        busy = false;
      }
    },
  };
}
