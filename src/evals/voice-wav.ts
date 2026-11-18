import { createWhisperCppProvider } from "../audio/whisper-cpp.js";
import { loadWav } from "../audio/local-audio.js";
import { VoiceError } from "../audio/contracts.js";

// Explicit real STT evaluation. No review/LLM/persistence/Notion capabilities.
const args = process.argv.slice(2);

try {
  if (args.length !== 1 || args[0]!.startsWith("--")) {
    throw new VoiceError(
      "INVALID_AUDIO",
      "Uso: npm run agent:eval:voice -- audio.wav",
    );
  }

  const provider = createWhisperCppProvider({
    modelPath: process.env.WHISPER_MODEL ?? "models/ggml-base.bin",
    executable: process.env.WHISPER_CPP_BIN,
  });
  const result = await provider.transcribe(await loadWav(args[0]!), {
    language: "es",
  });

  console.log(JSON.stringify(result, null, 2));

  console.log(
    "Transcripción real completada. Revisa manualmente números y unidades; este eval no mide precisión automáticamente.",
  );
} catch (error) {
  console.error(
    error instanceof VoiceError
      ? { code: error.code, message: error.message }
      : {
          code: "TRANSCRIPTION_FAILED",
          message: "No se pudo completar el eval local de audio.",
        },
  );

  process.exitCode = 1;
}
