import { describe, it, expect, vi } from "vitest";
import { writeFile, stat } from "node:fs/promises";
import { createMacAudioCapture, loadWav } from "./local-audio.js";
import { createWhisperCppProvider } from "./whisper-cpp.js";
import { wavFixture } from "./audio-fixtures.test-helper.js";
import { VoiceError } from "./contracts.js";
import type { StartLocalProcess } from "./local-process.js";

// All processes are fakes. Files use OS-owned temporary directories created by adapters.
describe("adaptador de captura", () => {
  it("captura a WAV, detiene y limpia el temporal", async () => {
    let path = "";
    const stop = vi.fn();
    const start: StartLocalProcess = (_command, args) => {
      path = args.at(-1)!;

      return {
        done: writeFile(path, wavFixture().bytes),
        stop,
        cancel: vi.fn(),
      };
    };
    const recording = createMacAudioCapture({
      platform: "darwin",
      startProcess: start,
    }).start({});

    recording.stop();

    const audio = await recording.finished;

    expect(audio.bytes.length).toBeGreaterThan(44);

    expect(stop).toHaveBeenCalled();

    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("limpia el temporal si se deniegan permisos", async () => {
    let path = "";
    const start: StartLocalProcess = (_command, args) => {
      path = args.at(-1)!;

      return {
        done: Promise.reject(new VoiceError("PERMISSION_DENIED", "denied")),
        stop: vi.fn(),
        cancel: vi.fn(),
      };
    };

    await expect(
      createMacAudioCapture({ platform: "darwin", startProcess: start }).start(
        {},
      ).finished,
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancelar antes de inicializar no inicia el proceso", async () => {
    const start = vi.fn();
    const recording = createMacAudioCapture({
      platform: "darwin",
      startProcess: start,
    }).start({});

    recording.cancel();

    await expect(recording.finished).rejects.toMatchObject({
      code: "CANCELLED",
    });

    expect(start).not.toHaveBeenCalled();
  });

  it("captura de micrófono no se asume disponible fuera de macOS", () =>
    expect(() =>
      createMacAudioCapture({ platform: "linux" }).start({}),
    ).toThrow("macOS"));

  it("ruta de archivo inválida da error controlado", async () =>
    expect(loadWav("/nonexistent/voice.wav")).rejects.toMatchObject({
      code: "INVALID_AUDIO",
    }));
});

describe("proveedor whisper.cpp", () => {
  it("falla de forma explícita si falta el modelo", async () => {
    const start = vi.fn();

    await expect(
      createWhisperCppProvider({
        modelPath: "/nonexistent/model.bin",
        startProcess: start,
      }).transcribe(wavFixture(), { language: "es" }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_MISSING" });

    expect(start).not.toHaveBeenCalled();
  });
});
