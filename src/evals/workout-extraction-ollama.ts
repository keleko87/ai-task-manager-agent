import assert from "node:assert/strict";
import { createOllamaInterpreter } from "../workout-interpreter.js";

// Explicit integration eval: extraction only; no storage, Notion or approval capabilities.
const cases = [
  {
    name: "series comunes",
    input:
      "El 18 de noviembre de 2026 hice press banca, tres series de diez repeticiones con 60 kg.",
    check(
      result: Awaited<
        ReturnType<ReturnType<typeof createOllamaInterpreter>["interpret"]>
      >,
    ) {
      const exercise = result.exercises[0]!;

      assert.match(exercise.name ?? "", /press/i);

      if (exercise.individualSets) {
        assert.equal(exercise.individualSets.length, 3);

        exercise.individualSets.forEach((set) => {
          assert.equal(set.repetitions, 10);

          assert.match(set.weight ?? "", /60\s*kg/);
        });
      } else {
        assert.equal(exercise.sets, 3);

        assert.equal(exercise.repetitions, 10);

        assert.match(exercise.weight ?? "", /60\s*kg/);
      }
    },
  },
  {
    name: "series variables",
    input:
      "Hoy he hecho press banca inclinado. Primera serie, 35 kg y 8 repeticiones. Segunda serie, 32,5 kg y 8 repeticiones.",
    check(
      result: Awaited<
        ReturnType<ReturnType<typeof createOllamaInterpreter>["interpret"]>
      >,
    ) {
      assert.equal(result.workoutDate?.toLowerCase(), "hoy");

      const sets = result.exercises[0]?.individualSets;

      assert.equal(sets?.length, 2);

      assert.equal(sets![0]!.repetitions, 8);

      assert.equal(sets![1]!.repetitions, 8);

      assert.match(sets![0]!.weight ?? "", /35\s*kg/);

      assert.match(sets![1]!.weight ?? "", /32[,.]5\s*kg/);
    },
  },
];
const interpreter = createOllamaInterpreter();

try {
  for (const example of cases) {
    const result = await interpreter.interpret(example.input);

    example.check(result);

    console.log(`PASS: ${example.name}`);
  }
} catch (error) {
  console.error(
    "Eval Ollama fallido (sin escrituras):",
    error instanceof Error ? error.message : "error desconocido",
  );

  process.exitCode = 1;
} finally {
  await interpreter.close();
}
