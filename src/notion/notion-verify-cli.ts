import { readFile } from "node:fs/promises";
import { setTracingDisabled } from "@openai/agents";
import {
  NotionWorkoutInputSchema,
  workoutToNotionBlocks,
} from "./workout-to-notion-blocks.js";
import { NotionOAuthProvider, authorizeNotion } from "./notion-oauth.js";
import { createReadServer, createMcpWorkoutReader } from "./notion-mcp-read.js";
import { verifySavedRecord } from "./notion-record-verification.js";

setTracingDisabled(true);

const args = process.argv.slice(2);

if (args.length !== 1 || args[0]!.startsWith("--")) {
  throw new Error(
    "Uso: notion:verify-workout -- entrenamiento.json (solo lectura)",
  );
}

const input = NotionWorkoutInputSchema.parse(
  JSON.parse(await readFile(args[0]!, "utf8")),
);
const expected = workoutToNotionBlocks(input);
const provider = new NotionOAuthProvider();
const server = createReadServer(provider);

try {
  await authorizeNotion(provider);

  await server.connect();

  const result = await verifySavedRecord(
    createMcpWorkoutReader(server),
    expected.markdown,
    expected.marker,
  );

  console.log(result);

  if (result.status !== "VERIFIED") {
    process.exitCode = 1;
  }
} catch {
  console.error({
    status: "INDETERMINATE",
    reason: "No se pudo leer Notion. No demuestra ausencia.",
  });

  process.exitCode = 1;
} finally {
  await server.close().catch(() => undefined);

  await provider.close();
}
