# AI Task Manager Agent

Agente TypeScript que interpreta entrenamientos con Qwen3 4B mediante Ollama,
valida los datos con Zod y permite guardarlos en JSON local o en una página de
pruebas de Notion. Utiliza OpenAI Agents SDK y Notion MCP oficial con OAuth.
El usuario elige un único destino y aprueba el contenido antes de guardar.
Incluye entrada de voz local mediante micrófono o WAV, con revisión de la
transcripción y vista previa sin guardado. No incluye Gmail ni WhatsApp.

**Estado actual:** Qwen3 mediante Ollama, validación Zod y orquestador operativo;
OAuth, lectura y primera escritura controlada de Notion MCP ya verificados.
El flujo unificado está implementado y la escritura en Notion sigue deshabilitada
por defecto. Última validación local: 180 tests, lint y build aprobados. También se ha
probado STT real y el recorrido desde un WAV sintético hasta vista previa;
la prueba con micrófono queda pendiente de permiso y dictado del usuario.

## Requisitos e instalación

- Node.js compatible con las dependencias instaladas: recomendado **24.22.2**, con
  el que se ha validado el proyecto. Vitest requiere Node 22.12 o superior dentro
  de la rama 22; Node 18 no sirve para esta batería.
- npm.
- Ollama en `http://localhost:11434`, con `qwen3:4b`, para interpretar con `agent:test`, `agent:save`, `agent:workout` y los evals
  de Qwen3. La voz también lo necesita al preparar el entrenamiento; el modo
  `--transcribe-only` y `agent:eval:voice` no lo necesitan.
- macOS y acceso a su llavero, conexión a Internet y permisos en la página de
  pruebas para los comandos Notion. Los tests con mocks no requieren esto.
- Terminal interactiva para seleccionar destino, aclarar datos y aprobar escrituras.

Desde la raíz del repositorio (`ai-task-manager-agent/`):

```sh
npm ci
npm run build
npm start
```

`npm ci` instala las versiones del lockfile. `npm install` es la alternativa si
necesitas actualizar dependencias. `npm start` solo compila y muestra el mensaje
inicial; para interpretar entrenamientos usa `agent:workout` o `agent:test`.
No necesitas una API key de OpenAI: el proveedor usa la API compatible de Ollama
en `http://localhost:11434/v1`, con el valor ficticio `ollama` y trazado desactivado.

## Referencia completa de comandos npm

Esta tabla cubre los **17 scripts** definidos en `package.json`. El separador
`--` entrega los argumentos al programa, en lugar de a npm. Encierra el texto del
entrenamiento entre comillas. Los comandos de agente y Notion compilan antes de
arrancar; `lint` y los tests trabajan directamente sobre los fuentes.
Los scripts sin `"Texto"` ni ruta en su invocación no requieren parámetros.
Los ejemplos de guardado que siguen requieren una aprobación adicional; la
sección de primera ejecución utiliza exclusivamente operaciones sin guardado.

