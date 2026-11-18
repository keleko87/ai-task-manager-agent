import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AUDIO_LIMITS, inspectWav } from "./wav.js";
import {
  VoiceError,
  checkCancelled,
  type AudioClip,
  type AudioCapture,
} from "./contracts.js";
import {
  startLocalProcess,
  type StartLocalProcess,
  type LocalProcess,
} from "./local-process.js";

export async function loadWav(path: string): Promise<AudioClip> {
  let handle;

  try {
    handle = await open(resolve(path), "r");
  } catch {
    throw new VoiceError(
      "INVALID_AUDIO",
      "No se pudo abrir el archivo WAV; revisa su ruta y permisos.",
    );
  }

  try {
    const stat = await handle.stat();

    if (!stat.isFile()) {
      throw new VoiceError(
        "INVALID_AUDIO",
        "El audio debe ser un archivo WAV regular.",
      );
    }

    if (stat.size > AUDIO_LIMITS.maxBytes) {
      throw new VoiceError("AUDIO_LIMIT", "El audio supera 4 MiB.");
    }

    // Bounded read, even if another process grows the file after stat.
    const buffer = Buffer.alloc(AUDIO_LIMITS.maxBytes + 1);
    let length = 0;

    while (length < buffer.length) {
      const result = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );

      if (!result.bytesRead) {
        break;
      }

      length += result.bytesRead;
    }

    const audio: AudioClip = {
      bytes: buffer.subarray(0, length),
      mediaType: "audio/wav",
    };

    inspectWav(audio);

    return audio;
  } finally {
    await handle.close();
  }
}

export function createMacAudioCapture(
  options: {
    ffmpeg?: string;
    device?: string;
    platform?: string;
    startProcess?: StartLocalProcess;
  } = {},
): AudioCapture {
  return {
    start({ signal }) {
      if ((options.platform ?? process.platform) !== "darwin") {
        throw new VoiceError(
          "CAPTURE_FAILED",
          "La captura AVFoundation requiere macOS; usa un archivo WAV en otras plataformas.",
        );
      }

      checkCancelled(signal);

      let processHandle: LocalProcess | undefined;
      let stopped = false;
      let cancelled = false;
      const finished = (async () => {
        const directory = await mkdtemp(join(tmpdir(), "workout-capture-"));

        try {
          checkCancelled(signal);

          if (cancelled) {
            throw new VoiceError("CANCELLED", "Grabación cancelada.");
          }

          const path = join(directory, "recording.wav");

          processHandle = (options.startProcess ?? startLocalProcess)(
            options.ffmpeg ?? "ffmpeg",
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-f",
              "avfoundation",
              "-i",
              `:${options.device ?? "default"}`,
              "-vn",
              "-ac",
              "1",
              "-ar",
              "16000",
              "-c:a",
              "pcm_s16le",
              "-t",
              "60",
              "-fs",
              String(AUDIO_LIMITS.maxBytes),
              "-y",
              path,
            ],
            { signal, timeoutMs: 70_000 },
          );

          if (stopped) {
            processHandle.stop();
          }

          await processHandle.done;

          checkCancelled(signal);

          return await loadWav(path);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      })();

      return {
        finished,
        stop() {
          stopped = true;

          processHandle?.stop();
        },
        cancel() {
          cancelled = true;

          processHandle?.cancel();
        },
      };
    },
  };
}
