import {
  assertDestination,
  type WorkoutPage,
  type WorkoutReader,
} from "./notion-read-service.js";
import { insertRecord } from "./notion-record-section.js";

export type VerificationResult = {
  status: "VERIFIED" | "NOT_FOUND" | "INDETERMINATE";
  reason: string;
};

type Block = { type: string; text: string };

function inline(value: string): string {
  // Only known presentational wrappers are equivalent. Keep links and other attributes/content.
  return value
    .replace(/<\/?(?:code|b|strong|i|em|u|s)>/g, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(?<!\\)\*\*([^*]+)\*\*/g, "$1")
    .replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, number: string) =>
      String.fromCodePoint(
        number.startsWith("x") ? parseInt(number.slice(1), 16) : Number(number),
      ),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\u00a0]+/g, " ")
    .trim();
}

/** Conservative parser for this application's output and fetched page Markdown.
 * Code/transcription bodies are literal: do not unescape, trim or collapse spaces there.
 */
export function canonicalBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph = "";
  const flush = () => {
    if (paragraph) {
      blocks.push({ type: "paragraph", text: inline(paragraph) });
    }

    paragraph = "";
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = line.match(/^(`{3,}|~{3,})([^\s]*)\s*$/);

    if (fence) {
      flush();

      const body: string[] = [];
      const closing = new RegExp(`^${fence[1]![0]}{${fence[1]!.length},}\\s*$`);

      while (++index < lines.length && !closing.test(lines[index]!)) {
        body.push(lines[index]!);
      }

      if (index === lines.length) {
        throw new Error("Bloque literal incompleto.");
      }

      const language =
        fence[2] === "text" || fence[2] === "txt" ? "text" : fence[2];

      blocks.push({ type: `code:${language}`, text: body.join("\n") });

      continue;
    }

    if (!line.trim()) {
      flush();

      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const richHeading = line.match(/^<h([1-4])>(.*)<\/h\1>$/);
    const bullet = line.match(/^\s*[-+*]\s+(.+)$/);

    if (heading || richHeading || bullet) {
      flush();

      blocks.push({
        type: heading
          ? `h${heading[1]!.length}`
          : richHeading
            ? `h${richHeading[1]}`
            : "bullet",
        text: inline(heading?.[2] ?? richHeading?.[2] ?? bullet![1]!),
      });
    } else if (line.startsWith("|")) {
      flush();

      blocks.push({ type: "table-row", text: inline(line) });
    } else {
      paragraph += (paragraph ? " " : "") + line;
    }
  }

  flush();

  return blocks;
}

export function compareRecord(
  page: WorkoutPage,
  markdown: string,
  marker: string,
  before?: string,
): VerificationResult {
  try {
    assertDestination(page.id);

    if (!page.complete || /<unknown(?:\s|>)/i.test(page.content)) {
      throw new Error("Lectura incompleta.");
    }

    const actual = canonicalBlocks(page.content);
    const section = actual
      .map((block, index) =>
        block.type === "h2" && block.text === "Registros de prueba"
          ? index
          : -1,
      )
      .filter((index) => index >= 0);

    if (section.length !== 1) {
      throw new Error("Sección ausente o ambigua.");
    }

    const occurrences = page.content.split(marker).length - 1;

    if (occurrences === 0) {
      return {
        status: "NOT_FOUND",
        reason:
          "Lectura completa sin el marcador esperado; no se autoriza ningún reintento.",
      };
    }

    if (occurrences !== 1) {
      throw new Error("Marcador duplicado.");
    }

    const expected = canonicalBlocks(markdown);

    if (
      !expected.some(
        (block) =>
          block.type === "paragraph" && block.text === `Registro ID: ${marker}`,
      )
    ) {
      throw new Error("Marcador esperado inválido.");
    }

    const start = section[0]! + 1;
    // Records are level-3 headings; their children have lower priority headings.
    const markerIndex = actual.findIndex(
      (block) =>
        block.type === "paragraph" && block.text === `Registro ID: ${marker}`,
    );
    const recordStart = markerIndex - 1;
    const sectionEnd = actual.findIndex(
      (block, index) => index >= start && /^h[12]$/.test(block.type),
    );

    if (sectionEnd !== -1 && recordStart >= sectionEnd) {
      throw new Error("Registro fuera de la sección.");
    }

    if (recordStart < start || actual[recordStart]?.type !== "h3") {
      throw new Error("Marcador fuera de un registro.");
    }

    let recordEnd = recordStart + 1;

    while (
      recordEnd < actual.length &&
      !/^h[123]$/.test(actual[recordEnd]!.type)
    ) {
      recordEnd++;
    }

    if (
      JSON.stringify(actual.slice(recordStart, recordEnd)) !==
      JSON.stringify(expected)
    ) {
      throw new Error("Contenido o estructura del registro distintos.");
    }

    if (
      before !== undefined &&
      JSON.stringify(actual) !==
        JSON.stringify(canonicalBlocks(insertRecord(before, markdown)))
    ) {
      throw new Error("Contenido previo modificado.");
    }

    return {
      status: "VERIFIED",
      reason: "Marcador único y todos los bloques coinciden estructuralmente.",
    };
  } catch {
    return {
      status: "INDETERMINATE",
      reason:
        "Lectura, ubicación, integridad o contenido no verificables; no reintentar la escritura.",
    };
  }
}

export async function verifySavedRecord(
  reader: WorkoutReader,
  markdown: string,
  marker: string,
  before?: string,
): Promise<VerificationResult> {
  try {
    return compareRecord(await reader.read(), markdown, marker, before);
  } catch {
    return {
      status: "INDETERMINATE",
      reason:
        "Error o timeout de lectura; no demuestra ausencia y no autoriza reintentos.",
    };
  }
}
