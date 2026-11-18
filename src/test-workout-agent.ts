import { parseWorkoutInterpretation } from "./workout-interpreter.js";

async function main(): Promise<void> {
  const originalText = process.argv.slice(2).join(" ").trim();

  if (!originalText) {
    console.error(
      'Uso: npm run agent:test -- "Entrené sentadillas: 3 series de 8 repeticiones con 60 kg"',
    );

    process.exitCode = 1;

    return;
  }

  const [{ WorkoutExtractionAgent }, { OpenAIProvider, Runner }] =
    await Promise.all([import("./workout-agent.js"), import("@openai/agents")]);
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

  try {
    const result = await runner.run(WorkoutExtractionAgent, originalText);

    if (typeof result.finalOutput !== "string") {
      throw new Error("WorkoutAgent no devolvió una respuesta de texto.");
    }

    const extraction = parseWorkoutInterpretation(result.finalOutput);

    console.dir(
      {
        ...extraction,
        originalText,
      },
      { depth: null, colors: true },
    );
  } finally {
    await localProvider.close();
  }
}

main().catch((error: unknown) => {
  console.error("No se pudo completar la prueba del WorkoutAgent:", error);

  process.exitCode = 1;
});
