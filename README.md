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

## Adaptador de entrenamientos para Notion (preparación, sin conexión local)

El destino exclusivo está fijado en `src/notion/notion-read-service.ts`:
`411f963e-438f-81d7-ac61-d59994bd83b0`. Ninguna función del dominio acepta
un ID de página del modelo. `saveWorkout` y `data/workouts.json` siguen
independientes: este adaptador no los importa ni modifica.

- `workoutToNotionBlocks(input, options)` valida con una extensión del esquema
  Zod existente. Devuelve bloques de dominio `{ type, text }`, Markdown para
  un futuro transporte MCP, fecha normalizada y marcador SHA-256 versionado.
  No son objetos de la API REST de bloques de Notion. `individualSets` permite
  conservar repeticiones, carga y observaciones distintas por serie. Los datos
  desconocidos se muestran como tales; la nota original se conserva literalmente.
- `createWorkoutReader(transport).read()` llama a `fetchPage` exclusivamente con
  el ID fijo. Exige `{ id, title, content, complete: true, revision }` y rechaza
  otra página o una lectura incompleta. El transporte real deberá autenticar,
  resolver paginación y bloques desconocidos, y proporcionar una revisión real.
  No debe inventar `complete` ni una revisión.
- `createNotionWorkoutService({ reader, writer? }).preview(...)` valida, lee y
  comprueba duplicados. Requiere una decisión de ubicación explícita
  `append-page-end`; sin ella devuelve `needs-clarification`. La propuesta es
  añadir al final de la página, fuera de la tabla semanal, pendiente de decisión.
  Los registros antiguos de la misma fecha requieren revisión manual.
- Tras mostrar **exactamente** `preview.markdown`, destino y ubicación, la interfaz
  de confianza recoge una autorización específica. Solo entonces llama a
  `service.saveWorkoutToNotion({ previewId, digest, approved: true })`.
  La autorización caduca en diez minutos y se consume una sola vez. `cancel`
  la invalida. El contenido aprobado se mantiene internamente, separado de la
  copia entregada a la interfaz. No se registran herramientas MCP genéricas ni
  este permiso como herramientas del modelo.
- `writer.append({ pageId, markdown, expectedRevision })` es una capacidad del
  host, ausente por defecto. Debe rechazar revisiones cambiadas y errores remotos;
  resolver tareas asíncronas antes de terminar. No puede reemplazar contenido.
  El servicio relee justo antes del append, comprueba duplicados y cambios, y
  verifica después el marcador y la conservación del contenido anterior. Un
  fallo de verificación deja el estado remoto incierto y exige inspección antes
  de reintentar; nunca devuelve `saved` en ese caso.

La exclusión local evita dos guardados simultáneos en una instancia. La lectura
previa por sí sola no garantiza atomicidad entre procesos: un transporte real
necesita control de concurrencia o rechazar el guardado si no puede cumplir el
contrato `expectedRevision`.

Estado previo a la conexión real: faltaban login OAuth, almacén de credenciales
y transporte MCP local. La sección siguiente describe la implementación actual. El conector de Notion
de la conversación sí permitió una lectura de la página: contiene el registro
semanal aprobado del 7 de noviembre de 2026, una tabla de seis columnas y tres
filas de ejercicios. Esa lectura devuelve Markdown, no IDs individuales de
bloques, y no demuestra el OAuth de esta aplicación. No se ha conectado el
adaptador a ningún escritor real ni realizado pruebas remotas de escritura.

Siguiente paso: implementar y verificar OAuth y una lectura MCP local con el
wrapper fijo; confirmar la ubicación de nuevos registros; preparar un
entrenamiento con fecha exacta y mostrar su vista previa. Una prueba real de
escritura requiere una autorización posterior específica, nueva comprobación de
duplicados y verificación del resultado. No ejecutar escrituras hasta entonces.

