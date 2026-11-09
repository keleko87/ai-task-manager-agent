import { WorkoutExtractionSchema } from "./workout-schema.js";

async function main(): Promise<void> {
  const originalText = process.argv.slice(2).join(" ").trim();
  if (!originalText) {
    console.error(
      'Uso: npm run agent:test -- "Entrené sentadillas: 3 series de 8 repeticiones con 60 kg"',
    );
    process.exitCode = 1;
    return;
  }

  const [{ WorkoutExtractionAgent }, { OpenAIProvider, Runner }] = await Promise.all([
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

  try {
    const result = await runner.run(WorkoutExtractionAgent, originalText);
    if (typeof result.finalOutput !== "string") {
      throw new Error("WorkoutAgent no devolvió una respuesta de texto.");
    }

    const responseText = result.finalOutput
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const jsonStart = responseText.indexOf("{");
    const jsonEnd = responseText.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd <= jsonStart) {
      throw new Error("La respuesta del modelo no contiene un objeto JSON.");
    }

    const candidate: unknown = JSON.parse(
      responseText.slice(jsonStart, jsonEnd + 1),
    );
    const extraction = WorkoutExtractionSchema.parse(candidate);
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
