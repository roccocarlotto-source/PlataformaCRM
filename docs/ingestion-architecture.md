# Arquitectura de la capa de ingesta

Diseño de la capa que recibe datos externos —formularios de landing
pages, archivos Excel/CSV, bases de datos de terceros— y los convierte
en `Contact`, `Company` y `Activity` dentro de una organización.

Este documento define decisiones, no implementación. Ante una duda no
cubierta acá, plantearla antes de resolverla por defecto.

---

## 0. Dinámica de trabajo

El proyecto se desarrolla en un ciclo de dos agentes con una persona
en el medio, que es quien decide:

1. Se define un objetivo acotado, derivado del orden de construcción
   de la sección 6.
2. Se redacta un prompt de ejecución para Claude Code.
3. Claude Code implementa y devuelve un reporte.
4. La persona traslada ese reporte a la conversación de revisión.
5. Se evalúa el resultado contra los invariantes y este documento, y
   se redacta el prompt siguiente.

Una etapa no se da por cerrada hasta que su reporte fue revisado.

### Regla central: nunca asumir

**Ante cualquier ambigüedad, preguntar antes de implementar.** Aplica
a ambos agentes y no tiene excepciones por urgencia ni por obviedad
aparente. Una pregunta cuesta un minuto; una implementación grande
construida sobre una suposición equivocada cuesta un día y suele
arrastrar decisiones difíciles de revertir.

Situaciones que **obligan** a frenar y preguntar, en vez de elegir un
default razonable:

- El requerimiento admite más de una interpretación válida.
- Falta un dato necesario (nombre de campo, formato esperado,
  comportamiento ante un caso borde).
- La implementación parece exigir romper un invariante del proyecto:
  hay que enunciar la contradicción explícitamente, no resolverla.
- Un archivo, función o variable de entorno que se necesita no existe:
  preguntar, nunca crear una versión plausible.
- Hay dudas sobre la versión o el comportamiento de una dependencia:
  verificar contra `package.json` y el código real del repositorio,
  nunca responder de memoria.
- El alcance del pedido creció durante la implementación.

Nunca inventar nombres de campos, endpoints, variables de entorno ni
estructuras de datos: se verifican contra el repositorio.

Si hay varias dudas, se listan todas juntas al principio, antes de
escribir código, no de a una a medida que aparecen.

### Verificación contra el repositorio

Cuando algo no cierra —un reporte que no coincide con lo esperado, una
duda sobre el estado actual, una referencia a un archivo— **se revisa
el código antes de opinar**, no se deduce.

Nota importante sobre la revisión: el agente de revisión trabaja sobre
una **copia subida manualmente, no sobre la carpeta en vivo**. No hay
sincronización automática. Eso implica que:

- Después de cambios relevantes, hay que volver a subir el proyecto
  para que la revisión se haga sobre el estado real.
- El agente de revisión debe declarar sobre qué versión está mirando y
  **pedir los archivos actualizados** cuando lo que ve no coincide con
  el reporte recibido, en lugar de suponer que el reporte es fiel.
- Claude Code, en cambio, sí lee el proyecto en vivo: cuando la duda
  es sobre el estado actual del código, la fuente de verdad es él.

### Formato del reporte de Claude Code

Al terminar una tarea, el reporte incluye:

- Archivos creados y modificados, con ruta.
- Decisiones tomadas y por qué.
- **Suposiciones que hubo que hacer** — idealmente vacío. Si esta
  sección tiene contenido, algo falló en el paso de preguntar.
- Comandos ejecutados y su resultado (typecheck, build, tests).
- Lo que quedó **fuera** del alcance y por qué.
- Dudas abiertas para la siguiente iteración.

---

## 1. Principio rector

**Ningún dato externo se escribe directo en una tabla de negocio.**

Todo lo que entra aterriza primero en una tabla de staging con su
payload crudo intacto. Recién después de validar y mapear se promueve
a `Contact` / `Company` / `Activity`.

El motivo es que los datos externos siempre están sucios, y sin
staging cada error es irreversible: no se puede reprocesar lo que ya
se escribió mal encima de los datos buenos. Con staging se gana
reproceso, auditoría de origen, y la posibilidad de corregir un mapeo
y volver a correrlo.

Esto es lo mismo que aplica a un futuro chatbot con permiso de
escritura: el productor propone, una capa intermedia valida, y recién
ahí se persiste.

---

## 2. Modelos nuevos

Todos con `organizationId`, todos en el test de aislamiento.

**`Source`** — una instancia concreta de integración: "landing page de
precios", "Excel de la feria de marzo", "Postgres del cliente X".
Campos: `organizationId`, `name`, `type` (`WEBHOOK` | `FILE_IMPORT` |
`EXTERNAL_DB`), `fieldMapping` (JSONB), `isActive`, timestamps.

