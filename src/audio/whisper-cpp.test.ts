import { mkdtemp, writeFile, stat, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWhisperCppProvider } from "./whisper-cpp.js";
import { wavFixture } from "./audio-fixtures.test-helper.js";
import { VoiceError } from "./contracts.js";
import type { StartLocalProcess } from "./local-process.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function model() {
  const directory = await mkdtemp(join(tmpdir(), "mock-stt-model-"));

  directories.push(directory);

  const path = join(directory, "ggml-base.bin");

  await writeFile(path, "fake model");

  return path;
}

describe("whisper.cpp con proceso simulado", () => {
  it("conserva texto, idioma y decimales, limpia input y JSON", async () => {
    let inputPath = "";
    let outputPath = "";
    const start = vi.fn<StartLocalProcess>((command, args, options) => {
      expect(command).toBe("whisper-cli");

      expect(args).toContain("es");

      expect(options.timeoutMs).toBe(120_000);

      inputPath = args[args.indexOf("-f") + 1]!;

      outputPath = args[args.indexOf("-of") + 1]! + ".json";

      return {
        done: (async () => {
          expect((await readFile(inputPath)).length).toBe(
            wavFixture().bytes.length,
          );

          await writeFile(
            outputPath,
            JSON.stringify({
              result: { language: "es" },
              transcription: [{ text: " Hoy, " }, { text: "32,5 kg. " }],
            }),
          );
        })(),
        stop: vi.fn(),
        cancel: vi.fn(),
      };
    });
    const result = await createWhisperCppProvider({
      modelPath: await model(),
      startProcess: start,
    }).transcribe(wavFixture(), { language: "es" });

    expect(result.text).toBe(" Hoy, 32,5 kg. ");

    expect(result.language).toBe("es");

    expect(result.diagnostics.durationMs).toBe(1000);

    expect(start).toHaveBeenCalledOnce();

    await expect(stat(inputPath)).rejects.toMatchObject({ code: "ENOENT" });

    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["TIMEOUT", "CANCELLED", "DEPENDENCY_MISSING"] as const)(
    "propaga %s y limpia siempre",
    async (code) => {
      let inputPath = "";
      const start: StartLocalProcess = (_command, args) => {
        inputPath = args[args.indexOf("-f") + 1]!;

        return {
          done: Promise.reject(new VoiceError(code, "safe error")),
          stop: vi.fn(),
          cancel: vi.fn(),
        };
      };

      await expect(
        createWhisperCppProvider({
          modelPath: await model(),
          startProcess: start,
        }).transcribe(wavFixture(), { language: "es" }),
      ).rejects.toMatchObject({ code });

      await expect(stat(inputPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("no ejecuta proceso con una señal ya cancelada", async () => {
    const start = vi.fn();

    await expect(
      createWhisperCppProvider({
        modelPath: await model(),
        startProcess: start,
      }).transcribe(wavFixture(), {
        language: "es",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });

    expect(start).not.toHaveBeenCalled();
  });

  it.each([{}, { transcription: [] }, { transcription: [{ text: " " }] }])(
    "rechaza salida vacía o inválida sin reintentar",
    async (payload) => {
      const start = vi.fn<StartLocalProcess>((_command, args) => ({
        done: writeFile(
          args[args.indexOf("-of") + 1]! + ".json",
          JSON.stringify(payload),
        ),
        stop: vi.fn(),
        cancel: vi.fn(),
      }));

      await expect(
        createWhisperCppProvider({
          modelPath: await model(),
          startProcess: start,
        }).transcribe(wavFixture(), { language: "es" }),
      ).rejects.toBeInstanceOf(VoiceError);

      expect(start).toHaveBeenCalledOnce();
    },
  );
});
