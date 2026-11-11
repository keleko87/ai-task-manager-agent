import { describe, expect, it } from "vitest";
import {
  parseWorkoutToolArguments,
  WorkoutExtractionSchema,
} from "./workout-schema.js";

describe("WorkoutExtractionSchema", () => {
  it("acepta una extraccion valida y conserva el texto original por separado", () => {
    const originalText = "Hoy hice sentadillas: tres series de ocho con 60 kg";
    const extraction = WorkoutExtractionSchema.parse({
      workoutDate: "hoy",
      exercises: [
        {
          name: "sentadillas",
          sets: 3,
          repetitions: 8,
          weight: "60 kg",
          observations: null,
        },
      ],
    });

    expect({ ...extraction, originalText }).toEqual({
      workoutDate: "hoy",
      exercises: [
        {
          name: "sentadillas",
          sets: 3,
          repetitions: 8,
          weight: "60 kg",
          observations: null,
        },
      ],
      originalText,
    });
  });

  it("normaliza campos omitidos a null", () => {
    expect(
      WorkoutExtractionSchema.parse({
        exercises: [{}, { name: "remo" }],
      }),
    ).toEqual({
      workoutDate: null,
      exercises: [
        {
          name: null,
          sets: null,
          repetitions: null,
          weight: null,
          observations: null,
        },
        {
          name: "remo",
          sets: null,
          repetitions: null,
          weight: null,
          observations: null,
        },
      ],
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rechaza una cantidad fuera del rango valido: %s",
    (sets) => {
      expect(() =>
        WorkoutExtractionSchema.parse({
          exercises: [{ sets }],
        }),
      ).toThrow();
    },
  );

  it("acepta el mayor entero seguro positivo", () => {
    expect(
      WorkoutExtractionSchema.parse({
        exercises: [{ sets: Number.MAX_SAFE_INTEGER }],
      }).exercises[0]?.sets,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rechaza tipos incorrectos y propiedades desconocidas", () => {
    expect(() =>
      WorkoutExtractionSchema.parse({ workoutDate: 123, exercises: [] }),
    ).toThrow();
    expect(() =>
      WorkoutExtractionSchema.parse({ exercises: [], unexpected: true }),
    ).toThrow();
  });
});

describe("parseWorkoutToolArguments", () => {
  it("analiza JSON y devuelve datos normalizados por Zod", () => {
    expect(parseWorkoutToolArguments('{"exercises":[{"name":"press"}]}')).toEqual({
      workoutDate: null,
      exercises: [
        {
          name: "press",
          sets: null,
          repetitions: null,
          weight: null,
          observations: null,
        },
      ],
    });
  });

  it("rechaza JSON malformado y JSON con datos invalidos", () => {
    expect(() => parseWorkoutToolArguments("{" )).toThrow(/JSON invalido/);
    expect(() =>
      parseWorkoutToolArguments('{"exercises":[{"sets":"muchas"}]}'),
    ).toThrow();
  });
});