**`ApiKey`** — credencial de ingesta, siempre asociada a exactamente
una organización. Campos: `organizationId`, `sourceId`, `keyHash`,
`keyPrefix` (los primeros caracteres, visibles, para identificarla en
la UI sin exponer el resto), `lastUsedAt`, `revokedAt`.
**La clave se guarda hasheada, nunca en claro**, y se muestra una sola
vez en el momento de crearla.

**`IngestionEvent`** — una fila por cada intento de ingesta. Campos:
`organizationId`, `sourceId`, `externalId` (nullable), `rawPayload`
(JSONB), `status` (`PENDING` | `PROCESSED` | `FAILED` | `DUPLICATE`),
`errorMessage`, `promotedContactId` (nullable), timestamps.

Restricción crítica: **único parcial `(sourceId, externalId)` donde
`externalId IS NOT NULL`**. Es lo que hace la ingesta idempotente.

---

## 3. Autenticación de ingesta — segundo camino

El middleware `authenticate` actual asume un JWT de usuario de
Supabase. Una landing page pública no tiene usuario. Hace falta un
segundo camino, **no una modificación del primero**.

- Nuevo middleware `authenticateApiKey`, montado solo en las rutas de
  ingesta.
- Lee la clave de un header (`X-API-Key`), la hashea, busca la fila,
  verifica que no esté revocada, y resuelve `organizationId` y
  `sourceId`.
- Produce un **contexto distinto**, `IngestContext { organizationId,
  sourceId }`. No reutilizar `AuthContext`: no hay `userId` ni `role`,
  y forzar la forma existente terminaría en un `userId` falso o
  nullable, que es exactamente el tipo de agujero que después nadie
  ve.
- Las rutas de ingesta **no montan `authorize`**: una API key no tiene
  rol y no debe poder hacer nada más que ingestar.
- Rate limit propio y más estricto por clave, independiente del
  existente. Un endpoint público es spameable por definición.

Invariante: **una API key resuelve a exactamente una organización,
siempre.** Nunca a varias, nunca a ninguna.

---

## 4. Idempotencia y deduplicación

Son dos problemas distintos y se resuelven en capas distintas.

**Idempotencia (a nivel evento).** Un webhook que reintenta y un Excel
que se sube dos veces no pueden duplicar. Cada evento trae un
`externalId` provisto por la fuente o derivado determinísticamente del
payload (hash estable del contenido). El único parcial sobre
`(sourceId, externalId)` lo garantiza en la base, no en el código.

**Deduplicación (a nivel contacto).** Ya existe un índice único
parcial `(organization_id, email) WHERE email IS NOT NULL` en
`manual_constraints.sql`. Toda promoción a `Contact` debe ser un
**upsert por email**, nunca un insert: un insert ciego revienta contra
esa restricción en cuanto llegue el segundo formulario del mismo
lead, que es el caso normal, no el borde.

**Política de merge en conflicto** (decisión, no detalle):

- Un campo entrante nulo o vacío **nunca** pisa un valor existente en
  el CRM. Los datos que cargó una persona valen más que los que llegan
  de un formulario.
- Un campo entrante con valor sí actualiza si el existente es nulo.
- Si ambos tienen valor y difieren, **se conserva el del CRM y se deja
  registro** en el `IngestionEvent`. Nunca sobrescribir en silencio.
- `lifecycleStage` no se degrada nunca por ingesta: un `CUSTOMER` no
  vuelve a `LEAD` porque alguien llenó un formulario.
- Contactos sin email no se deduplican automáticamente. Se promueven
  como nuevos y se marcan para revisión manual.

**Alcance de "nunca sobrescribir en silencio"** *(aclaración de
2026-08-28, al implementar el borrado a pedido).* La regla gobierna el
**flujo normal de promoción**: ninguna ingesta puede pisar un dato del
CRM sin dejar rastro. **No** gobierna un borrado explícito y posterior
pedido por el titular de los datos, que es otra cosa y llega por otro
camino (`POST /api/contacts/:id/erase-personal-data`).

Ese borrado **redacta** las notas en vez de eliminarlas: conserva
`tipo`, `campo` y `motivo` —o sea, el registro de que hubo un conflicto
y en qué campo, que es lo que esta regla protege— y reemplaza solo los
valores. El registro sigue en pie; lo que se destruye es el dato
personal que contenía. Ver §5.2 de `docs/data-classification.md`.

---

## 5. Procesamiento asíncrono

Un Excel de 5.000 filas no se procesa dentro de un request HTTP.

- La ruta de ingesta hace lo mínimo: valida la clave, escribe las
  filas en `IngestionEvent` con `status: PENDING`, responde `202
  Accepted`. Nada de promoción sincrónica.
