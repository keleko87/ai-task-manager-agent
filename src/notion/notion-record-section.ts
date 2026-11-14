export const RECORD_SECTION = "## Registros de prueba";

export function insertRecord(content: string, markdown: string): string {
  const lines = content.split("\n");
  const matches = lines.filter((line) => line === RECORD_SECTION);

  if (matches.length !== 1 || content.split(RECORD_SECTION).length !== 2) {
    throw new Error(
      "La sección Registros de prueba no es única; revisa la ubicación.",
    );
  }

  return content.replace(RECORD_SECTION, `${RECORD_SECTION}\n\n${markdown}`);
}
