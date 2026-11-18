import { describe, it, expect, vi } from "vitest";
import { runVoicePreview } from "./voice-flow.js";
import { inspectWav, AUDIO_LIMITS } from "./wav.js";
import { wavFixture } from "./audio-fixtures.test-helper.js";
import { VoiceError } from "./contracts.js";
import { createWorkoutOrchestrator } from "../workout-orchestrator.js";
import { parseWorkoutInterpretation } from "../workout-interpreter.js";

const text =
  "  Hoy hice press. Primera serie 35 kg y 8 repeticiones.\nSegunda serie 32,5 kg y 8 repeticiones.  ";

function fixture() {
  const transcribe = vi.fn(async () => ({
    text,
    language: "es",
    diagnostics: { provider: "mock", durationMs: 1000, elapsedMs: 1 },
  }));
  const acquire = vi.fn(async () => wavFixture());
  const review = vi.fn(async () => ({ action: "accept" as const }));
  const previewWorkout = vi.fn(async () => ({ status: "preview-only" }));

  return { acquire, speechToText: { transcribe }, review, previewWorkout };
}

describe("contrato WAV", () => {
  it("valida formato y duración", () =>
    expect(inspectWav(wavFixture()).durationMs).toBe(1000));

  it.each([0, 0.0001])("rechaza silencio de amplitud %s", (amplitude) =>
    expect(() => inspectWav(wavFixture(1, amplitude))).toThrow("silencioso"),
  );

  it("rechaza audio demasiado corto", () =>
    expect(() => inspectWav(wavFixture(0.1))).toThrow());

  it("rechaza archivos no WAV", () =>
    expect(() =>
      inspectWav({ bytes: new Uint8Array(50), mediaType: "audio/wav" }),
    ).toThrow("WAV"));

  it("rechaza datos truncados", () => {
    const audio = wavFixture();

    audio.bytes = audio.bytes.slice(0, -2);

    expect(() => inspectWav(audio)).toThrow();
  });

  it("rechaza canales y sample rate incompatibles", () => {
    const audio = wavFixture();

    new DataView(audio.bytes.buffer).setUint16(22, 2, true);

    expect(() => inspectWav(audio)).toThrow();
  });

  it("rechaza duración excesiva", () =>
    expect(() => inspectWav(wavFixture(61))).toThrow("60 segundos"));

  it("rechaza tamaño excesivo", () =>
    expect(() =>
      inspectWav({
        bytes: new Uint8Array(AUDIO_LIMITS.maxBytes + 1),
        mediaType: "audio/wav",
      }),
    ).toThrow("4 MiB"));
});