Los tests de `src/notion/notion-workout.test.ts` usan exclusivamente mocks.
Build y tests verificados con Node 24.22.2 (Node 18 no ejecuta esta versión de
Vitest). El único eval existente, `agent:eval:ollama`, requiere Ollama y ejecuta
el flujo local con aprobación; no es un eval offline y no se ejecutó para esta
preparación. No hay un runner de evals offline adicional en el proyecto.

## Lectura local por MCP oficial de Notion

Implementación contrastada con `@openai/agents` 0.21.0 y
`@modelcontextprotocol/client` 2.4.0 instalados: `MCPServerStreamableHttp`
acepta `authProvider`; el proveedor implementa la interfaz OAuth del cliente MCP.
El endpoint fijo es `https://mcp.notion.com/mcp`.

```sh
npm run notion:read-test-page
# Si solicita consentimiento, ejecuta desde una terminal interactiva:
npm run notion:read-test-page -- --authorize
```

Usa Node 22 o superior (verificado con 24.22.2). Sin `--authorize`, el programa
puede usar una autorización ya guardada, pero se detiene si necesita navegador.
Con `--authorize`, muestra el destino, el servidor de autorización y el scope
recibido; solicita confirmación antes de abrir el navegador. Revisa el workspace
y los permisos en la pantalla de Notion y cancela si no son adecuados. El scope
observado en la primera conexión fue `default`: no equivale a permiso de solo
lectura ni a limitar OAuth a una página. El MCP oficial puede actuar con los
permisos de la cuenta. La restricción de página y lectura pertenece a este código.

El cliente MCP realiza discovery, registro dinámico, PKCE e intercambio de código;
el callback escucha exclusivamente en `127.0.0.1:43871/oauth/callback`, valida
`state` y caduca en tres minutos. El SDK valida el issuer recibido y gestiona
renovación/invalidation de tokens. Si OAuth está revocado o el refresh falla,
puede ser necesario revisar y autorizar otra vez. Un administrador puede tener
que permitir el cliente o su redirect URL.

`@napi-rs/keyring` guarda tokens, registro del cliente, verifier y discovery en el
llavero macOS, servicio `ai-task-manager-agent.notion-readonly`. No se escriben
credenciales en archivos del proyecto, variables `.env` ni logs. Para revocar,
retira la conexión en Notion y elimina las entradas de ese servicio en Acceso a
Llaveros. Si macOS pide acceso al llavero, requiere intervención del usuario.
Los errores de terminal se resumen sin volcar excepciones, códigos ni tokens.

`notion-mcp-read.ts` construye el servidor sin adjuntarlo a WorkoutAgent.
Solo utiliza `notion-fetch`, con ID constante, a través de `createWorkoutReader`.
Valida identidad, URL, contenido, indicadores de truncamiento y bloques
desconocidos. La fecha de edición o timestamp del fetch sirve como revisión de
lectura; no es una garantía de escritura condicional. No se instancia ningún
transporte de escritura y no se llaman herramientas de modificación. El filtro
de herramientas del SDK no sustituye la restricción del wrapper.

Primera prueba desde Node: discovery/registro alcanzaron el servidor oficial,
que devolvió `https://mcp.notion.com/authorize` y scope `default`. Se detuvo antes
de abrir navegador porque falta autorización manual. **No hubo lectura real de
la página desde Node todavía**; la lectura anterior mediante el conector del chat
no cuenta como verificación local. Después de autorizar, el comando debe mostrar
`Lectura real verificada`, título, ID, revisión y contenido. Si el formato real
no permite verificar integridad, falla sin simular éxito.

Antes de considerar escrituras siguen pendientes: completar OAuth manual,
verificar esa lectura local, confirmar ubicación, revisar soporte de concurrencia
del transporte y solicitar autorización específica sobre una vista previa exacta.

### Verificación local completada — 14 de noviembre de 2026

OAuth completado mediante consentimiento en navegador. El comando Node local
terminó con código 0 y mostró `Lectura real verificada` para el ID exclusivo
`411f963e-438f-81d7-ac61-d59994bd83b0`, título
`🧪 AI Task Manager — Pruebas de notas de voz (noviembre 2026)` y revisión
`2026-11-07T21:00:56.396Z`. Se leyó la tabla semanal aprobada del 7 de noviembre,
con tres ejercicios. No se realizaron escrituras en Notion. Esta verificación
sustituye el estado pendiente de consentimiento descrito anteriormente.