- Un worker toma los `PENDING` y los promueve. Para R1 puede ser un
  proceso in-process con polling; el punto es que la decisión sea
  explícita y que la promoción no viva en el ciclo del request.
- Cada evento se procesa de forma independiente: **una fila mala no
  aborta el lote**. Se marca `FAILED` con su `errorMessage` y el resto
  continúa.
- El resultado del lote tiene que ser consultable: cuántos entraron,
  cuántos se promovieron, cuántos fallaron y por qué. Sin esto la
  importación es una caja negra y el usuario no puede corregir nada.

---

## 6. Orden de construcción

Estrictamente en este orden. Cada etapa se termina antes de empezar la
siguiente.

1. **CI con Postgres** — antes que cualquier cosa de ingesta. Se va a
   tocar el esquema y multiplicar los caminos de escritura; sin el
   test de aislamiento corriendo solo, cualquier regresión pasa
   inadvertida.
2. **Modelos + migraciones + tests de aislamiento** de `Source`,
   `ApiKey`, `IngestionEvent`.
3. **Gestión de API keys** (crear, listar, revocar) por el camino de
   auth existente, con rol `ADMIN`.
4. **Webhook de landing page** — el caso más simple: un payload, un
   contacto. Valida el ciclo completo staging → promoción.
5. **Importación de Excel/CSV** — reusa staging y promoción; lo nuevo
   es parseo, mapeo de columnas y volumen.
6. **Bases de datos externas** — último, y ver la advertencia abajo.

---

## 7. Advertencia sobre bases de datos externas

Conectarse al Postgres o MySQL de un cliente implica **guardar
credenciales de infraestructura ajena**. Eso cambia el perfil de
riesgo del producto entero: deja de ser "si me vulneran se filtran
datos de mi CRM" y pasa a ser "si me vulneran, entro a la base de mis
clientes".

Antes de construirlo hacen falta decisiones que hoy no están tomadas:
dónde y cómo se cifran esas credenciales, si la conexión es de solo
lectura y cómo se garantiza, y qué responsabilidad legal implica.

Recomendación explícita: **posponerlo.** Cubrir primero los casos de
*push* (webhook y archivo), que resuelven la mayoría de las
necesidades reales sin asumir ese riesgo. Cuando llegue el momento,
esta parte necesita revisión de alguien con experiencia en seguridad
antes de salir a producción.

---

## 8. Errores conocidos a evitar

Lista de cosas que salen mal por defecto si nadie las decide:

- Promover a `Contact` directo desde el request, sin staging.
- Insertar en vez de upsert, y explotar contra el único de email.
- Reutilizar `AuthContext` para ingesta con un `userId` nullable.
- Procesar un archivo grande dentro del request y comerse un timeout.
- Abortar un lote entero por una fila inválida.
- Guardar la API key en claro para poder mostrarla después.
- Confiar en que el `externalId` viene siempre — hay que tener un
  derivado determinístico como fallback.
- Olvidar `organizationId` en una tabla nueva y descubrirlo cuando ya
  hay datos productivos adentro.

---

## 9. Notas de implementación

Añadidas después de la redacción original, a medida que la construcción
descubre restricciones que el diseño no podía anticipar. **No modifican las
decisiones de las secciones 1 a 8**: las anotan.

### 9.1 Particionar `IngestionEvent` por fecha es incompatible con la idempotencia

*(2026-08-24, al diseñar el ítem 2.)*

La sección 4 apoya la idempotencia en el único parcial
`(sourceId, externalId) WHERE externalId IS NOT NULL`. Si alguna vez se
propone particionar `ingestion_events` por rango de fecha para manejar el
volumen, hay que saber esto: **Postgres exige que toda constraint única de una
tabla particionada incluya la clave de partición.** El único pasaría a ser
`(sourceId, externalId, createdAt)`, que **no garantiza idempotencia** — el
mismo `externalId` reingresado al día siguiente cae en otra partición y entra
limpio.

Es decir: particionado e idempotencia son mutuamente excluyentes tal como está
especificada la restricción, salvo que la idempotencia se mude a una tabla
aparte, sin particionar, que haga de libro de `externalId` vistos.

La purga razonable, mientras tanto, no necesita ninguna columna nueva:
`DELETE FROM ingestion_events WHERE created_at < ? AND status IN
('PROCESSED','DUPLICATE')`. La ventana de idempotencia útil es corta por
naturaleza —un reintento de webhook es cuestión de minutos u horas— así que
purgar filas viejas no rompe la garantía en la práctica.

