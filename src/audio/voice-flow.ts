import {
  checkCancelled,
  VoiceError,
  type AudioClip,
  type SpeechToTextProvider,
  type Transcription,
} from "./contracts.js";
import { inspectWav } from "./wav.js";

export type TranscriptReview =
  | { action: "accept" }
  | { action: "edit"; text: string }
  | { action: "cancel" };

/** UI-independent: only an approved transcript may reach the preview capability.
 * No save capability, destination credential or terminal is accepted here.
 */
export async function runVoicePreview<Result>(options: {
  acquire(): Promise<AudioClip>;

  speechToText: SpeechToTextProvider;
  review(transcription: Transcription): Promise<TranscriptReview>;

  previewWorkout(approvedText: string): Promise<Result>;
  signal?: AbortSignal;
}) {
  try {
    checkCancelled(options.signal);

    const audio = await options.acquire();

    inspectWav(audio);

    checkCancelled(options.signal);

    const transcription = await options.speechToText.transcribe(audio, {
      language: "es",
      signal: options.signal,
    });

    if (!transcription.text.trim()) {
      throw new VoiceError("EMPTY_AUDIO", "Transcripción vacía.");
    }

    checkCancelled(options.signal);

    const review = await options.review(structuredClone(transcription));

    if (review.action === "cancel") {
      return { status: "cancelled" as const };
    }

    const approvedText =
      review.action === "edit" ? review.text : transcription.text;

    if (!approvedText.trim()) {
      throw new VoiceError(
        "EMPTY_AUDIO",
        "La transcripción aprobada está vacía.",
      );
    }

    checkCancelled(options.signal);

    const result = await options.previewWorkout(approvedText);

    return { status: "preview" as const, transcription, approvedText, result };
  } catch (error) {
    if (options.signal?.aborted) {
      return { status: "cancelled" as const };
    }

    if (error instanceof VoiceError) {
      return {
        status:
          error.code === "CANCELLED"
            ? ("cancelled" as const)
            : ("error" as const),
        error: { code: error.code, message: error.message },
      };
    }

    return {
      status: "error" as const,
      error: {
        code: "TRANSCRIPTION_FAILED" as const,
        message:
          "No se pudo completar la entrada de voz; no se guardó ningún entrenamiento.",
      },
    };
  }
}