## Formato y legibilidad

`npm run lint` comprueba todos los archivos TypeScript y JavaScript del proyecto;
`npm run lint:fix` aplica automáticamente el formato. ESLint integra Prettier,
indentación de dos espacios, ancho preferido de 80 columnas, llaves obligatorias,
líneas en blanco entre sentencias (excepto imports y declaraciones consecutivas)
y separación entre miembros de clases. Se excluyen dependencias, compilados,
coverage y datos locales. El parser Babel evita la incompatibilidad declarada del
parser typescript-eslint con TypeScript 7; la comprobación de tipos sigue siendo
responsabilidad de `npm run build`.

## Primera escritura controlada (preparada; no ejecutada)

Esta sección sustituye la propuesta anterior de `append-page-end` y el requisito
anterior de CAS: la ubicación ahora es `records-section-start`, inmediatamente
debajo del encabezado único `## Registros de prueba`, antes de la tabla semanal.
El transporte llama `notion-update-page` con `update_content`: sustituye solo ese
encabezado por el mismo encabezado más los bloques nuevos. No reemplaza la página,
no edita filas y no crea subpáginas. Los encabezados de registros son de nivel 3,
y los de ejercicios de nivel 4. La transcripción se conserva en un bloque literal
con fence de longitud suficiente para admitir backticks y etiquetas sin ejecutarlas.
Los bloques devueltos por el conversor siguen siendo bloques de dominio; el
transporte MCP recibe su representación en Markdown de Notion.

Prepara un JSON con fecha ISO exacta usando `examples/notion-workout.json` como
plantilla (contiene datos ficticios: sustituir antes de autorizar).

```sh
# Solo vista previa, puede leer Notion pero nunca escribe:
npm run notion:preview-workout -- examples/notion-workout.json

# Prueba real futura, solo tras decidir realizarla:
npm run notion:preview-workout -- examples/notion-workout.json --enable-one-write
```

El flag por sí solo no autoriza nada. El segundo comando requiere terminal
interactiva y muestra destino, ubicación, Markdown exacto y digest. Para aprobar
hay que escribir `GUARDAR <digest completo mostrado>`; cualquier otra respuesta
cancela. TypeScript verifica el permiso asociado al contenido y destino guardados
internamente, con caducidad de diez minutos y un único uso. Se conserva el OAuth,
el llavero y el constructor de servidor existentes; el comando de lectura sigue
anunciando solo fetch por defecto. No se conecta MCP a Qwen3. Si hace falta
reautorizar, usa primero `notion:read-test-page -- --authorize`.

Se comprueban duplicados en la vista previa y justo antes de escribir. El servicio
y el transporte releen el destino y comparan contenido/revisión. El MCP no admite
un CAS atómico: otra edición puede ocurrir entre esa lectura y la escritura. El
reemplazo de ancla mínimo limita el área afectada, pero no promete exclusión entre
procesos. Evita editar la página durante la prueba. El bloqueo local solo cubre
una instancia del servicio.

Después de cualquier intento, incluso si hubo timeout, el servicio relee y exige
que el contenido completo coincida con la inserción esperada y haya un único
marcador. Si Notion normaliza el Markdown, puede quedar un registro correcto sin
poder declararlo verificado: inspeccionar antes de preparar otro intento. No hay
reintentos automáticos de escritura. Las tareas asíncronas o advertencias se
consideran inciertas y se reconcilian mediante lectura; no se promete su finalización.
Si también falla la lectura posterior, detenerse y repetir solo la lectura antes
de volver a preparar una vista previa. Los registros legacy de la misma fecha
siguen exigiendo revisión humana. `saveWorkout` y `data/workouts.json` son ajenos
a este flujo.

Validación de esta fase: build, lint y 83 tests con mocks. No se ejecutó el comando
con escritura habilitada ni se modificó contenido de Notion.