**Esa purga ya existe** *(2026-08-28, cerrando el hallazgo D2-3 de
`docs/review-fase2-2026-08-28.md`)*. Hasta acá esta sección describía la
consulta correcta y nada la ejecutaba, que es exactamente lo que los dos
reviews señalaron. Se corre a mano:

```
npm run purge:ingestion-events -- --dry-run   # cuenta, no borra
npm run purge:ingestion-events                # borra, e imprime cuántas
```

El corte es de **90 días** y la política completa —período, alcance,
disparador y método— vive en `docs/data-classification.md` §5.1, que es
donde el estándar de privacidad pide que viva. **Sin cron**: el proyecto
no tiene scheduler ni pipeline de CD, y declarar uno que nada ejecuta
daría la retención por resuelta. La consecuencia es que la retención se
cumple si alguien corre el comando, y está escrita como tal.

### 9.2 Falta un identificador de lote

*(2026-08-24, al diseñar el ítem 2.)*

La sección 5 exige que el resultado de una importación sea consultable:
*"cuántos entraron, cuántos se promovieron, cuántos fallaron y por qué"*. Pero
el modelo de la sección 2 no tiene ningún identificador de lote: un
`IngestionEvent` conoce su `Source`, no la importación concreta que lo trajo.
**Dos archivos subidos en días distintos contra la misma `Source` son
indistinguibles**, salvo por ventana de tiempo.

No se agregó nada en el ítem 2 a propósito: diseñar el lote bien —con sus
contadores y su estado— es trabajo del ítem 5, y una columna suelta ahora
podría no coincidir con lo que ese ítem necesite. El costo de agregarla
después es bajo: en Postgres moderno, `ALTER TABLE ADD COLUMN` de una columna
nullable sin default no reescribe la tabla.

Queda como requisito abierto del ítem 5, no como deuda del 2.

### 9.3 Hasheo de la API key: SHA-256, y por qué la seguridad no vive ahí

*(2026-08-24, decidido en el ítem 3.)*

La sección 2 dice que la clave se guarda hasheada y no dice con qué. La
decisión es **SHA-256 sobre la clave completa, hex, determinístico y sin sal**.

Que sea determinístico no es una concesión: es un requisito. La sección 3
define que `authenticateApiKey` "lee la clave, la hashea, busca la fila", y eso
descarta bcrypt, scrypt y argon2 **por construcción, no por preferencia** —
producen una sal distinta por fila, así que no hay valor que buscar por
igualdad y habría que traer todas y verificar una por una, O(n) por request en
el camino más caliente del sistema.

Que sea rápido tampoco es una concesión, y acá está el punto que decide.
Asociamos "hashear" con contraseñas, y esa analogía es la que está mal. bcrypt
existe porque las contraseñas las elige un humano: el espacio real de búsqueda
es chico, una tabla robada se puede recorrer offline, y lo único que lo frena
es que cada intento cueste caro. Una API key no es una contraseña — la genera
el servidor, nadie la memoriza, nadie la elige. Con suficiente entropía, el
espacio de búsqueda es tan grande que el costo por intento deja de importar. Y
una sal por fila no aporta nada, porque su función es impedir que una tabla
precomputada sirva para varias filas, y dos claves aleatorias de 256 bits no
se repiten ni se precomputan.

**Por lo tanto la seguridad de este esquema no vive en el algoritmo: vive
enteramente en la generación de la clave.** De ahí el requisito:

> La clave se genera con `crypto.randomBytes(32)` — 256 bits de un CSPRNG del
> sistema. **Nunca `Math.random()`, nunca un UUID**, nunca nada derivado de la
> organización, del nombre de la fuente o de un timestamp. Si esta línea se
> debilita, SHA-256 pasa de ser una elección correcta a ser un agujero, y nada
> en el resto del sistema lo compensa.

Un UUIDv4 es el error tentador: da 122 bits, que alcanzarían, pero viene de un
generador cuyo contrato es **unicidad, no imprevisibilidad**. Es el primitivo
equivocado aunque el número cierre.

Forma concreta: `crm_` + 43 caracteres base64url = 47. El `keyPrefix` son los
primeros 12 (`crm_` + 8), que exponen 48 bits y dejan el resto oculto; existe
para que la UI pueda identificar cuál de varias claves se está por revocar. Se
hashea la cadena completa, prefijo incluido.

**Y el ítem 4 debe hashear los bytes exactos que llegan en el header** — sin
`trim`, sin `toLowerCase`, sin normalización Unicode. Cualquier normalización
haría que dos cadenas distintas resuelvan a la misma fila, que es lo contrario
de lo que el hash está haciendo.

### 9.4 Retirar una `Source` revoca sus claves en cascada

*(2026-08-24, decidido en el ítem 3.)*

