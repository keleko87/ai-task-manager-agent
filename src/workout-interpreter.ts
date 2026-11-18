import { OpenAIProvider, Runner } from "@openai/agents";
import { WorkoutExtractionAgent } from "./workout-agent.js";
import { NotionWorkoutInputSchema } from "./notion/workout-to-notion-blocks.js";

export const WorkoutInterpretationSchema = NotionWorkoutInputSchema.omit({
  originalText: true,
});

export function parseWorkoutInterpretation(output: unknown) {
  if (typeof output !== "string") {
    throw new Error("Respuesta del modelo sin texto JSON.");
  }

  const text = output
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return WorkoutInterpretationSchema.parse(JSON.parse(text));
}

export function createOllamaInterpreter() {
  const provider = new OpenAIProvider({
    apiKey: "ollama",
    baseURL: "http://localhost:11434/v1",
    useResponses: false,
  });
  const runner = new Runner({
    modelProvider: provider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });

  return {
    async interpret(text: string, signal?: AbortSignal) {
      const result = await runner.run(WorkoutExtractionAgent, text, {
        maxTurns: 2,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
      });

      return parseWorkoutInterpretation(result.finalOutput);
    },
    close: () => provider.close(),
  };
}