## Verificación posterior estructural (sustituye la comparación textual exacta)

La primera escritura mostró equivalencias de representación: `2026\-11\-14`
se convirtió en `2026-11-14`, el marcador inline pasó de backticks a `<code>`,
Notion compactó líneas vacías entre viñetas y cambió el lenguaje del fence de
`text` a `txt`. La igualdad exacta anterior producía un falso error.

`notion-record-verification.ts` compara bloques canónicos, conservando orden,
nivel de encabezados, texto, series, cifras, cargas, notas y marcador único. Se
admiten envolturas de rich text conocidas, escapes y entidades equivalentes,
CRLF/LF y espacios no significativos fuera de bloques literales. La transcripción
literal conserva espacios, saltos y signos (solo CRLF/LF son equivalentes).
No se ignoran cambios de fecha, sesión, ejercicios, repeticiones, peso ni texto.
Se delimita el registro bajo la sección autorizada; encontrar el marcador solo
no basta. Después de una escritura también se compara el resto de la página con
el estado previo canónico. Una comprobación aislada sin snapshot previo verifica
el registro, pero no puede certificar retrospectivamente que nada más cambió.

Resultados explícitos:
- `VERIFIED`: marcador único, ubicación y estructura/contenido coincidentes.
- `NOT_FOUND`: lectura completa de la sección sin marcador esperado; no autoriza
  automáticamente otro intento.
- `INDETERMINATE`: contenido distinto, marcador duplicado, lectura incompleta,
  timeout, falta de permisos u otra imposibilidad de verificar.

El servicio conserva `saved` únicamente para `VERIFIED` y adjunta el resultado.
Los otros estados generan `NotionVerificationError` con propiedad `verification`;
no se reintenta la escritura. El módulo de inserción y transporte MCP no cambian.

Para verificar el registro existente en **solo lectura**:

```sh
npm run notion:verify-workout -- examples/notion-workout.json
```

Este comando reutiliza OAuth y el servidor de lectura, llama únicamente fetch y
no importa ningún escritor ni solicita autorizaciones de guardado. El JSON debe
ser exactamente el usado para el registro; cambiarlo produce otro marcador.
No usar el comando de escritura para comprobar un registro existente.

## Flujo unificado desde lenguaje natural

`agent:workout` interpreta texto con el `WorkoutExtractionAgent` existente, usando
Qwen3 4B en Ollama. El agente de extracción no tiene herramientas. El
`WorkoutAgent` anterior con function calling y `agent:save` siguen disponibles.
El nuevo flujo no entrega herramientas MCP ni permisos de guardado al modelo.

```sh
# Vista previa en cualquiera de los destinos; nunca escribe:
npm run agent:workout -- "Hoy he hecho press banca inclinado. Primera serie, 35 kg y 8 repeticiones. Segunda serie, 32,5 kg y 8 repeticiones." --preview-only

# Seleccionar local o Notion de forma interactiva:
npm run agent:workout -- "Hoy hice press banca: tres series de diez con 60 kg"
```

Después de interpretar, escribe `local` o `notion` cuando la terminal lo solicite.
No se elige automáticamente un destino ni se guarda en ambos. Enter cancela.
La selección Notion reutiliza OAuth, el servidor y los servicios existentes; no
se establece conexión con Notion si eliges local. Si hace falta renovar el
consentimiento interactivo, usa primero `notion:read-test-page -- --authorize`.

Para el ejemplo ficticio de series variables, la vista previa mostrará la fecha
absoluta que corresponda a `hoy` en Europe/Madrid, el ejercicio, serie 1 de 8 con
35 kg, serie 2 de 8 con 32,5 kg y la transcripción inicial literal. Observaciones
no mencionadas quedan como null y valores desconocidos se muestran como tales.
Una fecha ausente/ambigua, ejercicio sin nombre o series inconsistentes provoca
una petición de aclaración antes de preparar el guardado. Hay un máximo de cinco
iteraciones. Las aclaraciones se pasan al intérprete como contexto explícito; la
transcripción original almacenada sigue siendo la entrada inicial, sin trim ni
reescritura del modelo. Los campos detectados deben revisarse: Zod valida forma,
no garantiza que la interpretación sea fiel al texto.

