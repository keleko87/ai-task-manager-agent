import { spawn } from "node:child_process";
import { VoiceError, checkCancelled } from "./contracts.js";

export interface LocalProcess {
  done: Promise<void>;
  stop(): void;

  cancel(): void;
}

export type StartLocalProcess = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs: number },
) => LocalProcess;

/** Never invoke a shell; cap diagnostic buffering and kill children on abort/timeout. */
export const startLocalProcess: StartLocalProcess = (
  command,
  args,
  options,
) => {
  checkCancelled(options.signal);

  const child = spawn(command, args, {
    stdio: ["pipe", "ignore", "pipe"],
    shell: false,
  });
  let stderr = "";
  let failure: VoiceError | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  child.stderr.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4096);
  });

  child.stdin.on("error", () => undefined);

  const terminate = (error: VoiceError) => {
    failure ??= error;

    child.kill("SIGTERM");

    forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000);
  };
  const cancel = () =>
    terminate(new VoiceError("CANCELLED", "Proceso de audio cancelado."));
  const timer = setTimeout(
    () =>
      terminate(
        new VoiceError("TIMEOUT", "El proceso local de audio agotó su tiempo."),
      ),
    options.timeoutMs,
  );

  options.signal?.addEventListener("abort", cancel, { once: true });

  const done = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);

      clearTimeout(forceTimer);

      options.signal?.removeEventListener("abort", cancel);
    };

    child.once("error", (error: NodeJS.ErrnoException) => {
      cleanup();

      reject(
        new VoiceError(
          error.code === "ENOENT" ? "DEPENDENCY_MISSING" : "CAPTURE_FAILED",
          error.code === "ENOENT"
            ? "Falta el ejecutable local configurado; revisa la instalación."
            : "No se pudo iniciar el proceso local de audio.",
        ),
      );
    });

    child.once("close", (code) => {
      cleanup();

      if (failure) {
        reject(failure);
      } else if (code === 0) {
        resolve();
      } else if (
        /not authorized|permission denied|not permitted|access denied|authorization denied/i.test(
          stderr,
        )
      ) {
        reject(
          new VoiceError(
            "PERMISSION_DENIED",
            "Permiso denegado: habilita el micrófono para tu terminal en Privacidad y seguridad de macOS.",
          ),
        );
      } else {
        reject(
          new VoiceError(
            "CAPTURE_FAILED",
            "El proceso local falló; revisa dispositivo, modelo y formato. No se muestran logs que puedan contener audio transcrito.",
          ),
        );
      }
    });
  });

  if (options.signal?.aborted) {
    cancel();
  }

  return {
    done,
    stop() {
      if (!child.stdin.destroyed) {
        child.stdin.write("q\n");
      }
    },
    cancel,
  };
};