`DELETE /api/sources/:id` hace el soft delete de la fuente **y revoca todas
sus API keys activas, en la misma transacción.** No está en las secciones 1
a 8; se agregó porque la alternativa deja una garantía en el aire.

Sin la cascada, retirar una integración dejaría vivas sus credenciales, y lo
único que impediría seguir ingestando sería que `authenticateApiKey` recordara
mirar `source.deletedAt` — un invariante viviendo en un chequeo que alguien
tiene que acordarse de escribir y de no borrar. Es el mismo razonamiento por
el que C-3 puso las FKs compuestas en la base en vez de confiar en la
validación de los services: **la garantía va en los datos, no en la memoria de
quien mantiene el código.** Con la cascada, ese chequeo del ítem 4 pasa a ser
defensa en profundidad, que es donde tiene que estar.

Detalles que importan:

- La revocación filtra `revokedAt: null`, así que **no pisa la fecha real** de
  las claves que ya habían sido revocadas antes.
- **No aplica a `isActive: false`.** Pausar es reversible y rotar credenciales
  durante una pausa es legítimo; retirar es terminal.
- El endpoint responde `204` como el resto de los DELETE del proyecto, así que
  **el caller no ve cuántas claves murieron**. El conteo queda en el log a
  nivel `info`, porque revocar credenciales es un evento de seguridad. Es un
  efecto que la respuesta no comunica y por eso está documentado acá.

### 9.5 El "upsert por email" de la sección 4 no puede ser `prisma.upsert()`

*(2026-08-24, al resolver M-13.)*

La sección 4 dice que toda promoción a `Contact` "debe ser un **upsert por
email**, nunca un insert". Correcto — pero no se puede escribir con
`prisma.contact.upsert()`, y conviene saberlo antes de empezar el ítem 4.

`upsert` exige que el criterio de conflicto sea un único **declarado en el
DSL**, y `contacts_org_email_unique` es un índice **parcial** —vive en la
migración, invisible para Prisma— y a partir de M-13 es además un índice
**sobre expresión**. Ninguna de las dos formas es expresable en el schema.

La promoción va a ser SQL crudo:

```sql
INSERT INTO contacts (…) VALUES (…)
ON CONFLICT (organization_id, lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL
DO UPDATE SET …
```

Tiene una ventaja que no es menor: **la búsqueda ocurre dentro de la misma
sentencia**, así que no hay un `lower()` que alguien pueda olvidar en un
camino de lectura separado, y la política de merge de la sección 4 se expresa
en el `DO UPDATE SET` — donde `COALESCE` sobre el valor existente hace
literalmente lo que pide la regla "un campo entrante nulo o vacío nunca pisa
un valor existente en el CRM".

### 9.6 Normalización de email: dónde vive cada mitad, después de M-13

*(2026-08-24.)*

- **El case ya no se normaliza.** El índice es sobre `lower(email)`, así que
  la insensibilidad la garantiza la base. Se guarda lo que la persona escribió.
  `contact.service.ts` dejó de bajar a minúsculas: si el service lo hiciera y
  la promoción no, el mismo contacto quedaría escrito distinto según por qué
  puerta entró — que es exactamente el problema que M-13 vino a cerrar.
- **Los espacios al borde sí se normalizan, y además hay un CHECK.**
  `lower(' x ')` no es igual a `lower('x')`, así que un espacio sobrante sí
  crearía un duplicado. El `.trim()` sigue en el service y la promoción tiene
  que hacer lo mismo; el CHECK `email = btrim(email)` es el respaldo que hace
  imposible saltearlo, no el mecanismo. Una fila que llegue con espacios se
  marca `FAILED` con su mensaje y el lote sigue (sección 5).

### 9.7 La política CORS de `/api/ingest` es una decisión pendiente

*(2026-08-25, al cerrar el ítem 4.)*

El endpoint de ingesta hereda la política CORS global de `app.ts` —restrictiva,
acotada a los orígenes de `CORS_ORIGIN`— y **se decidió explícitamente no
tocarla en esta etapa**. Queda anotado porque una política heredada sin decidir
y una política heredada a propósito se ven exactamente igual en el código, y la
diferencia recién aparece cuando algo falla.

Lo que falta para poder decidirla es un dato que todavía no existe: **quién es
el llamador real**.

- Si el webhook lo dispara **JavaScript de navegador** desde la landing page,
  `CORS_ORIGIN` tiene que incluir ese dominio o el preflight lo bloquea. Pero
  ese escenario arrastra un problema mayor que el CORS: la clave de ingesta
  tendría que vivir en JavaScript de cara al público, o sea ser pública. Eso
  contradice todo lo que §3 y §9.3 sostienen sobre la clave, y la respuesta
  correcta probablemente no sea abrir el CORS sino un proxy del lado del
  servidor de la landing.
