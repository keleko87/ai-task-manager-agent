/** Transport-neutral audio payload; a future HTTP adapter can provide the same bytes. */
export interface AudioClip {
  bytes: Uint8Array;
  mediaType: "audio/wav";
}

export interface Transcription {
  text: string;
  language: string | null;
  diagnostics: { provider: string; durationMs: number; elapsedMs: number };
}

export interface SpeechToTextProvider {
  transcribe(
    audio: AudioClip,
    options: { language: string; signal?: AbortSignal },
  ): Promise<Transcription>;
}

export interface AudioRecording {
  finished: Promise<AudioClip>;
  stop(): void;

  cancel(): void;
}

export interface AudioCapture {
  start(options: { signal?: AbortSignal }): AudioRecording;
}

export type VoiceErrorCode =
  | "DEPENDENCY_MISSING"
  | "PERMISSION_DENIED"
  | "INVALID_AUDIO"
  | "AUDIO_LIMIT"
  | "EMPTY_AUDIO"
  | "CANCELLED"
  | "TIMEOUT"
  | "CAPTURE_FAILED"
  | "TRANSCRIPTION_FAILED"
  | "INTERPRETATION_FAILED";

export class VoiceError extends Error {
  constructor(
    public readonly code: VoiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VoiceError("CANCELLED", "Entrada de voz cancelada.");
  }
}
