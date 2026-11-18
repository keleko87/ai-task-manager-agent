import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  checkCancelled,
  VoiceError,
  type SpeechToTextProvider,
} from "./contracts.js";
import { inspectWav } from "./wav.js";
import { startLocalProcess, type StartLocalProcess } from "./local-process.js";

const OutputSchema = z.object({
  result: z.object({ language: z.string().optional() }).optional(),
  transcription: z.array(z.object({ text: z.string() })).max(1000),
});

export function createWhisperCppProvider(options: {
  modelPath: string;
  executable?: string;
  startProcess?: StartLocalProcess;
}): SpeechToTextProvider {
  return {
    async transcribe(audio, { language, signal }) {
      checkCancelled(signal);

      const { durationMs } = inspectWav(audio);

      if (!/^[a-z]{2}$/.test(language)) {
        throw new VoiceError(
          "TRANSCRIPTION_FAILED",
          "Configura un idioma de dos letras, por ejemplo es.",
        );
      }

      const model = resolve(options.modelPath);

      try {
        if (!(await stat(model)).isFile()) {
          throw new Error("not a file");
        }
      } catch {
        throw new VoiceError(
          "DEPENDENCY_MISSING",
          "Falta el modelo whisper.cpp configurado; usa un modelo multilingüe, no .en.",
        );
      }

      if (/\.en(?:[.-]|$)/i.test(model)) {
        throw new VoiceError(
          "TRANSCRIPTION_FAILED",
          "El modelo .en solo reconoce inglés; selecciona un modelo multilingüe para español.",
        );
      }

      const directory = await mkdtemp(join(tmpdir(), "workout-stt-"));
      const started = Date.now();

      try {
        const input = join(directory, "input.wav");
        const output = join(directory, "result");

        await writeFile(input, audio.bytes, { mode: 0o600 });

        const child = (options.startProcess ?? startLocalProcess)(
          options.executable ?? "whisper-cli",
          [
            "-m",
            model,
            "-f",
            input,
            "-l",
            language,
            "-oj",
            "-of",
            output,
            "-np",
          ],
          { signal, timeoutMs: 120_000 },
        );

        await child.done;

        checkCancelled(signal);

        if ((await stat(`${output}.json`)).size > 1024 * 1024) {
          throw new VoiceError(
            "TRANSCRIPTION_FAILED",
            "Respuesta del transcriptor excesiva.",
          );
        }

        const result = OutputSchema.parse(
          JSON.parse(await readFile(`${output}.json`, "utf8")),
        );
        const text = result.transcription
          .map((segment) => segment.text)
          .join("");

        if (!text.trim()) {
          throw new VoiceError(
            "EMPTY_AUDIO",
            "No se reconoció voz; repite la grabación.",
          );
        }

        return {
          text,
          language: result.result?.language ?? language,
          diagnostics: {
            provider: "whisper.cpp",
            durationMs,
            elapsedMs: Date.now() - started,
          },
        };
      } catch (error) {
        if (
          error instanceof VoiceError &&
          [
            "CANCELLED",
            "TIMEOUT",
            "DEPENDENCY_MISSING",
            "EMPTY_AUDIO",
          ].includes(error.code)
        ) {
          throw error;
        }

        throw new VoiceError(
          "TRANSCRIPTION_FAILED",
          "whisper.cpp no pudo producir una transcripción válida; revisa modelo y audio.",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
