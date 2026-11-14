import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setTracingDisabled } from "@openai/agents";
import { authorizeNotion, NotionOAuthProvider } from "./notion-oauth.js";
import { createReadServer, createMcpWorkoutReader } from "./notion-mcp-read.js";
import { createMcpWorkoutWriter } from "./notion-mcp-write.js";
import { createNotionWorkoutService } from "./save-workout-to-notion.js";
import { NotionWorkoutInputSchema } from "./workout-to-notion-blocks.js";

setTracingDisabled(true);

const args = process.argv.slice(2);
const enableWrite = args.includes("--enable-one-write");
const files = args.filter((arg) => arg !== "--enable-one-write");

if (files.length !== 1 || files[0]!.startsWith("--")) {
  throw new Error(
    "Uso: notion:preview-workout -- entrenamiento.json [--enable-one-write]",
  );
}

const workout = NotionWorkoutInputSchema.parse(
  JSON.parse(await readFile(files[0]!, "utf8")),
);
// Reuse existing OAuth credentials. Reauthorization must use the read-only login command.
const provider = new NotionOAuthProvider();
const server = createReadServer(provider, enableWrite);

try {
  await authorizeNotion(provider);

  await server.connect();

  const reader = createMcpWorkoutReader(server);
  const service = createNotionWorkoutService({
    reader,
    writer: enableWrite
      ? createMcpWorkoutWriter(server, reader, true)
      : undefined,
  });
  const result = await service.preview(workout, {}, "records-section-start");

  if (result.status !== "ready") {
    console.log(
      `No se puede guardar: ${result.status}. Revisa duplicados/fecha.`,
    );
  } else {
    console.log(
      `Destino: ${result.preview.destinationUrl}\nUbicación: justo debajo de «Registros de prueba», antes de la tabla semanal.\nVista previa exacta (Markdown):\n${result.preview.markdown}\nDigest: ${result.preview.digest}`,
    );

    if (!enableWrite || !stdin.isTTY) {
      service.cancel(result.previewId);

      console.log(
        "Solo vista previa: escritura deshabilitada o terminal no interactiva.",
      );
    } else {
      const prompt = createInterface({ input: stdin, output: stdout });

      try {
        const expected = `GUARDAR ${result.preview.digest}`;
        const answer = await prompt.question(
          `Autoriza una única escritura escribiendo exactamente:\n${expected}\n> `,
        );

        if (answer !== expected) {
          service.cancel(result.previewId);

          console.log("Cancelado; no se escribió.");
        } else {
          console.log(
            await service.saveWorkoutToNotion({
              previewId: result.previewId,
              digest: result.preview.digest,
              approved: true,
            }),
          );
        }
      } finally {
        prompt.close();
      }
    }
  }
} catch {
  console.error(
    "Operación no confirmada. Si se autorizó una escritura, el resultado puede ser incierto: relee la página antes de preparar otro intento. No se reintenta automáticamente.",
  );

  process.exitCode = 1;
} finally {
  await server.close().catch(() => undefined);

  await provider.close();
}