| Comando | Para qué sirve | Requisitos y efectos |
| --- | --- | --- |
| `npm run build` | Compila TypeScript a `dist/` y comprueba tipos. | Sin Ollama ni Notion; genera archivos compilados. |
| `npm start` | Compila y ejecuta el mensaje inicial de `src/index.ts`. | No interpreta ni guarda entrenamientos. |
| `npm test` | Ejecuta Vitest una vez. | Tests con mocks y archivos temporales; sin servicios reales. |
| `npm run test:watch` | Mantiene Vitest observando cambios. | Interactivo; `Ctrl+C` termina. |
| `npm run test:coverage` | Ejecuta los tests y genera cobertura. | Sin servicios reales; informe en `coverage/`. |
| `npm run lint` | Comprueba formato y reglas ESLint. | No corrige los fuentes. |
| `npm run lint:fix` | Aplica las correcciones automáticas de ESLint/Prettier. | Modifica los fuentes; revisar el diff. |
| `npm run agent:test -- "Texto"` | Interpreta y valida un entrenamiento sin guardarlo. | Ollama; solo extracción. |
| `npm run agent:workout -- "Texto"` | Flujo unificado con elección local/Notion y aprobación. | Ollama; local puede guardar tras aprobar; Notion es vista previa por defecto. |
| `npm run agent:save -- "Texto"` | Flujo local legado mediante function calling. | Ollama; escribe JSON solo tras confirmar con `s`, `si` o `sí`. |
| `npm run agent:eval:extraction` | Eval real de extracción de series comunes y variables. | Ollama; no guarda ni contacta con Notion. |
| `npm run agent:eval:ollama -- "Texto"` | Eval manual legado del function calling y guardado local. | Es un alias de `agent:save`; puede escribir JSON tras aprobar. |
| `npm run agent:voice` | Graba, transcribe, pide revisión y prepara el entrenamiento. | FFmpeg para micrófono, whisper.cpp y modelo; Ollama para interpretar. Solo vista previa, sin opciones de escritura. |
| `npm run agent:eval:voice -- audio.wav` | Transcribe un WAV con el proveedor real y muestra texto/diagnóstico. | whisper.cpp y modelo; sin micrófono, Qwen3 ni persistencia. Revisión de precisión manual. |
| `npm run notion:read-test-page` | Lee la página autorizada y muestra su contenido. | OAuth, llavero y red; sin Ollama ni escrituras remotas. |
| `npm run notion:preview-workout -- examples/notion-workout.json` | Valida un JSON, lee duplicados y muestra la propuesta. | OAuth, llavero y red; no escribe por defecto. |
| `npm run notion:verify-workout -- examples/notion-workout.json` | Verifica un registro ya existente usando el JSON esperado. | OAuth, llavero y red; exclusivamente lectura. |

## Guía rápida — Primera ejecución

1. Instala los requisitos anteriores. Desde `ai-task-manager-agent/`, comprueba
   Node y descarga las dependencias del proyecto:

   ```sh
   node --version
   npm ci
   npm run build
   ```

2. Arranca Ollama en otra terminal y déjala abierta:

   ```sh
   ollama serve
   ```

   Si la aplicación de Ollama ya está ejecutando el servicio, no lo arranques
   otra vez. Un error de puerto ocupado suele indicar que ya está iniciado.

3. En la terminal del proyecto, descarga el modelo si aún no está instalado y
   comprueba que aparece en la lista:

   ```sh
   ollama pull qwen3:4b
   ollama list
   ```

   `pull` necesita red y espacio para descargar el modelo. Después, la inferencia
   usa el servicio local; no necesitas una cuenta ni una API key de OpenAI.

4. Ejecuta una prueba de interpretación sin persistencia:

   ```sh
   npm run agent:test -- "Hoy hice press banca, tres series de diez con 60 kg"
   ```

   Debe mostrar los datos validados y la transcripción. Este comando no guarda
   JSON ni conecta con Notion.

5. Recorre el orquestador con un ejemplo ficticio y sin posibilidad de guardar:

   ```sh
   WORKOUTS_FILE=.tmp/primera-prueba.json npm run agent:workout -- "Hoy he hecho press banca inclinado. Primera serie, 35 kg y 8 repeticiones. Segunda serie, 32,5 kg y 8 repeticiones." --preview-only
   ```

   Escribe `local` cuando solicite el destino. Así no necesitas configurar Notion:
   solo consulta la ruta local para detectar duplicados y muestra la vista previa.
   El archivo no se crea ni se modifica. El resultado esperado es `preview-only`
   cuando no hay duplicados ni aclaraciones pendientes. La vista previa debe
   conservar las dos series, 8 × 35 kg y 8 × 32,5 kg, y la transcripción original.
   Si faltan datos imprescindibles, responde a la aclaración o pulsa Enter para
   cancelar. `hoy` se resuelve con la fecha de ejecución en `Europe/Madrid`.

6. Opcionalmente, configura o comprueba Notion exclusivamente en lectura:

   ```sh
   npm run notion:read-test-page -- --authorize
   ```

   Revisa el alcance en terminal y navegador antes de conceder permisos. Tras
   autenticarte, puedes repetir sin `--authorize`. Para probar el orquestador
   contra Notion, vuelve a ejecutar el comando `npm run agent:workout` del paso 5,
   conservando `--preview-only`, y elige `notion` cuando solicite el destino.
   Leerá duplicados y preparará la propuesta, sin escribir.

`npm start` no sustituye a estos pasos: solo muestra el mensaje inicial.
La primera prueba segura no necesita ninguna opción de habilitación de escritura.

