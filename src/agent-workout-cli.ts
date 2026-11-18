import { runWorkoutCliSession } from "./workout-cli-session.js";

const args = process.argv.slice(2);
const enableNotion = args.includes("--enable-one-notion-write");
const previewOnly = args.includes("--preview-only");
const textArgs = args.filter(
  (arg) => !["--enable-one-notion-write", "--preview-only"].includes(arg),
);

if (textArgs.length !== 1 || textArgs[0]!.startsWith("--")) {
  throw new Error(
    'Uso: npm run agent:workout -- "entrenamiento" [--preview-only] [--enable-one-notion-write]',
  );
}

try {
  await runWorkoutCliSession(textArgs[0]!, { previewOnly, enableNotion });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "No se completó el flujo.",
  );

  process.exitCode = 1;
}
