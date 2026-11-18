import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { createMacAudioCapture, loadWav } from "./audio/local-audio.js";
import { createWhisperCppProvider } from "./audio/whisper-cpp.js";
import { runVoicePreview } from "./audio/voice-flow.js";
import { VoiceError } from "./audio/contracts.js";
import {
  runWorkoutCliSession,
  WorkoutCliError,
} from "./workout-cli-session.js";

async function main() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  let transcribeOnly = false;

  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;

    if (flag === "--transcribe-only" && !transcribeOnly) {
      transcribeOnly = true;

      continue;
    }

    if (
      !["--file", "--model", "--device"].includes(flag) ||
      values.has(flag) ||
      !args[index + 1] ||
      args[index + 1]!.startsWith("--")
    ) {
      throw new VoiceError(
        "INVALID_AUDIO",
        "Uso: agent:voice [--file audio.wav] [--model modelo.bin] [--device 0] [--transcribe-only]. No se admiten opciones de escritura.",
      );
    }

    values.set(flag, args[++index]!);
  }

  if (!stdin.isTTY) {
    throw new VoiceError(
      "CANCELLED",
      "Se requiere terminal interactiva para revisar la transcripción.",
    );
  }

  const controller = new AbortController();
  const interrupt = () => controller.abort();

  process.once("SIGINT", interrupt);

  const prompt = createInterface({ input: stdin, output: stdout });

  prompt.on("SIGINT", interrupt);

  const ask = (message: string) =>
    prompt.question(message, { signal: controller.signal });
  const speechToText = createWhisperCppProvider({
    modelPath: resolve(
      values.get("--model") ??
        process.env.WHISPER_MODEL ??
        "models/ggml-base.bin",
    ),
    executable: process.env.WHISPER_CPP_BIN,
  });
  let promptClosed = false;

  try {
    const result = await runVoicePreview({
      signal: controller.signal,
      speechToText,
      async acquire() {
        const file = values.get("--file");

        if (file) {
          return loadWav(file);
        }

        const answer = await ask(
          "Grabación local, máximo 60 s. Escribe GRABAR para activar el micrófono; Enter cancela: ",
        );

        if (answer !== "GRABAR") {
          throw new VoiceError("CANCELLED", "Grabación cancelada.");
        }

        const recording = createMacAudioCapture({
          ffmpeg: process.env.FFMPEG_BIN,
          device: values.get("--device"),
        }).start({ signal: controller.signal });
        const stopPrompt = new AbortController();
        const stop = prompt
          .question(
            "Habla ahora. Pulsa Enter para detener, Ctrl+C para cancelar: ",
            { signal: stopPrompt.signal },
          )
          .then(
            () => recording.stop(),
            () => undefined,
          );

        try {
          const audio = await recording.finished;

          return audio;
        } finally {
          stopPrompt.abort();

          await stop;
        }
      },
      async review(transcription) {
        console.log(
          `\nTranscripción (${transcription.language ?? "desconocido"}):\n${transcription.text}\n`,
        );

        const decision = await ask("ACEPTAR / EDITAR / Enter para cancelar: ");

        if (decision === "ACEPTAR") {
          return { action: "accept" };
        }

        if (decision !== "EDITAR") {
          return { action: "cancel" };
        }

        const text = await ask(
          "Escribe la transcripción completa corregida en una línea: ",
        );

        if (!text.trim()) {
          return { action: "cancel" };
        }

        console.log(`Texto corregido:\n${text}`);

        return (await ask("Escribe ACEPTAR para aprobar este texto: ")) ===
          "ACEPTAR"
          ? { action: "edit", text }
          : { action: "cancel" };
      },
      async previewWorkout(text) {
        prompt.close();

        promptClosed = true;

        if (transcribeOnly) {
          return { status: "transcription-only" as const };
        }

        try {
          return await runWorkoutCliSession(text, {
            previewOnly: true,
            enableNotion: false,
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof WorkoutCliError) {
            throw new VoiceError("INTERPRETATION_FAILED", error.message);
          }

          throw error;
        }
      },
    });

    if (result.status === "error") {
      console.error(result.error);

      process.exitCode = 1;
    } else {
      console.log(`Voz: ${result.status}. Sin guardado de entrenamientos.`);
    }
  } finally {
    if (!promptClosed) {
      prompt.close();
    }

    process.removeListener("SIGINT", interrupt);
  }
}

main().catch((error) => {
  console.error(
    error instanceof VoiceError
      ? { code: error.code, message: error.message }
      : {
          code: "CAPTURE_FAILED",
          message:
            "No se pudo iniciar la entrada de voz. Revisa archivo, herramientas y permisos locales.",
        },
  );

  process.exitCode = 1;
});
