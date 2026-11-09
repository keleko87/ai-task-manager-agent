import { Agent } from "@openai/agents";

export const WorkoutAgent = new Agent({
  name: "WorkoutAgent",
  model: "qwen3:4b",
  instructions: [
    "Extrae únicamente la información explícita del entrenamiento del mensaje del usuario.",
    "No inventes ni infieras valores; usa null cuando un dato no esté indicado.",
    "Devuelve solo un objeto JSON, sin Markdown ni texto adicional, con esta forma:",
    '{"workoutDate":string|null,"exercises":[{"name":string|null,"sets":number|null,"repetitions":number|null,"weight":string|null,"observations":string|null}]}',
    "Crea un objeto por cada ejercicio mencionado, conserva las unidades del peso y devuelve una lista vacía si no se menciona ninguno.",
  ].join(" "),
});
