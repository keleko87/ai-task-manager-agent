import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setTracingDisabled } from "@openai/agents";
import { authorizeNotion, NotionOAuthProvider } from "./notion-oauth.js";
import {
  createReadServer,
  createMcpWorkoutReader,
  safeNotionError,
} from "./notion-mcp-read.js";
import { NOTION_PAGE_URL } from "./notion-read-service.js";

setTracingDisabled(true);

const provider = new NotionOAuthProvider(undefined, async (url) => {
  console.log(
    "Notion MCP actúa con los permisos de tu cuenta; OAuth puede conceder lectura y escritura en un ámbito mayor que esta página.",
  );

  console.log("Este programa solo llama notion-fetch para:", NOTION_PAGE_URL);

  console.log("Servidor de autorización:", url.origin + url.pathname);

  console.log(
    "Scope solicitado:",
    url.searchParams.get("scope") ??
      "No explicitado por el servidor; revisa el consentimiento de Notion.",
  );

  console.log(
    "Revisa workspace y permisos en el navegador antes de conceder acceso. Puedes cancelar.",
  );

  if (!process.argv.includes("--authorize") || !stdin.isTTY) {
    return false;
  }

  const prompt = createInterface({ input: stdin, output: stdout });

  try {
    return /^(s|si|sí)$/i.test(
      (
        await prompt.question(
          "¿Abrir el navegador para revisar y autorizar? [s/N] ",
        )
      ).trim(),
    );
  } finally {
    prompt.close();
  }
});
const server = createReadServer(provider);

try {
  await authorizeNotion(provider);

  await server.connect();

  const page = await createMcpWorkoutReader(server).read();

  console.log(
    `Lectura real verificada: ${page.title}\nID: ${page.id}\nRevisión: ${page.revision}\n${page.content}`,
  );
} catch (error) {
  console.error(safeNotionError(error));

  process.exitCode = 1;
} finally {
  await server.close().catch(() => undefined);

  await provider.close();
}