Se comprueban duplicados antes de pedir confirmación. El destino local muestra la
ruta real del JSON y Notion el enlace fijo de la página autorizada. Se muestran
series individuales, desconocidos, observaciones, nota original y digest. Para
aprobar hay que escribir exactamente `GUARDAR <digest mostrado>`. `EDITAR` invalida
el permiso anterior, pide una corrección y repite interpretación, selección y
vista previa. Cualquier otra respuesta cancela. Una terminal no interactiva no
aprueba operaciones.

En local, el adaptador reutiliza `saveWorkout.invoke` y su permiso TypeScript de
un solo uso; la herramienta vuelve a comprobar duplicados y el adaptador relee el
archivo para verificar el registro. `WORKOUTS_FILE` conserva su significado. El
esquema compartido admite `sessionName` e `individualSets` opcionales para no
perder series variables; los JSON anteriores siguen válidos. La clave local
incluye esos campos solo cuando existen. La lectura del JSON se ha extraído en
`readWorkoutRecords` para no duplicar validación ni modificar datos en la vista
previa. Los fallos remotos nunca disparan un guardado local.

Notion permanece en vista previa por defecto, incluso sin `--preview-only`.
Para una **prueba posterior** de una única escritura real, ejecuta:

```sh
npm run agent:workout -- "Entrenamiento real con fecha y datos revisados" --enable-one-notion-write
```

Selecciona `notion`, revisa la vista previa exacta y escribe `GUARDAR <digest>`.
El flag no sustituye la aprobación y `--preview-only` prevalece si están ambos.
El permiso Notion existente caduca a los diez minutos y vincula contenido,
marcador, ubicación y destino. Solo se intenta un commit; el comando termina
tras el resultado. El nuevo flujo no ha ejecutado ninguna escritura real durante
su implementación. No reutilices datos ficticios para una prueba real sin
revisarlos expresamente.

`VERIFIED` permite declarar guardado. `NOT_FOUND` e `INDETERMINATE` se comunican
como errores de verificación, no como éxito ni invitación a reintentar. Usa
`notion:verify-workout` con un JSON equivalente para resolver una incertidumbre.
No hay reintentos automáticos ni fallback. La exclusión Notion ahora es compartida
por todas las instancias del servicio en un proceso; la exclusión local de este
adaptador es por ruta. No hay lock entre procesos, ni CAS remoto; no ejecutes dos
CLI que escriban simultáneamente. El comando local legado conserva su contrato.

Responsabilidades para entender la arquitectura:
- **Modelo:** interpreta; devuelve datos, nunca permisos ni destinos ejecutables.
- **Orquestador:** valida, solicita aclaraciones, pide selección, muestra una
  propuesta y coordina exactamente un destino.
- **Herramientas/adaptadores:** persisten y verifican usando los servicios ya
  probados, sin depender de afirmaciones de éxito del modelo.
- **Autorización:** decisión de la interfaz de confianza, asociada a un snapshot
  interno y consumida antes de ejecutar; cancelar/editar la invalida.

Archivos principales: `workout-interpreter.ts`, `workout-orchestrator.ts`,
`workout-persistence.ts` y `agent-workout-cli.ts`. Los tests con mocks están en
`workout-orchestrator.test.ts` y `workout-persistence.test.ts`. El eval real separado
`npm run agent:eval:extraction` solo interpreta dos casos (series comunes y
variables); no tiene destinos ni guarda archivos. El eval legado
`agent:eval:ollama` sigue disponible y conserva su confirmación de guardado local.

Validación de la integración: lint y build correctos, 131 tests Vitest aprobados,
y los dos casos del eval real de extracción aprobados con qwen3:4b. El eval no
cubre todas las expresiones posibles ni sustituye revisar cada vista previa.
