# AI Task Manager Agent

Asistente personal de IA para gestion de tareas, desarrollado con Node.js y TypeScript. Incluye `WorkoutAgent`, conectado al modelo local `qwen3:4b` de Ollama mediante la API Chat Completions compatible con OpenAI, y validacion Zod local. No conecta Notion, Gmail ni WhatsApp.

## Requisitos

- Node.js
- npm
- Node.js 22 o superior
- Ollama ejecutandose localmente con el modelo `qwen3:4b`

## Instalacion y ejecucion

```sh
npm install
npm start
```

`npm run start` compila TypeScript y ejecuta el mensaje inicial. Para compilar sin ejecutarlo, usa `npm run build`.

## Probar WorkoutAgent

Con Ollama ejecutandose en `http://localhost:11434` y `qwen3:4b` descargado, ejecuta:

```sh
npm run agent:test -- "Ayer hice sentadillas: 3 series de 8 repeticiones con 60 kg"
```

El cliente usa la clave ficticia `ollama`, no requiere una clave de OpenAI y desactiva el trazado para esta ejecucion local. Como la compatibilidad de Ollama con la salida estructurada del SDK puede variar, el agente pide JSON normal y la aplicacion lo valida con Zod antes de mostrarlo. Los datos ausentes deben ser `null`; el texto original tambien aparece en la vista previa.
