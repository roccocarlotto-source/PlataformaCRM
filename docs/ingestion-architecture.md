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
