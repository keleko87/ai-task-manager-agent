import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatWorkoutFlowError } from "./workout-flow-error.js";
import { NotionVerificationError } from "./notion/save-workout-to-notion.js";

describe("diagnóstico seguro del CLI", () => {
  it("explica el fallo de conexión antes de cualquier vista previa", () => {
    const message = formatWorkoutFlowError(
      new Error("Connection error.", {
        cause: Object.assign(new Error("socket"), { code: "ECONNREFUSED" }),
      }),
      "interpretación con Ollama",
    );

    expect(message).toContain("Etapa: interpretación con Ollama");

    expect(message).toContain("localhost:11434");

    expect(message).toContain(
      "Sin fallback ni reintentos automáticos de escritura",
    );
  });

  it("no confunde JSON inválido con OAuth", () =>
    expect(
      formatWorkoutFlowError(
        new SyntaxError("secret response"),
        "interpretación con Ollama",
      ),
    ).toContain("JSON válido"));

  it("no imprime salida inválida de Zod", () => {
    const result = z.string().safeParse({ token: "secret" });

    if (result.success) {
      throw new Error("expected validation error");
    }

    const message = formatWorkoutFlowError(
      result.error,
      "interpretación con Ollama",
    );

    expect(message).toContain("Zod");

    expect(message).not.toContain("secret");
  });

  it("orienta sobre expiración OAuth sin exponer credenciales", () => {
    const message = formatWorkoutFlowError(
      Object.assign(
        new Error("Bearer secret-token https://example.com/?code=secret-code"),
        { status: 401 },
      ),
      "OAuth de Notion",
    );

    expect(message).toContain("--authorize");

    expect(message).not.toContain("secret");

    expect(message).not.toContain("example.com");
  });

  it("distingue permisos MCP y conexión", () =>
    expect(
      formatWorkoutFlowError(
        new Error("403 forbidden"),
        "lectura y vista previa de Notion",
      ),
    ).toContain("Acceso denegado"));

  it("incluye causas de timeout sin afirmar ausencia o falta de escritura", () => {
    const message = formatWorkoutFlowError(
      new Error("wrapper", { cause: new Error("timeout") }),
      "guardado y verificación",
    );

    expect(message).toContain("no demuestra ausencia");

    expect(message).not.toContain("no se escribió");
  });

  it.each(["NOT_FOUND", "INDETERMINATE"] as const)(
    "mantiene estado de verificación %s",
    (status) => {
      expect(
        formatWorkoutFlowError(
          new NotionVerificationError({ status, reason: "private details" }),
          "guardado y verificación",
        ),
      ).toContain(`Verificación: ${status}`);
    },
  );

  it("errores desconocidos no vuelcan datos ni stack", () => {
    const message = formatWorkoutFlowError(
      new Error("token=private originalText=private"),
      "preparación local",
    );

    expect(message).toContain("preparación local");

    expect(message).not.toContain("private");
  });
});