describe("audio a texto revisado", () => {
  it("no altera números decimales, saltos ni espacios de la transcripción", async () => {
    const deps = fixture();
    const result = await runVoicePreview(deps);

    expect(result).toMatchObject({ status: "preview", approvedText: text });

    expect(deps.previewWorkout).toHaveBeenCalledExactlyOnceWith(text);

    expect(deps.review).toHaveBeenCalledOnce();
  });

  it("edición manual reemplaza solo el texto aprobado", async () => {
    const deps = fixture();
    const edited = "  Corregido: 32 kilos y medio.  ";
    const result = await runVoicePreview({
      ...deps,
      review: async () => ({ action: "edit", text: edited }),
    });

    expect(result).toMatchObject({
      status: "preview",
      approvedText: edited,
      transcription: { text },
    });

    expect(deps.previewWorkout).toHaveBeenCalledWith(edited);
  });

  it("cancelar revisión impide llamar al modelo", async () => {
    const deps = fixture();

    expect(
      (
        await runVoicePreview({
          ...deps,
          review: async () => ({ action: "cancel" }),
        })
      ).status,
    ).toBe("cancelled");

    expect(deps.previewWorkout).not.toHaveBeenCalled();
  });

  it("edición vacía no llega al modelo", async () => {
    const deps = fixture();

    expect(
      (
        await runVoicePreview({
          ...deps,
          review: async () => ({ action: "edit", text: " " }),
        })
      ).status,
    ).toBe("error");

    expect(deps.previewWorkout).not.toHaveBeenCalled();
  });

  it("permiso denegado es un error controlado", async () => {
    const deps = fixture();

    deps.acquire.mockRejectedValue(
      new VoiceError("PERMISSION_DENIED", "Permiso denegado"),
    );

    expect(await runVoicePreview(deps)).toMatchObject({
      status: "error",
      error: { code: "PERMISSION_DENIED" },
    });

    expect(deps.speechToText.transcribe).not.toHaveBeenCalled();
  });

  it("errores de transcriptor no provocan guardado ni reintentos", async () => {
    const deps = fixture();

    deps.speechToText.transcribe.mockRejectedValue(new Error("private"));

    expect(await runVoicePreview(deps)).toMatchObject({
      status: "error",
      error: { code: "TRANSCRIPTION_FAILED" },
    });

    expect(deps.speechToText.transcribe).toHaveBeenCalledOnce();

    expect(deps.previewWorkout).not.toHaveBeenCalled();
  });

  it("silencio se rechaza antes de STT", async () => {
    const deps = fixture();

    deps.acquire.mockResolvedValue(wavFixture(1, 0));

    await runVoicePreview(deps);

    expect(deps.speechToText.transcribe).not.toHaveBeenCalled();
  });

  it("no procesa transcripción vacía", async () => {
    const deps = fixture();

    deps.speechToText.transcribe.mockResolvedValue({
      text: " ",
      language: "es",
      diagnostics: { provider: "mock", durationMs: 1000, elapsedMs: 1 },
    });

    await runVoicePreview(deps);

    expect(deps.review).not.toHaveBeenCalled();
  });

  it("interrumpir antes de iniciar no captura audio", async () => {
    const deps = fixture();
    const signal = AbortSignal.abort();

    expect((await runVoicePreview({ ...deps, signal })).status).toBe(
      "cancelled",
    );

    expect(deps.acquire).not.toHaveBeenCalled();
  });

  it("interrumpir durante revisión no inicia interpretación", async () => {
    const deps = fixture();
    const controller = new AbortController();
    const result = await runVoicePreview({
      ...deps,
      signal: controller.signal,
      review: async () => {
        controller.abort();

        return { action: "accept" };
      },
    });

    expect(result.status).toBe("cancelled");

    expect(deps.previewWorkout).not.toHaveBeenCalled();
  });

  it("transcripción aprobada entra al orquestador existente y nunca ejecuta commit", async () => {
    const commit = vi.fn();
    const confirm = vi.fn();
    const cancel = vi.fn();
    const extraction = parseWorkoutInterpretation(
      JSON.stringify({
        workoutDate: "hoy",
        exercises: [
          {
            name: "Press",
            sets: 2,
            individualSets: [
              { repetitions: 8, weight: "35 kg", observations: null },
              { repetitions: 8, weight: "32,5 kg", observations: null },
            ],
          },
        ],
      }),
    );
    const prepare = vi.fn(async () => ({
      status: "ready" as const,
      prepared: {
        preview: {
          destination: "local" as const,
          target: "test",
          markdown: "snapshot",
          digest: "x",
          writeEnabled: false,
        },
        commit,
        cancel,
      },
    }));
    const flow = createWorkoutOrchestrator({
      referenceDate: "2026-11-18",
      interpret: async () => extraction,
      clarify: async () => null,
      selectDestination: async () => "local",
      prepare,
      show: vi.fn(),
      confirm,
    });
    const deps = fixture();
    const result = await runVoicePreview({
      ...deps,
      previewWorkout: (text) => flow.run(text),
    });

    expect(result.status).toBe("preview");

    expect(prepare).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({ originalText: text }),
    );

    expect(commit).not.toHaveBeenCalled();

    expect(confirm).not.toHaveBeenCalled();

    expect(cancel).toHaveBeenCalled();
  });
});