## Modos de ejecución

| Modo | Cómo ejecutarlo | Qué puede modificar |
| --- | --- | --- |
| Solo interpretación | `npm run agent:test -- "Texto"` | Ningún entrenamiento; usa Ollama. |
| Vista previa del orquestador | `npm run agent:workout -- "Texto" --preview-only` | Ningún entrenamiento en local ni en Notion; exige elegir destino y consulta duplicados. |
| Guardado local | `npm run agent:workout -- "Texto"`, elegir `local` y aprobar el digest | Solo el JSON seleccionado; nunca Notion. |
| Vista previa Notion desde JSON | `npm run notion:preview-workout -- examples/notion-workout.json` | Ningún bloque remoto; solo lectura y propuesta. |
| Escritura Notion desde texto | `npm run agent:workout -- "Texto" --enable-one-notion-write`, elegir `notion` y aprobar el digest | Un registro dentro de «Registros de prueba» de la página autorizada. |
| Escritura Notion desde JSON | `npm run notion:preview-workout -- ruta/al/entrenamiento.json --enable-one-write` y aprobar el digest | Un registro en esa misma sección y página. |
| Verificación Notion | `npm run notion:verify-workout -- examples/notion-workout.json` | Ningún contenido remoto; comprueba un registro existente. |

Las opciones de escritura solo habilitan llegar a la confirmación; no la
sustituyen. `--preview-only` prevalece sobre la habilitación de Notion. Las
operaciones locales de compilación, instalación y cobertura pueden generar
archivos de desarrollo, pero no guardan entrenamientos.

## Flujo unificado y autorización

```sh
npm run agent:workout -- "Hoy hice press banca: tres series de diez con 60 kg"
```

1. El agente de extracción interpreta y TypeScript valida con Zod.
2. Si falta fecha, nombre de ejercicio u otro dato imprescindible, pide aclaración.
   `hoy` y `ayer` se resuelven con la fecha de ejecución en `Europe/Madrid`.
3. Escribe `local` o `notion`; Enter o un destino no reconocido cancela.
4. Se comprueban duplicados en ese destino y se muestra la propuesta.
5. Si el guardado está habilitado, escribe exactamente `GUARDAR <digest mostrado>`.
   `EDITAR` invalida el permiso y vuelve a pedir datos; cualquier otra respuesta cancela.
6. La herramienta guarda una sola vez y el servicio verifica el resultado.

La transcripción inicial se conserva íntegra en este flujo, sin trim ni
reescritura del modelo. Las aclaraciones son contexto explícito para reinterpretar
los campos. Hay un máximo de cinco iteraciones. Los valores no indicados quedan
como desconocidos: Zod valida su forma, pero debes revisar la fidelidad al texto.
El esquema admite `sessionName` e `individualSets` opcionales, sin invalidar los
JSON anteriores. Las series variables se guardan sin promediarlas.

| Opción de `agent:workout` | Comportamiento |
| --- | --- |
| `--preview-only` | Deshabilita escrituras en ambos destinos. Prevalece sobre cualquier habilitación. |
| `--enable-one-notion-write` | Permite llegar a la aprobación de un único guardado Notion; no elige el destino ni aprueba nada por sí sola. |
| Sin opciones | Local requiere aprobación; Notion permanece en vista previa. |

Nunca se guarda en ambos destinos ni se hace fallback a JSON cuando falla Notion.
Una terminal no interactiva no selecciona destino ni aprueba guardados.

## Guardado JSON local y comando legado

El archivo predeterminado es `data/workouts.json`, excluido de Git. Se validan
los registros anteriores antes de añadir otro. La clave local incluye fecha,
campos normalizados de ejercicios, sesión y series individuales cuando existen;
ignora la transcripción y `savedAt`. El flujo legado puede aceptar fecha `null`;
el flujo unificado pide una fecha antes de preparar un guardado.

`WORKOUTS_FILE` cambia únicamente el destino local. Una ruta relativa se resuelve
contra el directorio desde el que ejecutas el comando:

