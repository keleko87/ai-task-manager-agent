import { RunContext } from "@openai/agents";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveWorkout } from "./tools/save-workout.js";
import type { WorkoutRunContext } from "./workout-context.js";
import {
  parseWorkoutToolArguments,
  WorkoutExtractionSchema,
} from "./workout-schema.js";
import { confirmAndResumeWorkoutSave } from "./workout-save-approval.js";

let temporaryDirectory: string;

async function createContext(): Promise<WorkoutRunContext> {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "ai-task-manager-approval-"));
  return {
    originalText: "Hoy hice press banca, tres series de diez con 60 kg",
    approvedWorkoutJson: null,
    storagePath: join(temporaryDirectory, "workouts.json"),
  };
}

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

const workout = parseWorkoutToolArguments(
  JSON.stringify({
    workoutDate: "hoy",
    exercises: [
      {
        name: "press banca",
        sets: 3,
        repetitions: 10,
        weight: "60 kg",
        observations: null,
      },
    ],
  }),
);

describe("saveWorkout approval", () => {
  it("requiere aprobacion humana segun el Agents SDK", async () => {
    expect(saveWorkout.name).toBe("saveWorkout");
    expect(typeof saveWorkout.needsApproval).toBe("function");
    await expect(
      saveWorkout.needsApproval(new RunContext({} as WorkoutRunContext), workout),
    ).resolves.toBe(true);
  });

  it("no permite invocar la herramienta directamente sin autorizacion TypeScript", async () => {
    const context = await createContext();

    await expect(
      saveWorkout.invoke(new RunContext(context), JSON.stringify(workout)),
    ).rejects.toThrow(/requiere aprobacion explicita/);
    await expect(readFile(context.storagePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("el rechazo no aprueba, no reanuda y no escribe", async () => {
    const context = await createContext();
    const approval = { name: "saveWorkout" };
    const state = { approve: vi.fn(), reject: vi.fn() };
    const resume = vi.fn(async () => "saved");

    const result = await confirmAndResumeWorkoutSave({
      workout,
      approval,
      state,
      context,
      confirm: async () => false,
      resume,
    });

    expect(result).toEqual({ approved: false });
    expect(state.reject).toHaveBeenCalledOnce();
    expect(state.approve).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    await expect(readFile(context.storagePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("tras aprobacion reanuda una vez y ejecuta la tool real", async () => {
    const context = await createContext();
    const approval = { name: "saveWorkout" };
    const state = { approve: vi.fn(), reject: vi.fn() };
    const resume = vi.fn(() =>
      saveWorkout.invoke(new RunContext(context), JSON.stringify(workout)),
    );

    const result = await confirmAndResumeWorkoutSave({
      workout,
      approval,
      state,
      context,
      confirm: async () => true,
      resume,
    });

    expect(result).toMatchObject({ approved: true });
    expect(state.approve).toHaveBeenCalledOnce();
    expect(state.reject).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledOnce();
    expect(context.approvedWorkoutJson).toBeNull();

    const records = JSON.parse(await readFile(context.storagePath, "utf8")) as {
      originalText: string;
    }[];
    expect(records).toHaveLength(1);
    expect(records[0]?.originalText).toBe(context.originalText);
  });

  it("consume la autorizacion antes de persistir y no permite reutilizarla", async () => {
    const context = await createContext();
    context.approvedWorkoutJson = JSON.stringify(workout);
    const runContext = new RunContext(context);

    await saveWorkout.invoke(runContext, JSON.stringify(workout));
    await expect(
      saveWorkout.invoke(runContext, JSON.stringify(workout)),
    ).rejects.toThrow(/requiere aprobacion explicita/);
  });
});