import { describe, expect, it, vi } from "vitest";
import {
  createWorkoutOrchestrator,
  type WorkoutFlowDependencies,
  type Preparation,
} from "./workout-orchestrator.js";
import { parseWorkoutInterpretation } from "./workout-interpreter.js";

const interpretation = {
  workoutDate: "hoy",
  exercises: [
    {
      name: "Press",
      sets: 2,
      repetitions: null,
      weight: null,
      observations: null,
      individualSets: [
        { repetitions: 8, weight: "35 kg", observations: null },
        { repetitions: 8, weight: "32,5 kg", observations: null },
      ],
    },
  ],
};

function fixture() {
  const commit = vi.fn(async () => ({
    status: "saved",
    verification: { status: "VERIFIED" },
  }));
  const cancel = vi.fn();
  const prepare = vi.fn(
    async (destination: "local" | "notion"): Promise<Preparation> => ({
      status: "ready",
      prepared: {
        preview: {
          destination,
          target: "fixed target",
          markdown: "snapshot",
          digest: "digest",
          writeEnabled: true,
        },
        commit,
        cancel,
      },
    }),
  );
  const deps: WorkoutFlowDependencies = {
    referenceDate: "2026-11-18",
    interpret: vi.fn(async () => interpretation),
    clarify: vi.fn(async () => null),
    selectDestination: vi.fn(async () => "local"),
    prepare,
    show: vi.fn(),
    confirm: vi.fn(async () => "approve"),
  };

  return {
    deps,
    prepare,
    commit,
    cancel,
    flow: createWorkoutOrchestrator(deps),
  };
}

describe("orquestación sin servicios", () => {
  it("valida extracción y conserva transcripción exacta y series", async () => {
    const f = fixture();

    expect((await f.flow.run("  Hoy press\nOriginal  ")).status).toBe(
      "completed",
    );

    expect(f.prepare).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({
        workoutDate: "2026-11-18",
        originalText: "  Hoy press\nOriginal  ",
        exercises: expect.arrayContaining([
          expect.objectContaining({
            individualSets: interpretation.exercises[0]!.individualSets,
          }),
        ]),
      }),
    );

    expect(f.commit).toHaveBeenCalledOnce();
  });

  it("no acepta destino elegido por el modelo", async () => {
    const f = fixture();

    vi.mocked(f.deps.interpret).mockResolvedValue({
      ...interpretation,
      destination: "notion",
    });

    expect((await f.flow.run("x")).status).toBe("cancelled");

    expect(f.prepare).not.toHaveBeenCalled();
  });

  it("solicita aclaración de fecha ausente y reinterpreta sin cambiar original", async () => {
    const f = fixture();

    vi.mocked(f.deps.interpret).mockResolvedValueOnce({
      ...interpretation,
      workoutDate: null,
    });

    vi.mocked(f.deps.clarify).mockResolvedValueOnce("18 de noviembre de 2026");

    await f.flow.run("Original");

    expect(f.deps.interpret).toHaveBeenCalledTimes(2);

    expect(f.prepare).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({ originalText: "Original" }),
    );
  });

  it("no continúa con series inconsistentes", async () => {
    const f = fixture();

    vi.mocked(f.deps.interpret).mockResolvedValue({
      ...interpretation,
      exercises: [{ ...interpretation.exercises[0], sets: 3 }],
    });

    await f.flow.run("x");

    expect(f.prepare).not.toHaveBeenCalled();
  });

  it("cancelar destino no prepara ni escribe", async () => {
    const f = fixture();

    vi.mocked(f.deps.selectDestination).mockResolvedValue(null);

    await f.flow.run("x");

    expect(f.prepare).not.toHaveBeenCalled();

    expect(f.commit).not.toHaveBeenCalled();
  });

  it("rechaza destino inválido en ejecución", async () => {
    const f = fixture();

    vi.mocked(f.deps.selectDestination).mockResolvedValue("otra" as never);

    await expect(f.flow.run("x")).rejects.toThrow("Destino");

    expect(f.commit).not.toHaveBeenCalled();
  });

  it("cancela el permiso sin escribir", async () => {
    const f = fixture();

    vi.mocked(f.deps.confirm).mockResolvedValue("cancel");

    expect((await f.flow.run("x")).status).toBe("cancelled");

    expect(f.commit).not.toHaveBeenCalled();

    expect(f.cancel).toHaveBeenCalled();
  });

  it("modo vista previa nunca llama confirm ni commit", async () => {
    const f = fixture();

    f.prepare.mockResolvedValue({
      status: "ready",
      prepared: {
        preview: {
          destination: "local",
          target: "file",
          markdown: "snapshot",
          digest: "x",
          writeEnabled: false,
        },
        commit: f.commit,
        cancel: f.cancel,
      },
    });

    expect((await f.flow.run("x")).status).toBe("preview-only");

    expect(f.deps.confirm).not.toHaveBeenCalled();

    expect(f.commit).not.toHaveBeenCalled();
  });

  it("edición invalida permiso antes de otra interpretación", async () => {
    const f = fixture();

    vi.mocked(f.deps.confirm)
      .mockResolvedValueOnce("edit")
      .mockResolvedValueOnce("approve");

    vi.mocked(f.deps.clarify).mockResolvedValueOnce("Corrección explícita");

    await f.flow.run("x");

    expect(f.deps.show).toHaveBeenCalledTimes(2);

    expect(f.cancel).toHaveBeenCalledTimes(2);

    expect(f.commit).toHaveBeenCalledOnce();
  });

  it("duplicados no solicitan aprobación", async () => {
    const f = fixture();

    f.prepare.mockResolvedValue({ status: "duplicate" });

    expect((await f.flow.run("x")).status).toBe("duplicate");

    expect(f.deps.confirm).not.toHaveBeenCalled();

    expect(f.commit).not.toHaveBeenCalled();
  });

  it("no hace fallback ante error MCP", async () => {
    const f = fixture();

    vi.mocked(f.deps.selectDestination).mockResolvedValue("notion");

    f.prepare.mockRejectedValue(new Error("MCP"));

    await expect(f.flow.run("x")).rejects.toThrow("MCP");

    expect(f.prepare).toHaveBeenCalledOnce();

    expect(f.commit).not.toHaveBeenCalled();
  });

  it("errores de verificación no reintentan ni cambian de destino", async () => {
    const f = fixture();

    f.commit.mockRejectedValue(new Error("INDETERMINATE"));

    await expect(f.flow.run("x")).rejects.toThrow("INDETERMINATE");

    expect(f.commit).toHaveBeenCalledOnce();

    expect(f.prepare).toHaveBeenCalledOnce();
  });

  it("rechaza entrada vacía", async () =>
    expect(fixture().flow.run("  ")).rejects.toThrow("transcripción"));

  it("parser valida JSON y rechaza datos inválidos sin inventar", () => {
    expect(
      parseWorkoutInterpretation(
        `\`\`\`json\n${JSON.stringify(interpretation)}\n\`\`\``,
      ).exercises[0]?.individualSets,
    ).toHaveLength(2);

    expect(() =>
      parseWorkoutInterpretation('{"exercises":[{"sets":-1}]}'),
    ).toThrow();

    expect(() =>
      parseWorkoutInterpretation('{"exercises":[],"originalText":"inventado"}'),
    ).toThrow();
  });
});