- Si es **server-to-server** —el backend de la landing, un Zapier, un CRM
  ajeno— CORS no interviene: no hay navegador, no hay origen, no hay preflight.
  La política actual ya es la correcta y no hay nada que cambiar.

Es decir: **no es una decisión de CORS, es una decisión sobre dónde vive la
clave**, y por eso no se resuelve eligiendo un valor de configuración. Relajar
el origen "por las dudas" ahora sería tomar la peor de las dos ramas sin
haberla elegido.

Queda como requisito abierto, a resolver cuando haya una integración real
enfrente.

### 9.8 Dónde terminó viviendo `fieldMapping`

*(2026-08-25, al construir el ítem 5.)*

La sección 2 declara `fieldMapping` como "JSONB" y nada más. Eso dejó abierto
quién la define y quién la consume, y durante el ítem 4 el proyecto llegó a
sostener las dos respuestas a la vez: §6.5 la ubicaba en el ítem 5 —"lo nuevo
es parseo, **mapeo de columnas** y volumen"— mientras la bitácora del
2026-08-24 §13 y tres comentarios del código decían que la escribía el ítem 4.

Queda resuelto y construido así:

- **La define y la consume el ítem 5.** Forma: un mapa plano
  `{ "<encabezado del archivo>": "<campo de Contact>" }`, validado en
  `src/schemas/fieldMapping.schema.ts`. Los destinos están restringidos a los
  mismos cinco campos que reconoce `ingestContactSchema`: cambia **cómo se
  llega** al contrato de contacto, nunca el contrato.
- **Solo en fuentes `FILE_IMPORT`.** Configurarla sobre una `WEBHOOK` o una
  `EXTERNAL_DB` se rechaza con 400. El motivo decisivo es que `type` es
  inmutable: un mapeo guardado en una fuente webhook nunca podría volverse
  útil, así que aceptarlo sería persistir configuración que demostrablemente no
  se ejecuta jamás.
- **El webhook no cambió.** Sigue con el contrato fijo del ítem 4.

Y la parte que importa más que las tres anteriores:

- **La traducción ocurre AL PROMOVER, no al parsear el archivo.** En staging
  la fila se guarda con sus encabezados **originales**. Es lo que hace cierta
  la promesa de la sección 1 —"corregir un mapeo y volver a correrlo"—: si la
  traducción ocurriera al escribir a staging, un mapeo mal configurado sería
  irreversible y habría que pedir el archivo de nuevo, que para un Excel de una
  feria de hace tres meses significa que el dato se perdió.

`Source.fieldMapping` pasa además a estar **expuesta** en la API de `Source`:
quien la configura tiene que poder leer qué quedó guardado.

### 9.9 Las filas duplicadas de una re-subida no aparecen en el lote nuevo

*(2026-08-26, al cerrar el ítem 5.)*

Subir dos veces el mismo archivo no duplica nada —§4 lo exige y así funciona—,
pero **la forma concreta en que no duplica tiene una consecuencia visible que
conviene tener escrita**, porque desde afuera se parece a datos perdidos sin
serlo.

El `INSERT ... ON CONFLICT DO NOTHING` de la segunda subida no inserta las
filas que ya existían. Esas filas **siguen perteneciendo al lote que las trajo
la primera vez**: no se reasignan al `batchId` nuevo ni se copian a él. Por lo
tanto:

- La respuesta del `POST /api/imports` de la segunda subida informa
  `duplicados: N` — y **esa respuesta es la única superficie donde el número es
  visible en el momento**.
- Consultar más tarde `GET /api/imports/:batchId` con el `batchId` de esa
  segunda subida **devuelve 404**, no un resumen en cero. `getResumenDeLote`
  deriva todo de un `GROUP BY` y no distingue "lote sin eventos propios" de
  "lote inexistente": las dos cosas dan total 0, y las dos contestan lo mismo.
  Para la API, ese lote nunca existió.

Es decir: el dato del re-envío es **efímero**. Si nadie miró la respuesta del
POST, después no hay dónde recuperarlo.

**Por qué se acepta así, y no es un descuido:**

- **No hay pérdida de datos.** Las filas duplicadas están intactas y son
  consultables — bajo el lote original, que es el que efectivamente las
  ingirió. Lo que se pierde no es un contacto: es la anotación de que alguien
  volvió a subir el mismo archivo.
- **La alternativa rompe algo más grande.** Para que el lote nuevo mostrara
  esas filas, un `IngestionEvent` tendría que poder pertenecer a dos lotes, o
  bien duplicarse. Y toda la consultabilidad del lote se deriva hoy de un
  `GROUP BY` sobre `batch_id` (§9.2): un evento con más de un dueño convierte
  esa derivación en un conteo doble, y hace que cada total del resumen deje de
  cerrar. Es cambiar una rareza acotada y sin consecuencias por una incorrección
  sistemática en todos los lotes.

