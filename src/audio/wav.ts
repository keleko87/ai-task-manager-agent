import { VoiceError, type AudioClip } from "./contracts.js";

export const AUDIO_LIMITS = {
  maxBytes: 4 * 1024 * 1024,
  maxDurationMs: 60_000,
} as const;

/** Deliberately narrow input contract: RIFF/WAVE PCM16 mono at 16kHz. */
export function inspectWav(audio: AudioClip): {
  durationMs: number;
  rms: number;
} {
  const bytes = audio.bytes;
  const invalid = () =>
    new VoiceError(
      "INVALID_AUDIO",
      "Se requiere WAV PCM16 mono de 16 kHz válido.",
    );

  if (bytes.byteLength > AUDIO_LIMITS.maxBytes) {
    throw new VoiceError("AUDIO_LIMIT", "El audio supera 4 MiB.");
  }

  if (audio.mediaType !== "audio/wav" || bytes.length < 44) {
    throw invalid();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + 4));

  if (
    tag(0) !== "RIFF" ||
    tag(8) !== "WAVE" ||
    view.getUint32(4, true) + 8 !== bytes.length
  ) {
    throw invalid();
  }

  let validFormat = false;
  let samples: { start: number; size: number } | undefined;

  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) {
      throw invalid();
    }

    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;

    if (start + size > bytes.length) {
      throw invalid();
    }

    if (tag(offset) === "fmt ") {
      if (
        validFormat ||
        size < 16 ||
        view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 2, true) !== 1 ||
        view.getUint32(start + 4, true) !== 16000 ||
        view.getUint32(start + 8, true) !== 32000 ||
        view.getUint16(start + 12, true) !== 2 ||
        view.getUint16(start + 14, true) !== 16
      ) {
        throw invalid();
      }

      validFormat = true;
    }

    if (tag(offset) === "data") {
      if (samples || size % 2 !== 0) {
        throw invalid();
      }

      samples = { start, size };
    }

    offset = start + size + (size % 2);
  }

  if (!validFormat || !samples) {
    throw invalid();
  }

  const durationMs = samples.size / 32;

  if (durationMs > AUDIO_LIMITS.maxDurationMs) {
    throw new VoiceError("AUDIO_LIMIT", "El audio supera 60 segundos.");
  }

  let energy = 0;

  for (
    let offset = samples.start;
    offset < samples.start + samples.size;
    offset += 2
  ) {
    energy += (view.getInt16(offset, true) / 32768) ** 2;
  }

  const rms = Math.sqrt(energy / (samples.size / 2 || 1));

  if (durationMs < 250 || rms < 0.001) {
    throw new VoiceError(
      "EMPTY_AUDIO",
      "Audio vacío, demasiado breve o casi silencioso; revisa el micrófono.",
    );
  }

  return { durationMs, rms };
}
