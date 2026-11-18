import { NotionVerificationError } from "./notion/save-workout-to-notion.js";

export type WorkoutFlowStage =
  | "interpretación con Ollama"
  | "aclaración"
  | "selección de destino"
  | "preparación local"
  | "OAuth de Notion"
  | "conexión MCP"
  | "lectura y vista previa de Notion"
  | "confirmación"
  | "guardado y verificación";

/** Classify known errors without printing model output, tokens, URLs or raw causes. */
export function formatWorkoutFlowError(
  error: unknown,
  stage: WorkoutFlowStage,
): string {
  const prefix = `No se completó el flujo. Etapa: ${stage}.`;

  if (error instanceof NotionVerificationError) {
    return `${prefix} Verificación: ${error.verification.status}. Consulta el destino en solo lectura antes de decidir otro intento.`;
  }

  const chain: Error[] = [];
  let current = error;

  while (
    current instanceof Error &&
    chain.length < 4 &&
    !chain.includes(current)
  ) {
    chain.push(current);

    current = current.cause;
  }

  const details = chain
    .map((item) => {
      const value = item as Error & { code?: unknown; status?: unknown };

      return `${item.name} ${item.message} ${typeof value.code === "string" ? value.code : ""} ${typeof value.status === "number" ? value.status : ""}`;
    })
    .join(" ");
  let reason =
    "Error no clasificado; revisa la configuración de la etapa indicada.";

  if (chain.some((item) => item instanceof SyntaxError)) {
    reason =
      "La respuesta no es JSON válido. Revisa la salida del modelo con agent:test (sin guardar).";
  } else if (chain.some((item) => item.name === "ZodError")) {
    reason =
      "Los datos no superan la validación Zod; revisa fecha, ejercicios y series.";
  } else if (/401|unauthorized|invalid_grant/i.test(details)) {
    reason =
      "Autorización expirada o revocada. Si es Notion, ejecuta notion:read-test-page con --authorize.";
  } else if (/403|forbidden|permission|deneg|EACCES|EPERM/i.test(details)) {
    reason =
      "Acceso denegado; revisa permisos del destino o del llavero macOS.";
  } else if (
    /timeout|timed out|AbortError|TimeoutError|agotado/i.test(details)
  ) {
    reason =
      "Tiempo de espera agotado. Comprueba la disponibilidad del servicio; esto no demuestra ausencia del registro.";
  } else if (
    /ECONN|ENOTFOUND|fetch failed|connection error|connection lost/i.test(
      details,
    )
  ) {
    reason =
      stage === "interpretación con Ollama"
        ? "No se pudo conectar con Ollama en localhost:11434. Comprueba que esté iniciado y tenga qwen3:4b."
        : "Fallo de conexión con el servicio de esta etapa; comprueba la red.";
  } else if (
    /OAuth|callback|verifier|invalid_client|navegador/i.test(details)
  ) {
    reason =
      "OAuth pendiente o inválido. Revisa el consentimiento con notion:read-test-page -- --authorize.";
  } else if (/llavero|keychain|keyring/i.test(details)) {
    reason =
      "No se pudo acceder al llavero macOS; revisa su desbloqueo y permisos.";
  } else if (
    /incomplet|truncad|revisión|identidad|URL|sección|ubicación|destino/i.test(
      details,
    )
  ) {
    reason =
      "No se pudo validar el destino, la sección o la integridad de la lectura.";
  }

  return `${prefix} ${reason} Sin fallback ni reintentos automáticos de escritura. Si hubo un intento remoto, verifica primero en solo lectura.`;
}