Si algún día hace falta que el re-envío deje rastro consultable, el lugar
correcto **no** es el evento sino una entidad de lote propia —con sus
contadores materializados al momento de la subida—, que es exactamente lo que
§9.2 dejó fuera del alcance del ítem 2. Hasta entonces:

**Esto es deuda anotada, no un pendiente sin decidir.** Se evaluó, se eligió, y
el comportamiento está fijado por tests: `subir el MISMO archivo dos veces no
duplica` en `import.controller.integration-test.ts` afirma las tres cosas —el
`duplicados: 2` de la respuesta del POST, el `0` de eventos bajo el segundo
lote, y el 404 del GET sobre ese `batchId`—. Si alguna de las tres cambiara,
esta nota queda desactualizada y el test lo dice antes que nadie.

### 9.10 La cola se puede leer, y una fila fallida se puede volver a correr

*(2026-08-27, al relevar qué necesitaba el frontend de la capa de ingesta.)*

El relevamiento de `docs/research-frontend-ingesta-2026-08-27.md` encontró que
la capa era **escribible pero no observable**. Lo único que salía de
`ingestion_events` por HTTP eran los contadores agregados de un lote
(`GET /api/imports/:batchId`), y solo si ya se conocía su `batchId` — que se
devuelve una única vez, en el `202` del `POST`. Un evento de **webhook** era
directamente invisible: su `batch_id` es `NULL` para siempre (§9.2), así que
ninguna consulta existente lo alcanzaba. La única forma de ver un webhook
fallando era mirar la tabla en la base.

Y §1 promete que se puede *"corregir un mapeo y volver a correrlo"*, pero no
había cómo pedirlo: el worker solo reclama `PENDING`
(`claimNextPendingEvent`), así que `FAILED` era terminal.

Se agregaron dos rutas, las dos ADMIN-only por el camino de auth existente
(`authenticate` + `authorize`), nunca `authenticateApiKey` — una API key sirve
para ingestar y nada más:

- **`GET /api/ingestion-events`** — listado paginado, con filtros por
  `sourceId`, `status` y `batchId`, combinables. Cierra la observabilidad del
  webhook y, de paso, quita la necesidad de guardar el `batchId`: listar los
  eventos recientes de una fuente alcanza para encontrar una importación.
- **`POST /api/ingestion-events/:id/retry`** — transición condicional
  `FAILED → PENDING`. El worker lo recoge en su próxima pasada; **el endpoint no
  promueve nada**, porque la promoción no vive en el ciclo del request (§5).

**Cuatro decisiones que conviene tener escritas:**

1. **El listado no devuelve `rawPayload` ni `promotionNotes`.** Son las dos
   columnas JSONB de la tabla de mayor volumen del esquema: `rawPayload` puede
   ser de hasta 64 KB por fila en el webhook, o una fila entera de planilla en
   una importación. Con `pageSize=100`, una sola página podría pesar megabytes
   para un listado cuyo propósito es ver **estados**. `errorMessage` sí va, y es
   lo que hace diagnosticable una fila fallida sin traer el crudo.

2. **El reintento limpia `errorMessage`.** La columna significa una sola cosa
   —por qué falló el intento vigente— y una fila `PENDING` todavía no falló:
   dejarle el mensaje anterior sería un estado que la UI tendría que explicar y
   que ninguna consulta puede interpretar sin saber de qué intento habla. Es
   además el mismo criterio que ya aplicaba `markEventProcessed`, que lo limpia
   al pasar a `PROCESSED`. Un historial real de intentos necesitaría una columna
   o una tabla aparte —o sea, una migración— y eso quedó deliberadamente afuera.

3. **Un evento por request.** No hay reintento masivo (todos los fallidos de un
   lote o de una fuente). Es una superficie bastante más grande —¿qué devuelve si
   la mitad transiciona y la otra mitad no?— y no hacía falta para cerrar la
   brecha.

4. **El filtro de `status` acepta `DUPLICATE`** aunque ningún código lo escriba
   nunca (el enum lo declara, pero los duplicados no crean fila). Filtrar por él
   devuelve una página vacía, que es la respuesta correcta; restringir el schema
   a los tres estados "reales" haría que el contrato HTTP y el enum de la base
   divergieran.

**Lo que sigue sin cubrirse, dicho explícitamente:** el `rawPayload` de un
evento de **webhook** fallido no es consultable por ningún camino. Para las
filas de un lote sí lo es —`getResumenDeLote` ya lo devuelve, topeado en
`MAX_FALLAS_DEVUELTAS`—, pero un webhook no tiene lote. Cerrarlo pide un
endpoint de detalle (`GET /api/ingestion-events/:id`) que no se construyó acá
porque no se pidió, no porque no haga falta.