```sh
# Flujo unificado: selecciona local y revisa el digest antes de aprobar.
WORKOUTS_FILE=.tmp/workouts-test.json npm run agent:workout -- "Hoy hice remo: tres series de ocho con 40 kg"

# Flujo legado: confirma con s/si/sí; Enter o n cancela.
WORKOUTS_FILE=.tmp/workouts-test.json npm run agent:save -- "Hoy hice remo: tres series de ocho con 40 kg"
```

El comando legado mantiene su comportamiento: normaliza el espacio exterior de
la entrada con `trim()` y usa la interrupción `needsApproval` del Agents SDK.
Ambos flujos reutilizan `saveWorkout` y su permiso TypeScript consumible. El nuevo
adaptador local relee el JSON para verificar el guardado. Notion es independiente.

## Notion: acceso y lectura

Destino exclusivo fijado en TypeScript:
[AI Task Manager — Pruebas de notas de voz (noviembre 2026)](https://app.notion.com/p/411f963e438f81d7ac61d59994bd83b0).
ID: `411f963e-438f-81d7-ac61-d59994bd83b0`. No se acepta otro ID desde el modelo
ni desde los comandos.

```sh
# Usa credenciales existentes; se detiene si necesita consentimiento nuevo.
npm run notion:read-test-page

# Revisa el alcance y abre el navegador solo después de confirmar.
npm run notion:read-test-page -- --authorize
```

El endpoint es `https://mcp.notion.com/mcp`. El cliente MCP realiza discovery,
registro OAuth, PKCE e intercambio de código. El callback escucha en
`127.0.0.1:43871/oauth/callback`, valida `state` y caduca en tres minutos.
El SDK gestiona issuer y renovación de tokens; si se revocan, puede ser necesario
reautorizar. Un administrador puede tener que permitir el cliente/redirect URL.

El scope observado fue `default`: el consentimiento de Notion puede conceder
más permisos que la lectura de esta página. Revisa cuenta, workspace y alcance
en el navegador. La limitación de destino y operaciones pertenece al código.
Los comandos de lectura no crean un escritor ni se adjuntan al modelo.

Las credenciales se guardan con `@napi-rs/keyring` en el llavero macOS, servicio
`ai-task-manager-agent.notion-readonly`, no en Git, `.env` ni logs. Para revocar,
retira la conexión en Notion y elimina las entradas de ese servicio en Acceso a
Llaveros. macOS puede solicitar permiso para acceder al llavero.

## Notion desde un JSON: vista previa y escritura

El archivo [examples/notion-workout.json](examples/notion-workout.json) contiene
datos ficticios y fecha ISO absoluta. Úsalo como plantilla y sustituye sus valores
antes de registrar otro entrenamiento. No requiere Ollama:

```sh
# Solo prepara la vista previa; puede informar de duplicado si ya está registrado.
npm run notion:preview-workout -- examples/notion-workout.json
```

El parámetro es la ruta a un JSON validado por Zod, con `workoutDate`, `exercises`
y `originalText`, más `sessionName` opcional. Un ejercicio puede tener datos
comunes (`sets`, `repetitions`, `weight`, `observations`) y/o `individualSets`.
Revisa el ejemplo para ver los tipos y los campos null. En los comandos JSON usa
fecha `YYYY-MM-DD`; no se proporciona una referencia para `hoy`/`ayer`.

Solo para una escritura real deliberada, usando un JSON revisado:

```sh
npm run notion:preview-workout -- ruta/al/entrenamiento.json --enable-one-write
```

`--enable-one-write` pertenece al comando de JSON, no a `agent:workout`. Exige
terminal interactiva y `GUARDAR <digest completo mostrado>`. Cualquier otra
respuesta cancela. No admite `EDITAR`: corrige el archivo y genera otra propuesta.
El permiso caduca a los diez minutos, vincula contenido, marcador, destino y
ubicación, y solo se puede consumir una vez.

Para guardar desde lenguaje natural, la habilitación separada es:

```sh
npm run agent:workout -- "El 18 de noviembre de 2026 hice remo: tres series de ocho con 40 kg" --enable-one-notion-write
```

Selecciona `notion`, revisa todo y escribe la frase de aprobación con su digest.
Los comandos no están autorizados por el mero hecho de aparecer en esta guía.

Los bloques se insertan bajo el encabezado único **Registros de prueba**,
antes de la tabla semanal, con ubicación `records-section-start`. Se conserva el
encabezado mediante una actualización localizada. No se crean páginas hijas ni
se modifican filas de la tabla aprobada del 7 de noviembre u otras páginas.
Los duplicados se revisan en la propuesta y justo antes del intento. Los
registros antiguos de la misma fecha sin marcador requieren revisión manual.

## Verificar un registro existente sin escribir

```sh
npm run notion:verify-workout -- examples/notion-workout.json
```

Usa el JSON que represente el entrenamiento guardado. No cambies fecha, sesión,
contenido o transcripción: pueden cambiar el marcador determinista. La
verificación requiere tanto el marcador único como la estructura completa,
no basta encontrar el identificador.

| Resultado | Significado y siguiente paso |
| --- | --- |
| `VERIFIED` | Registro único y campos/bloques coincidentes. El CLI termina con código 0. |
| `NOT_FOUND` | Lectura completa sin el marcador esperado. Revisa JSON y destino antes de decidir otro intento; código 1. |
| `INDETERMINATE` | Lectura incompleta, timeout, error, duplicación o contenido no verificable. Solo relee/investiga; código 1. |

La comparación canónica admite escapes equivalentes, rich text conocido,
espacios no significativos y normalización de fences `text`/`txt`. Conserva
orden, cifras y transcripción literal; dentro del bloque literal solo equipara
CRLF/LF. La verificación posterior a escribir también contrasta el resto de la
página con el estado previo. La comprobación aislada no puede demostrar
retrospectivamente que nada más cambió sin un snapshot previo.

No hay reintentos automáticos de escritura. Si hay timeout tras aprobar, consulta
primero el destino con el comando de verificación; no vuelvas a ejecutar el
comando de escritura como forma de comprobar el resultado.

## Tests, evals y formato

```sh
npm run lint
npm run build
npm test
npm run test:coverage
npm run test:watch
```

Los tests usan mocks y archivos temporales: no necesitan Ollama, no contactan
con Notion y no usan `data/workouts.json`. La cobertura configurada abarca esquema,
almacenamiento local, herramienta local y aprobación; no es cobertura de todo el
repositorio. `test:watch` permanece activo hasta salir o pulsar `Ctrl+C`.

ESLint integra Prettier: indentación de dos espacios, ancho preferido de 80
columnas, llaves obligatorias y separación de sentencias/métodos. Se excluyen
`node_modules`, `dist`, `coverage`, datos y `.tmp`. El parser Babel evita la
incompatibilidad declarada del parser typescript-eslint con TypeScript 7.

```sh
npm run lint:fix
```

Este comando modifica fuentes. Revisa el diff después; `lint` solo comprueba y
`build` sigue siendo responsable de los tipos.

Los evals reales están separados de Vitest:

```sh
# Solo extracción: dos casos reales con qwen3:4b, sin persistencia.
npm run agent:eval:extraction

# Eval manual legado: puede guardar en .tmp después de confirmar con s/si/sí.
WORKOUTS_FILE=.tmp/ollama-eval.json npm run agent:eval:ollama -- "Hoy hice sentadillas: tres series de ocho con 60 kg"
```

El segundo script ejecuta exactamente el mismo flujo que `agent:save`, no una
batería automática de aserciones. La última validación funcional conocida pasó
lint, build y **180 tests Vitest**. Los dos casos del eval real de extracción
se aprobaron en la fase anterior; las pruebas reales de voz se describen abajo.
Estos resultados no garantizan la interpretación correcta de cualquier frase.

## Arquitectura, límites y resolución de problemas

- **Modelo:** `WorkoutExtractionAgent` interpreta; no tiene herramientas ni elige
  permisos. `WorkoutAgent` conserva el function calling del flujo local legado.
- **Orquestador:** `workout-orchestrator.ts` valida, solicita aclaraciones,
  selección y aprobación sobre una propuesta interna.
- **Persistencia:** `workout-persistence.ts` reutiliza `saveWorkout` o
  `saveWorkoutToNotion`, con sus comprobaciones y verificaciones.
- **Autorización:** la interfaz de confianza aprueba contenido/destino concretos;
  cancelar o editar invalida el permiso. No se entrega el MCP genérico a Qwen3.

Notion utiliza un bloqueo compartido por las instancias del servicio en un
proceso. El adaptador local del nuevo flujo bloquea por ruta dentro del proceso;
el comando legado conserva su contrato. No hay lock entre procesos ni CAS
atómico en Notion: evita varias CLI escribiendo a la vez o editar la página
durante un guardado.

Si Ollama no responde, comprueba el servicio local y que el modelo sea `qwen3:4b`.
Si Notion falla por acceso o expiración, repite la lectura con `--authorize` y
revisa cuenta/workspace. Si falta integridad o el formato no es verificable,
el proceso falla sin simular éxito. Un error remoto no escribe JSON como fallback.

OAuth y lectura real desde Node se verificaron el 14 de noviembre de 2026. La
primera escritura de prueba también se confirmó mediante relectura y revisión
manual; el comando estructural devolvió después `VERIFIED`. Los comandos
actuales mantienen las escrituras Notion deshabilitadas por defecto.


## Historial de decisiones relevantes

- **Persistencia local primero:** se conserva el flujo legado con function calling
  y su autorización del Agents SDK. El orquestador reutiliza esa herramienta, no
  mantiene una segunda implementación de escritura JSON.
- **Una página de pruebas:** la propuesta inicial de añadir al final de la página
  se sustituyó por insertar bloques justo bajo «Registros de prueba»
  (`records-section-start`). Se conserva la tabla semanal y no se usan páginas
  mensuales ni subpáginas como destino.
- **OAuth real, no conexión simulada:** OAuth y lectura desde Node se verificaron
  antes de autorizar la primera escritura. Una conexión del chat no se considera
  evidencia de que la autenticación local funcione.
- **Verificación estructural:** la primera escritura quedó guardada, pero la
  comparación textual notificó un falso error al normalizar Notion la fecha,
  el marcador inline, las viñetas y `text`/`txt`. Se sustituyó por comparación
  canónica de marcador y bloques; se confirmó después `VERIFIED` en solo lectura.
- **Modelo separado de permisos:** el flujo unificado utiliza extracción sin
  herramientas y selección de destino en TypeScript. Se conserva la transcripción
  inicial y se invalida la propuesta al editar, sin fallback ni reintentos de
  escritura automáticos.

## Voz local — implementada, solo vista previa

Flujo: **micrófono/WAV → whisper.cpp → revisión humana → texto aprobado →
agente Qwen3 → Zod → orquestador existente → destino y duplicados → vista previa**.
El comando de voz nunca habilita escritores, ni siquiera al elegir Notion. No
acepta `--enable-one-write` ni `--enable-one-notion-write`. No guarda al terminar
la grabación y no hace fallback entre destinos. Los comandos de texto conservan
sus modos de autorización existentes.

### Dependencias y configuración de voz

Se ha comprobado el Mac arm64 con whisper.cpp **1.9.5** y FFmpeg **9.0.2**;
FFmpeg incluye la entrada AVFoundation. No se añadieron dependencias npm.
Para preparar otro Mac con Homebrew, tras revisar las herramientas a instalar:

```sh
brew install whisper.cpp ffmpeg
mkdir -p models
curl --fail --location --output models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
whisper-cli --help
ffmpeg -hide_banner -devices
```

`ggml-base.bin` es el modelo **base multilingüe**, de unos **142 MiB**; no uses
`base.en`, que es solo inglés. La instalación/descarga requieren Internet, pero
la captura y la transcripción son locales y no envían audio a terceros. Puedes
usar un archivo de modelo local ya descargado. No se descargan modelos desde
el CLI automáticamente. `models/` y los audios WAV/PCM se excluyen de Git.
La instalación en este Mac ya se realizó; no necesitas repetirla.

Fuentes de configuración: [whisper.cpp](https://github.com/ggml-org/whisper.cpp),
[fórmula Homebrew](https://formulae.brew.sh/formula/whisper.cpp) y
[AVFoundation en FFmpeg](https://ffmpeg.org/ffmpeg-devices.html#avfoundation).

| Configuración | Valor predeterminado / uso |
| --- | --- |
| `--model /ruta/modelo.bin` | Modelo local para `agent:voice`. Prevalece sobre `WHISPER_MODEL`. |
| `WHISPER_MODEL` | Modelo para voz/eval; por defecto `models/ggml-base.bin`, relativo al directorio actual. |
| `WHISPER_CPP_BIN` | Ejecutable de transcripción; por defecto `whisper-cli` en PATH. |
| `FFMPEG_BIN` | Ejecutable para capturar; por defecto `ffmpeg` en PATH. |
| `--device 0` | Selecciona dispositivo de audio AVFoundation por índice o nombre; por defecto `default`. |
| `--file /ruta/audio.wav` | Sustituye la captura de micrófono por un archivo WAV existente. |
| `--transcribe-only` | Revisa la transcripción y termina sin llamar a Qwen3 ni consultar destinos. |

### Primera prueba con micrófono

Desde el proyecto, con Node 24.22.2, herramientas y modelo instalados:

```sh
nvm use 24.22.2
npm run agent:voice
```

1. Escribe `GRABAR` para activar el micrófono. Enter cancela sin grabar.
2. Dicta unos segundos. Enter detiene; el límite automático es de 60 segundos.
   `Ctrl+C` cancela y termina el proceso de captura.
3. Revisa la transcripción. Escribe `ACEPTAR`, `EDITAR` o Enter para cancelar.
4. Si editas, escribe el texto completo corregido en una línea y confirma con
   `ACEPTAR`. El texto aprobado, sin trim ni reformulación, será la transcripción
   original de la entrada al agente.
5. Qwen3 interpreta. Responde aclaraciones si hacen falta y elige `local` o
   `notion`. Local solo consulta duplicados; Notion requiere OAuth y solo lee.
   Revisa la vista previa. No se ofrece autorización de guardado en voz.

macOS puede pedir permiso de micrófono para Terminal/iTerm o para la aplicación
que aloje la terminal del IDE. Revisa **Ajustes del Sistema → Privacidad y
seguridad → Micrófono**. Si se deniega, se devuelve un error controlado; no se
simula una grabación válida. No se ha activado el micrófono durante la validación
automatizada ni durante la prueba de WAV sintético.

Para aislar captura/transcripción sin Ollama:

```sh
npm run agent:voice -- --transcribe-only
```

Para consultar los dispositivos disponibles de forma deliberada:

```sh
ffmpeg -f avfoundation -list_devices true -i ""
```

Ese comando puede solicitar permisos de macOS y acabar con un código distinto
de cero después de listar dispositivos. No forma parte de los tests.

### Prueba reproducible con WAV

El contrato de entrada es **RIFF/WAVE PCM16, mono, 16 kHz**, máximo **60 segundos**
y **4 MiB**. Otros formatos se rechazan explícitamente; no se convierten de forma
oculta. Para convertir una copia local:

```sh
ffmpeg -i /ruta/original.m4a -ar 16000 -ac 1 -c:a pcm_s16le /ruta/prueba.wav
npm run agent:voice -- --file /ruta/prueba.wav

# STT y revisión humana, sin LLM:
npm run agent:voice -- --file /ruta/prueba.wav --transcribe-only

# Eval real explícito: solo STT, sin aprobación ni procesamiento posterior:
npm run agent:eval:voice -- /ruta/prueba.wav
```

El WAV de entrada proporcionado por el usuario nunca se elimina ni modifica.
Las grabaciones y las copias/JSON de whisper se crean en directorios temporales
privados y se eliminan en `finally`, al terminar o fallar, antes de persistencia.
Los procesos tienen timeout, cancelación y escalado de terminación. Un cierre
forzado del sistema puede dejar temporales: no se promete limpieza tras SIGKILL
o un apagado. No hay retención opcional de grabaciones en esta versión; para
conservar una prueba usa un WAV que tú gestiones explícitamente.

### Ejemplo y precisión

En una prueba real con voz sintética local en español, whisper.cpp transcribió:

```text
 Hoy he hecho pres banca inclinado, primera serie, 35 kilos y 8 repeticiones, segunda serie, 32 kilos y medio y 8 repeticiones.
```

El WAV duró unos 9,4 segundos y la inferencia unos 5,4 segundos en este Mac.
Esto es una observación puntual, no un benchmark. `pres` necesita corrección a
`press`; revisa también decimales y unidades. El paso `EDITAR` permite corregirlo
antes de Qwen3. La vista previa esperada conserva las series de 8 repeticiones
con 35 kilos y 32 kilos y medio; el peso es un texto validado, no un cálculo de
precisión garantizada por STT.

En el primer recorrido real Qwen3 omitió las unidades en los campos de peso. Se
reforzó la instrucción de extracción con ejemplos explícitos, sin reconstruir
unidades automáticamente. Un eval puntual posterior con el texto aprobado
confirmó `35 kilos` y `32 kilos y medio`, ambas series de 8. Sigue siendo un
resultado observado, no una garantía de fidelidad para todas las entradas.

Se rechazan audios demasiado breves, vacíos o de energía casi nula antes de STT.
El umbral de energía no es un detector completo de voz: ruido o música pueden
producir texto alucinado. No se garantiza reconocer números/decimales siempre.
El modelo base prioriza tamaño y latencia; compara manualmente antes de aprobar
la transcripción. Los errores muestran códigos controlados, sin volcar logs del
motor que podrían incluir texto privado. El filtro puede rechazar voz muy baja.

### Componentes reutilizables y futuro móvil

- `audio/contracts.ts`: `AudioClip` contiene bytes y media type, no rutas macOS;
  `SpeechToTextProvider` recibe audio y devuelve texto, idioma y diagnóstico mínimo.
- `audio/wav.ts`: validación pura de formato, tamaño, duración y silencio básico.
- `audio/local-audio.ts`: adaptadores Node de archivo y micrófono AVFoundation.
- `audio/whisper-cpp.ts`: proveedor intercambiable de STT; solo este adaptador
  conoce los argumentos del binario y sus JSON temporales.
- `audio/voice-flow.ts`: revisión/aceptación/edición/cancelación mediante callbacks,
  sin terminal, procesos, rutas locales ni credenciales.
- `workout-cli-session.ts`: adaptador compartido de terminal para texto y voz;
  reutiliza el intérprete, orquestador, persistencia y cliente MCP existentes.
- `agent-voice-cli.ts`: conecta captura, STT, revisión y sesión compartida con
  `previewOnly: true` y `enableNotion: false` fijados.

**Speech-to-Text** convierte sonido en texto. El **LLM** interpreta el entrenamiento;
**Zod** comprueba sus datos. El **orquestador** coordina decisiones, las herramientas
**MCP** acceden a Notion y la **persistencia** conserva/verifica registros solo en
flujos autorizados. Voz no concede ninguna autorización de escritura.

Arquitectura prevista, aún no implementada:

```text
Mac CLI / futura PWA Android-iOS
             ↓
  API autenticada por HTTPS
             ↓
      Núcleo del asistente
             ↓
     Proveedores LLM y STT
             ↓
   Persistencia / Notion MCP
```

Los contratos `AudioClip`, `Transcription`, `TranscriptReview` y los resultados
estructurados de `runVoicePreview` pueden usarse desde un futuro backend HTTP.
El proveedor LLM también es sustituible mediante el callback `interpret` existente.
Los navegadores móviles suelen generar audio comprimido: hará falta un adaptador
de conversión/validación a PCM WAV; esta versión no admite WebM/M4A directamente.
El orquestador ya recibe callbacks de revisión/confirmación y no depende de
readline; un adaptador HTTP deberá conservar estado por sesión y resolver esos
pasos en peticiones distintas. No se ha implementado una API, PWA, autenticación,
servidor público ni despliegue cloud.

Hoy dependen de macOS el micrófono AVFoundation, el llavero OAuth y la apertura
del navegador; la CLI es Node. Un teléfono no ejecutará estos adaptadores ni
recibirá tokens Notion. Pasos futuros: recibir audio/texto en un backend privado,
autenticar usuarios, usar HTTPS, aislar sesiones y previews, validar en backend,
proteger credenciales, limitar uploads/solicitudes y vincular cada permiso de un
solo uso al usuario y snapshot. Solo después, añadir cliente web móvil/PWA.
No se exponen herramientas MCP administrativas al cliente.

Las pruebas de audio con mocks no acceden al micrófono, a modelos ni a Notion.
`agent:eval:voice` es una prueba real explícita y separada de Vitest. Los evals de
Qwen3 siguen separados en `agent:eval:extraction`. No se ha modificado el plugin
privado ni se han guardado entrenamientos durante esta implementación.
