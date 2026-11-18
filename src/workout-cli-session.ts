import {
  formatWorkoutFlowError,
  type WorkoutFlowStage,
} from "./workout-flow-error.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setTracingDisabled } from "@openai/agents";
import { createOllamaInterpreter } from "./workout-interpreter.js";
import { createWorkoutOrchestrator } from "./workout-orchestrator.js";
import {
  prepareLocalWorkout,
  prepareNotionWorkout,
} from "./workout-persistence.js";
import { resolveWorkoutStoragePath } from "./storage/workout-store.js";
import { NotionOAuthProvider, authorizeNotion } from "./notion/notion-oauth.js";
import {
  createReadServer,
  createMcpWorkoutReader,
} from "./notion/notion-mcp-read.js";
import { createMcpWorkoutWriter } from "./notion/notion-mcp-write.js";
import { createNotionWorkoutService } from "./notion/save-workout-to-notion.js";

export class WorkoutCliError extends Error {}

/** Shared terminal adapter for approved text and voice. Core orchestration stays UI-independent. */
export async function runWorkoutCliSession(
  originalText: string,
  options: {
    previewOnly: boolean;
    enableNotion: boolean;
    signal?: AbortSignal;
  },
) {
  setTracingDisabled(true);

  const { previewOnly, enableNotion } = options;
  const interpreter = createOllamaInterpreter();
  const cancellation = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, cancellation.signal])
    : cancellation.signal;
  const prompt = createInterface({ input: stdin, output: stdout });

  prompt.on("SIGINT", () => cancellation.abort());

  const question = (message: string) => prompt.question(message, { signal });
  let server: ReturnType<typeof createReadServer> | undefined;
  let provider: NotionOAuthProvider | undefined;
  let notion: ReturnType<typeof createNotionWorkoutService> | undefined;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  let stage: WorkoutFlowStage = "interpretación con Ollama";

  const flow = createWorkoutOrchestrator({
    referenceDate: today,
    async interpret(text) {
      stage = "interpretación con Ollama";

      return interpreter.interpret(text, signal);
    },
    async clarify(reason) {
      stage = "aclaración";

      if (!stdin.isTTY) {
        return null;
      }

      const answer = await question(`${reason}\nAclaración (Enter cancela): `);

      return answer.trim() ? answer : null;
    },
    async selectDestination() {
      stage = "selección de destino";

      if (!stdin.isTTY) {
        return null;
      }

      const answer = (
        await question("Destino explícito: local / notion (Enter cancela): ")
      )
        .trim()
        .toLowerCase();

      if (answer === "local" || answer === "notion") {
        return answer;
      }

      return null;
    },
    async prepare(destination, workout) {
      if (destination === "local") {
        stage = "preparación local";

        return prepareLocalWorkout(
          workout,
          resolveWorkoutStoragePath(process.env.WORKOUTS_FILE),
          !previewOnly,
        );
      }

      if (!notion) {
        provider = new NotionOAuthProvider();

        server = createReadServer(provider, enableNotion && !previewOnly);

        stage = "OAuth de Notion";

        await authorizeNotion(provider);

        stage = "conexión MCP";

        await server.connect();

        const reader = createMcpWorkoutReader(server);

        notion = createNotionWorkoutService({
          reader,
          writer:
            enableNotion && !previewOnly
              ? createMcpWorkoutWriter(server, reader, true)
              : undefined,
        });
      }

      stage = "lectura y vista previa de Notion";

      return prepareNotionWorkout(
        notion,
        workout,
        enableNotion && !previewOnly,
      );
    },
    show(preview) {
      console.log(
        `\nDestino: ${preview.destination} — ${preview.target}\n${preview.markdown}\nDigest: ${preview.digest}\nEscritura habilitada: ${preview.writeEnabled}`,
      );
    },
    async confirm(preview) {
      stage = "confirmación";

      if (!stdin.isTTY) {
        return "cancel";
      }

      const answer = await question(
        `Escribe GUARDAR ${preview.digest} para autorizar una vez, EDITAR para corregir o Enter para cancelar:\n> `,
      );

      if (answer === `GUARDAR ${preview.digest}`) {
        stage = "guardado y verificación";
      }

      return answer === `GUARDAR ${preview.digest}`
        ? "approve"
        : answer === "EDITAR"
          ? "edit"
          : "cancel";
    },
  });

  try {
    const result = await flow.run(originalText);

    console.dir(result, { depth: null });

    return result;
  } catch (error) {
    if (signal.aborted) {
      return { status: "cancelled" as const };
    }

    throw new WorkoutCliError(formatWorkoutFlowError(error, stage));
  } finally {
    prompt.close();

    await interpreter.close();

    await server?.close().catch(() => undefined);

    await provider?.close();
  }
}