### 9.11 La vista previa de encabezados tiene que usar el MISMO parser que la importación

*(2026-08-27, al construir la sugerencia automática de mapeo.)*

Configurar un `fieldMapping` a mano exige saber cómo se llaman las columnas del
archivo, y hasta acá la única forma de averiguarlo era subirlo de verdad y mirar
los `encabezados` que devolvía el `202`. Se agregó **`POST /api/imports/preview`**:
mismo multipart, mismos límites (10 MB, `.csv`/`.xlsx`), sin `sourceId`, y
**sin tocar la base** — ni lee `Source`, ni escribe `IngestionEvent`, ni persiste
el archivo. Por eso tampoco recibe `organizationId`: no hay nada que aislar
porque no hay ningún dato del tenant involucrado.

**La garantía central no es "devuelve encabezados", es que devuelve LOS MISMOS
que la importación real.** `previsualizarEncabezados` llama a la misma cadena, con
las mismas funciones y en el mismo orden que `importarArchivo`:

```
formatoDesdeNombre(nombre)  ->  parsearArchivo(contenido, formato)  ->  .encabezados
```

Si divergieran, un BOM de Excel, un espacio alrededor de un encabezado o una celda
con formato alcanzarían para que el mapeo armado mirando la vista previa no
matcheara lo que la importación interpreta después, y las filas fallarían con
*"ninguna columna del fieldMapping existe"* sin que nada explique por qué.

Eso no se verifica leyendo el código: un test sube **el mismo archivo por los dos
caminos** y compara las dos respuestas, con contenido deliberadamente hostil (BOM,
espacios, una columna sin nombre al final). Si alguien mete un parser propio en el
preview, ese test lo ve.

**Consecuencia heredada, y deliberada:** `parsearArchivo` rechaza con `400` un
archivo sin filas de datos, así que un archivo con **solo encabezados** tampoco se
puede previsualizar. Relajarlo exigiría saltear `parsearArchivo`, o sea abrir el
segundo camino que este endpoint existe para evitar — y un archivo que la
importación real rechazaría no es uno para el que valga la pena configurar un
mapeo.

### 9.12 La sugerencia de mapeo es una heurística acotada, no una promesa

*(2026-08-27, al integrar la vista previa en el formulario de `Source`.)*

Con los encabezados reales a mano, el formulario precarga una fila del mapeo por
columna y **sugiere** el campo de destino. Tres límites que conviene tener
escritos, porque los tres son decisiones y no capacidades faltantes:

1. **Los destinos posibles son los cinco de `CAMPOS_DE_CONTACTO`** y nada más
   (`firstName`, `lastName`, `email`, `phone`, `jobTitle`) — el mismo conjunto que
   `ingestContactSchema` reconoce, por la razón de §9.8: cambia cómo se llega al
   contrato, nunca el contrato. Una columna como **"Observación" no tiene destino
   razonable y no se le inventa uno**: queda con el destino vacío, igual que una
   fila agregada a mano, para que la persona decida.
2. **Sin fuzzy matching.** La comparación es del encabezado normalizado
   (minúsculas, sin tildes, espacios colapsados) contra una tabla fija de
   sinónimos. Un acierto parcial equivocado mapea una columna al campo incorrecto
   **en silencio**, y una fila mal sugerida que nadie revisa es peor que una fila
   vacía que salta a la vista.
3. **Es un merge, nunca un reemplazo.** Las filas que ya existen no se tocan: quien
   configuró un mapeo a mano no lo pierde por subir un archivo de muestra. Y la
   comparación de "esta columna ya está" es **exacta, no normalizada**, porque
   `traducirConMapeo` compara la clave del JSON contra el encabezado del archivo
   carácter por carácter: `"Mail"` y `"mail"` son dos columnas distintas para el
   sistema, y deduplicarlas acá escondería una fila que después no matchearía nada.

Nada se aplica solo: las filas sugeridas quedan visibles y editables, y se
persisten con el mismo botón Guardar que cualquier otro campo del formulario.

**Aparte, sobre `EXTERNAL_DB`:** el `<select>` de tipo del formulario ofrece solo
`WEBHOOK` y `FILE_IMPORT`. El valor sigue existiendo en el enum de Prisma y el
backend lo acepta —el tipo del frontend también lo declara, para poder representar
una fuente que llegue por otro camino— pero no se ofrece crear una: el ítem 6
sigue pospuesto (§7) y no hay ninguna forma de ingesta que lo consuma, así que una
fuente de ese tipo hoy no haría nada.
