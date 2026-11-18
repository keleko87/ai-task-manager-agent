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
import {
  createNotionWorkoutService,
  NotionVerificationError,
} from "./notion/save-workout-to-notion.js";

setTracingDisabled(true);

const args = process.argv.slice(2);
const enableNotion = args.includes("--enable-one-notion-write");
const previewOnly = args.includes("--preview-only");
const textArgs = args.filter(
  (arg) => !["--enable-one-notion-write", "--preview-only"].includes(arg),
);

if (textArgs.length !== 1 || textArgs[0]!.startsWith("--")) {
  throw new Error(
    'Uso: npm run agent:workout -- "entrenamiento" [--preview-only] [--enable-one-notion-write]',
  );
}

const originalText = textArgs[0]!;
const interpreter = createOllamaInterpreter();
const prompt = createInterface({ input: stdin, output: stdout });
let server: ReturnType<typeof createReadServer> | undefined;
let provider: NotionOAuthProvider | undefined;
let notion: ReturnType<typeof createNotionWorkoutService> | undefined;
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const flow = createWorkoutOrchestrator({
  referenceDate: today,
  interpret: interpreter.interpret,
  async clarify(reason) {
    if (!stdin.isTTY) {
      return null;
    }

    const answer = await prompt.question(
      `${reason}\nAclaración (Enter cancela): `,
    );

    return answer.trim() ? answer : null;
  },
  async selectDestination() {
    if (!stdin.isTTY) {
      return null;
    }

    const answer = (
      await prompt.question(
        "Destino explícito: local / notion (Enter cancela): ",
      )
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
      return prepareLocalWorkout(
        workout,
        resolveWorkoutStoragePath(process.env.WORKOUTS_FILE),
        !previewOnly,
      );
    }

    if (!notion) {
      provider = new NotionOAuthProvider();

      server = createReadServer(provider, enableNotion && !previewOnly);

      await authorizeNotion(provider);

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

    return prepareNotionWorkout(notion, workout, enableNotion && !previewOnly);
  },
  show(preview) {
    console.log(
      `\nDestino: ${preview.destination} — ${preview.target}\n${preview.markdown}\nDigest: ${preview.digest}\nEscritura habilitada: ${preview.writeEnabled}`,
    );
  },
  async confirm(preview) {
    if (!stdin.isTTY) {
      return "cancel";
    }

    const answer = await prompt.question(
      `Escribe GUARDAR ${preview.digest} para autorizar una vez, EDITAR para corregir o Enter para cancelar:\n> `,
    );

    return answer === `GUARDAR ${preview.digest}`
      ? "approve"
      : answer === "EDITAR"
        ? "edit"
        : "cancel";
  },
});

try {
  console.dir(await flow.run(originalText), { depth: null });
} catch (error) {
  if (error instanceof NotionVerificationError) {
    console.error(error.verification);
  } else {
    console.error(
      "No se completó el flujo. No hay fallback ni reintentos automáticos. Si hubo un intento remoto, verifica Notion en solo lectura.",
    );
  }

  process.exitCode = 1;
} finally {
  prompt.close();

  await interpreter.close();

  await server?.close().catch(() => undefined);

  await provider?.close();
}
