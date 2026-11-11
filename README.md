# AI Task Manager Agent

Asistente personal de IA para gestion de tareas, desarrollado con Node.js y TypeScript. Incluye `WorkoutAgent`, conectado al modelo local `qwen3:4b` de Ollama mediante la API Chat Completions compatible con OpenAI, y validacion Zod local. No conecta Notion, Gmail ni WhatsApp.

## Requisitos

- npm
- Node.js 22 o superior
- Ollama ejecutandose localmente en `http://localhost:11434` con el modelo `qwen3:4b` disponible

## Instalacion y ejecucion

```sh
npm install
npm start
```

`npm run start` compila TypeScript y ejecuta el mensaje inicial. Para compilar sin ejecutar la aplicacion, usa `npm run build`.

## Probar WorkoutAgent

Con Ollama ejecutandose localmente y `qwen3:4b` descargado, ejecuta:

```sh
npm run agent:test -- "Hoy he hecho press banca, tres series de diez repeticiones con sesenta kilos. Despues hice sentadillas, cuatro series de ocho con ochenta kilos"
```

`WorkoutAgent` recibe la descripcion en lenguaje natural y extrae la fecha y cada ejercicio con series, repeticiones, peso y observaciones. Conserva los nombres de ejercicios y las fechas relativas (por ejemplo, `hoy`) tal como se escribieron. Tambien interpreta cantidades expresadas con palabras en espanol, como `tres series de diez repeticiones`.

El agente solicita JSON normal en lugar de depender de la salida estructurada del SDK, cuya compatibilidad puede variar entre servidores compatibles con OpenAI. La aplicacion analiza la respuesta y la valida localmente con Zod antes de mostrar la vista previa. Los datos ausentes u omitidos se representan como `null`, y el texto original se incluye sin alteraciones.

La prueba usa la API Chat Completions compatible con OpenAI en `http://localhost:11434/v1`, configura `qwen3:4b`, utiliza el valor ficticio `ollama` como API key y desactiva el trazado del Agents SDK. No necesita una clave real de OpenAI ni conecta servicios externos.

## Guardar un entrenamiento

`npm run agent:save -- "...descripcion..."` inicia el flujo completo. WorkoutAgent interpreta el texto y solicita la herramienta `saveWorkout` mediante function calling. El Agents SDK pausa la ejecucion porque la herramienta tiene `needsApproval: true`. La aplicacion valida los argumentos con Zod, muestra una vista previa y solicita confirmacion en la terminal. Solo despues de una respuesta `s` o `si` TypeScript aprueba la interrupcion y reanuda el runner.

La herramienta comprueba ademas un permiso de un solo uso en el contexto de TypeScript antes de escribir. Si se rechaza o cancela la confirmacion, no se reanuda la herramienta y no se modifica ningun archivo. Los entrenamientos se guardan y acumulan en `data/workouts.json`, junto con el texto original y la fecha local de guardado. El archivo y su carpeta se crean automaticamente; los datos existentes se validan antes de anadir otro registro. El archivo de datos se excluye de Git.

Para probar el flujo sin dejar un entrenamiento de prueba en el archivo habitual, puedes indicar un destino temporal dentro del proyecto:

```sh
WORKOUTS_FILE=.tmp/workouts-test.json npm run agent:save -- "Hoy hice sentadillas: tres series de ocho repeticiones con 60 kg"
```

Confirma con `s` para guardar o responde `n`/pulsa Enter para cancelar. `npm run agent:test` sigue disponible para probar solo la extraccion; `npm run start` y `npm run build` no cambian.

## Pruebas automatizadas

```sh
npm test
npm run test:watch
npm run test:coverage
```

Vitest ejecuta los tests unitarios del esquema/parser, la persistencia JSON en directorios temporales, los errores de datos y escritura, la deduplicacion, y el permiso de un solo uso de `saveWorkout`. Los tests habituales no llaman a Ollama y nunca usan `data/workouts.json`.

La clave de duplicado se calcula con la fecha del entrenamiento y los campos normalizados de sus ejercicios; ignora el texto original y la hora de guardado. Dos registros iguales para la misma fecha se consideran duplicados, mientras que los mismos ejercicios en fechas distintas se permiten. Si la fecha es desconocida (`null`), solo se bloquea otro registro con fecha desconocida y el mismo contenido normalizado.

Para verificar manualmente function calling real con Qwen3 y autorizar el guardado desde la terminal:

```sh
WORKOUTS_FILE=.tmp/ollama-eval.json npm run agent:eval:ollama -- "Hoy hice sentadillas: tres series de ocho repeticiones con 60 kg"
```

Este eval opcional requiere Ollama local y `qwen3:4b`; solicita confirmacion antes de escribir en el archivo temporal. `npm test` no depende del modelo.
