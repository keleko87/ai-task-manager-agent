import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ZodError, z } from "zod";
import { WorkoutExtractionSchema } from "./workout-schema.js";
import { resolveWorkoutStoragePath } from "./storage/workout-store.js";
import type { WorkoutRunContext } from "./workout-context.js";

async function askForApproval(): Promise<boolean> {
  const readline = createInterface({ input: stdin, output: stdout });
  const abortController = new AbortController();
  readline.on("SIGINT", () => abortController.abort());

  try {
    const answer = await readline.question(
      "¿Autorizas guardar este entrenamiento? [s/N] ",
      { signal: abortController.signal },
    );
    return /^(s|si|sí)$/i.test(answer.trim());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return false;
    }
    throw error;
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  const originalText = process.argv.slice(2).join(" ").trim();
  if (!originalText) {
    console.error(
      'Uso: npm run agent:save -- "Hoy hice sentadillas: 3 series de 8 repeticiones"',
    );
    process.exitCode = 1;
    return;
  }

  const [{ WorkoutAgent }, { OpenAIProvider, Runner }] = await Promise.all([
    import("./workout-agent.js"),
    import("@openai/agents"),
  ]);
  const localProvider = new OpenAIProvider({
    apiKey: "ollama",
    baseURL: "http://localhost:11434/v1",
    useResponses: false,
  });
  const runner = new Runner({
    modelProvider: localProvider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });
  const context: WorkoutRunContext = {
    originalText,
    approvedWorkoutJson: null,
    storagePath: resolveWorkoutStoragePath(process.env.WORKOUTS_FILE),
  };

  try {
    const firstResult = await runner.run(WorkoutAgent, originalText, { context });
    const approval = firstResult.interruptions.find(
      (item) => item.name === "saveWorkout",
    );

    if (!approval) {
      console.error("El agente no solicito guardar. No se escribio ningun archivo.");
      if (typeof firstResult.finalOutput === "string") {
        console.error("Respuesta del agente:", firstResult.finalOutput);
      }
      process.exitCode = 1;
      return;
    }

    let workout: z.infer<typeof WorkoutExtractionSchema>;
    try {
      const rawArguments: unknown = JSON.parse(approval.arguments ?? "");
      workout = WorkoutExtractionSchema.parse(rawArguments);
    } catch (error) {
      firstResult.state.reject(approval, {
        message: "Los argumentos de guardado eran invalidos; no se guardo nada.",
      });
      if (error instanceof SyntaxError) {
        throw new Error("saveWorkout recibio JSON invalido; no se guardo nada.", {
          cause: error,
        });
      }
      if (error instanceof ZodError) {
        throw new Error("Los datos de saveWorkout no superaron Zod; no se guardo nada.", {
          cause: error,
        });
      }
      throw error;
    }

    console.log("\nVista previa del entrenamiento:");
    console.dir({ ...workout, originalText }, { depth: null, colors: true });
    console.log(`Archivo de destino: ${context.storagePath}`);

    if (!(await askForApproval())) {
      firstResult.state.reject(approval, {
        message: "El usuario cancelo o rechazo el guardado.",
      });
      console.log("Cancelado. No se guardo ningun entrenamiento.");
      return;
    }

    context.approvedWorkoutJson = JSON.stringify(workout);
    firstResult.state.approve(approval);
    const savedResult = await runner.run(WorkoutAgent, firstResult.state, {
      context,
    });

    if (typeof savedResult.finalOutput !== "string") {
      throw new Error("La herramienta no confirmo el guardado.");
    }
    console.log(savedResult.finalOutput);
  } finally {
    await localProvider.close();
  }
}

main().catch((error: unknown) => {
  console.error("No se pudo completar el flujo de guardado:", error);
  process.exitCode = 1;
});