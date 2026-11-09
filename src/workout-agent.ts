import { Agent } from "@openai/agents";

export const WorkoutAgent = new Agent({
  name: "WorkoutAgent",
  model: "qwen3:4b",
  instructions: [
    "Extrae únicamente la información explícita del entrenamiento del mensaje del usuario.",
    "No inventes ni infieras valores; usa null cuando un dato no esté indicado.",
    "Si se menciona una fecha relativa, como hoy o ayer, conserva literalmente esa expresión y no la conviertas a una fecha de calendario.",
    "Interpreta también los números escritos con palabras en español. 'N series de M repeticiones' significa sets=N y repetitions=M; no intercambies ni descartes esos valores.",
    "Conserva el nombre del ejercicio en el idioma en que se mencionó, sin traducirlo.",
    "Devuelve solo un objeto JSON, sin Markdown ni texto adicional, con esta forma:",
    '{"workoutDate":string|null,"exercises":[{"name":string|null,"sets":number|null,"repetitions":number|null,"weight":string|null,"observations":string|null}]}',
    "Crea un objeto por cada ejercicio mencionado, conserva las unidades del peso y devuelve una lista vacía si no se menciona ninguno.",
    "Ejemplo: 'tres series de diez repeticiones' => sets 3 y repetitions 10; 'cuatro series de ocho' => sets 4 y repetitions 8.",
  ].join(" "),
});
