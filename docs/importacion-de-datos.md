# Importación de datos para el alta de clientes

Diseño del asistente con el que el platform admin carga, durante el alta de un
cliente, la información que ese cliente ya tiene en otro sistema: contactos,
empresas, historial y stock de vehículos.

**Estado: diseño aprobado por Rocco el 06/10/2026, con las decisiones de §13.**
Rige la regla de §0 de `docs/ingestion-architecture.md`: lo que este
documento no decide se pregunta, no se resuelve por defecto. Las dos
excepciones a ese documento que este diseño introduce (idempotencia por
registro y "pisar") están anotadas también allá, en §4 y en §9.14.

Decisiones de producto que este documento toma como dadas (Rocco,
06/10/2026):

- Se importan contactos completos, stock de vehículos, historial (notas,
  llamadas, tareas) y empresas. Las oportunidades quedan afuera por ahora.
- Orígenes por fases: Fase 1, Excel, CSV y Google Sheets. Fase 2, conectores a
  CRMs (se elige cuál con el primer cliente concreto). Fase 3, bases SQL, que
  siguen pospuestas por §7 de `docs/ingestion-architecture.md`.
- Importa solo el platform admin, como parte del alta del cliente.
- Duplicados: se eligen en la vista previa. Por defecto se completa lo vacío
  sin pisar.
- Las fotos del stock se descargan y se guardan.
- Sincronización: solo para el stock desde Google Sheets, opcional. El resto es
  una importación repetible, sin sincronizar.

Todos los ejemplos usan valores ficticios.

---

## 1. Lo que ya existe y cómo encaja

| Pieza | Dónde | Qué se reusa |
|---|---|---|
| Staging | `IngestionEvent` (`ingestion_events`), con `batchId`, `rawPayload`, `promotionNotes` | Toda fila importada aterriza acá antes de tocar una tabla de negocio (§1). |
| Worker de promoción | `src/workers/ingestionWorker.ts`, `claimNextPendingEvent` con `FOR UPDATE SKIP LOCKED` | Promueve las filas confirmadas, una transacción por fila, una mala no aborta el lote (§5). |
| Parseo | `src/utils/spreadsheet.ts` (`csv-parse` 7, `exceljs` 4) | Mismo parser para la vista previa y la importación (§9.11). Se amplía, no se duplica. |
| Promoción de contacto | `promotion.service.ts` + `promoteContact` (upsert por `lower(email)`, §9.5) y dedup por teléfono bajo el lock de la organización | Base del promotor de contactos. Se amplía con los campos nuevos. |
| Mapeo | `fieldMapping.schema.ts` (5 campos) y la sugerencia por sinónimos de `frontend/src/features/source/fieldMapping.ts` (§9.12) | Mismo criterio: tabla fija de sinónimos, sin fuzzy matching, todo editable. |
| Campos personalizados | `utils/camposPersonalizados.ts` (`validarValorDeCampo`) | Validación del valor por tipo. Incluye `MULTI_SELECT` (#426). |
| Vehículo de interés | `Contact.vehicleOfInterestId` + `vehicleOfInterestSetBy` (#410) | La importación lo carga con `HUMAN`: el agente no lo pisa. |
| Unir contactos | `contactMerge.service.ts` (#411) | Es la salida para los duplicados que la importación no puede resolver sola (contactos sin email ni teléfono). |
| Stock | `vehicle.service.ts` (código interno, unicidad de patente y VIN, sincronización con la base de conocimiento), `vehiclePhoto.service.ts` (bucket `vehicle-photos`, 5 MB, JPEG/PNG por magic bytes) | La promoción de vehículos y de fotos pasa por estos services, no los esquiva. |
| Platform admin | `requirePlatformAdmin`, rutas `/api/admin/organizations/:organizationId/...` con el id del path validado | Mismo patrón para todas las rutas nuevas. |
| Cifrado y OAuth | `utils/encryption.ts`, `utils/oauthState.ts`, conexión de Google Calendar | Solo si se elige OAuth para Sheets (§4.3). |
| Neutralización de fórmulas | `neutralizarCeldaParaExportar` en `utils/spreadsheet.ts` | Se aplica en todo lo que se exporta (CSV de fallidas, informe). |

Lo que **no** existe hoy y este diseño necesita: detección de separador y de
codificación en CSV, un helper de descarga de URLs externas con protección
SSRF, exportación a CSV, un tope de fotos por vehículo, un índice único de
teléfono, patente o VIN (la unicidad vive en los services), y un scheduler (los
workers son bucles `setTimeout` in-process).

**Lo que la importación de hoy no cambia.** `POST /api/imports`,
`/api/imports/preview`, `GET /api/imports/:batchId`, las fuentes `FILE_IMPORT`
con su `fieldMapping` de cinco campos y el webhook `POST /api/ingest` siguen
iguales, con sus tests. El asistente es un camino nuevo que comparte las piezas
de abajo; no reemplaza al viejo.

**Efectos secundarios: no se disparan automatizaciones.** Crear un contacto o
una actividad no emite eventos al outbox hoy (las automatizaciones salen de
oportunidades: `opportunity.won`, `opportunity.stale`, etc.). Importar 5.000
contactos no le escribe por WhatsApp a nadie. Un test lo fija, para que una
automatización futura de "contacto nuevo" no herede la importación sin que
nadie lo decida. Los vehículos sí tienen un efecto: crear o actualizar uno
sincroniza la base de conocimiento del agente (`vehicleKnowledgeBaseSync`), y
eso es lo correcto: el stock importado tiene que poder consultarse.

---

## 2. Modelo: lote, vínculo externo y staging ampliado

### 2.1 `ImportBatch`: el lote como entidad

§9.2 y §9.9 dejaron escrito que, si el lote necesitaba estado y contadores
propios, el lugar era una entidad aparte. El asistente lo necesita (pasos,
progreso, informe, deshacer), así que se crea:

```
import_batches
  id, organization_id
  source_id            -> Source FILE_IMPORT del sistema de origen (§3.1)
  entity_type          COMPANY | CONTACT | ACTIVITY | VEHICLE
  origin_kind          FILE | GOOGLE_SHEETS_LINK | SYNC
  status               STAGED | ANALYZING | READY | RUNNING | DONE | CANCELLED | UNDOING | UNDONE
  file_name, file_sha256, file_bytes, row_count
  config               JSONB: mapeo, ajustes de formato, columna de clave externa,
                       política de duplicados por defecto, sucursal, autor por defecto
  counters             JSONB materializado al terminar: creados, actualizados,
                       sin cambios, omitidos, fallidos
  created_by_user_id   el platform admin (uuid de auth.users, sin FK a users:
                       el admin no es miembro de la organización)
  confirmed_at, finished_at, undone_at, undone_by_user_id
  created_at, updated_at
```

Con `organization_id` y FK compuesta a `Source` (C-3), RLS como el resto, en el
test de aislamiento, en el diagnóstico y con su patrón de slug de prueba
(checklist de tabla nueva).

`ingestion_events.batch_id` ya existe y es un uuid suelto. Las filas del
asistente lo llenan con el id del `ImportBatch`; las de `POST /api/imports`
siguen con su uuid suelto, sin fila en `import_batches`. Se distinguen por la
existencia de esa fila. No se agrega FK sobre `batch_id`, porque rompería los
lotes viejos que no tienen entidad.

### 2.2 `ExternalRecordLink`: la identidad del registro de origen

El problema: la idempotencia de hoy es **por evento** (único parcial
`(source_id, external_id)`, §4). En un archivo, el `externalId` es el hash de
`{ fila, datos }` (§9.13): una fila idéntica no vuelve a entrar, pero una fila
**corregida** entra como evento nuevo y se promueve por email. Eso alcanza para
no duplicar contactos con email. No alcanza para lo que pide la reimportación:

- un contacto sin email, una empresa, un vehículo o una nota no tienen upsert
  natural. Volver a subir el archivo los duplicaría;
- "volver a subir el mismo archivo actualiza" exige que una fila **cambiada**
  encuentre el registro que creó la primera vez, aunque haya cambiado el email.

La identidad se guarda **por registro**, no por evento:

```
external_record_links
  organization_id, source_id, entity_type, external_key
  entity_id            el Company / Contact / Activity / Vehicle
  created_by_batch_id  el lote que lo CREÓ (null si el registro ya existía
                       y el lote solo lo vinculó)
  created_at, updated_at
  UNIQUE (organization_id, source_id, entity_type, external_key)
```

Va en una tabla y no en una columna `external_id` de cada tabla de negocio
porque son cuatro tablas, un registro puede venir de más de un sistema (un
contacto que está en la planilla vieja y después en un CRM) y porque las tablas
de negocio no tienen por qué saber de dónde vino cada fila.

### 2.3 Cómo convive con §4 y §9.5

Esto **no contradice §4, pero sí cambia dónde vive la idempotencia para el
asistente**. Es una excepción aprobada (§13, decisión 1) y está anotada en §4
y §9.14 de `docs/ingestion-architecture.md`:

- En el asistente, cada fila de cada lote entra como evento propio:
  `externalId = sha256(batchId, número de fila)`. Así cada lote tiene sus
  filas, el informe de una re-subida muestra todo lo que trajo (cierra la
  rareza de §9.9 para este camino) y una fila corregida se procesa.
- La garantía de "subir dos veces no duplica" pasa a la tabla de vínculos, con
  su único en la base, no en el código. Es la misma filosofía de §4 —la
  garantía va en los datos— aplicada al registro en vez de al evento.
- La deduplicación de contactos de §4 y §9.5 **sigue igual por debajo**: si la
  clave externa no encuentra un vínculo, se busca por email (`lower(email)`,
  el mismo índice) y después por teléfono normalizado bajo el lock de la
  organización. Si encuentra un contacto, lo vincula; si no, lo crea con el
  mismo `INSERT … ON CONFLICT`.
- Con unir contactos (#411): si el registro vinculado fue unido a otro
  (`mergedIntoId`), la búsqueda sigue la cadena hasta el que quedó y actualiza
  el vínculo. Si fue borrado (soft delete sin `mergedIntoId`), el vínculo se
  ignora y la fila se trata como nueva.

### 2.4 Columnas nuevas en `ingestion_events`

```
status               + STAGED  (fila del asistente que todavía no se confirmó;
                                el worker no la reclama)
plan                 JSONB: lo que la vista previa calculó para la fila
                     (crear, actualizar, sin cambios, choque, falla) y por qué
decision             FILL_EMPTY | OVERWRITE | SKIP, si el admin la eligió por fila
outcome              CREATED | UPDATED | UNCHANGED | SKIPPED, al promover
promoted_entity_type, promoted_entity_id
changes              JSONB: [{ campo, antes, después }] de lo que se actualizó
```

`promoted_contact_id` se mantiene, con su FK, y se sigue llenando para
contactos: lo usan el borrado a pedido y unir contactos (`FKS_A_CONTACTS`).

### 2.5 Columnas nuevas en tablas de negocio

```
contacts.customer_since   DATE, nullable. "Cliente desde": la fecha de alta en
                          el sistema de origen. Visible en la ficha. created_at
                          sigue siendo la fecha en que el contacto entró a este
                          CRM, o sea la de la importación.
contacts.imported_at      TIMESTAMPTZ, nullable. Cuándo lo creó una
                          importación. Toda métrica de "contactos nuevos"
                          filtra imported_at IS NULL (decisión 6). Hoy no
                          existe ninguna métrica así: los tableros son de
                          oportunidades. La columna deja la regla escrita
                          para la primera que se haga.
VehicleStatus             + UNAVAILABLE (§7, decisión 16).
```

Un contacto que ya existía y que una importación solo actualiza no recibe
`imported_at`: no es nuevo por haberse importado.

### 2.6 Una sola migración

Todos los cambios de esquema de la Fase 1 van en **una sola migración**, en el
primer PR (decisión 20): las cuatro tablas nuevas (`import_batches`,
`external_record_links`, `vehicle_photo_imports` e `import_syncs`), las columnas nuevas de `ingestion_events` y `contacts`, y los dos
valores de enum (`IngestionStatus.STAGED`, `VehicleStatus.UNAVAILABLE`). Un
`ALTER TYPE … ADD VALUE` no se puede usar en la misma transacción que lo
agrega. La migración no los usa, así que no hay problema, pero conviene
saberlo si alguien quisiera sembrar datos ahí mismo. Lo que ninguna tabla usa
todavía queda vacío hasta su PR, y el diagnóstico y el test de aislamiento las
cubren desde el principio.

`claimNextPendingEvent` no cambia: reclama `PENDING`, y una fila `STAGED` no lo
es. Confirmar el lote es un `UPDATE … SET status = 'PENDING' WHERE batch_id = ?
AND status = 'STAGED'`.

---

## 3. El sistema de origen y la clave externa

### 3.1 Una `Source` por sistema de origen

Al empezar una importación, el asistente pide elegir o crear la `Source`
`FILE_IMPORT` que representa el sistema de origen ("Planilla de ventas",
"CRM anterior"). La clave externa es única **dentro de esa fuente**: el
`id 145` del CRM viejo y el `id 145` de la planilla son registros distintos.
`Contact.source` (texto libre, hoy se llena con `Source.name`) se llena con la
columna "origen" si se mapea, y si no con el nombre de la fuente, como hoy.

### 3.2 Qué se usa como clave

| Tipo | Clave elegida | En su defecto |
|---|---|---|
| Contacto | la columna que se elija como id del origen | email; si no hay, teléfono normalizado |
| Empresa | ídem | nombre normalizado (minúsculas, sin tildes, espacios colapsados) |
| Vehículo | ídem | código de stock del origen; si no hay, patente; si no hay, VIN |
| Historial | ídem | hash determinístico de `{ contacto, tipo, fecha, asunto, cuerpo }` |

Con la clave por defecto, el vínculo se guarda con un prefijo que dice de qué
es (`email:persona@example.com`, `patente:AA123BB`), para que cambiar después a
una columna de id no choque con los vínculos viejos.

Un contacto sin email, sin teléfono y sin columna de id no tiene clave: se crea,
se marca para revisión manual como hoy (§4) y el informe avisa que **una
re-subida lo duplicaría**. La vista previa lo cuenta aparte para que se vea
antes de confirmar.

### 3.3 El código de stock del origen

`Vehicle.internalCode` lo asigna el sistema (`STK-000123`, contador por
organización) y no se carga a mano. El código del sistema anterior se guarda
como clave externa del vínculo y queda visible en una línea de `internalNotes`
("Código anterior: …"). Nuestro `STK-…` sigue siendo el principal (decisión 9).

---

## 4. Orígenes de la Fase 1

### 4.1 Formatos de archivo

| Formato | Fase 1 | Por qué |
|---|---|---|
| CSV | Sí | `csv-parse` ya está. Se agregan la detección de separador y de codificación (abajo). |
| XLSX | Sí | `exceljs` ya está. Se agrega la defensa contra zip bomb (§9). |
| XLS (Excel 97-2003) | No | `exceljs` no lo lee. La única librería madura es SheetJS, cuya versión de npm quedó congelada con vulnerabilidades conocidas (prototype pollution y ReDoS) y la mantenida se distribuye fuera de npm. Sumar eso al camino que lee archivos del cliente es riesgo, no capacidad. |
| ODS | No | Tampoco lo lee `exceljs`; mismo problema. |

XLS y ODS no se soportan (decisión 2). El asistente responde: **"Guardalo
como .xlsx o .csv y volvé a subirlo"**.

**Separador del CSV.** `csv-parse` no lo detecta solo. Se mira la primera línea
no vacía fuera de comillas y se cuentan `,` `;` `\t` y `|`; gana el más
frecuente que además da la misma cantidad de columnas en las primeras 20 líneas.
El resultado se muestra en el paso de ajustes y se puede cambiar. Un Excel en
español exporta con `;`, así que este no es un caso borde.

**Codificación.** Se decodifica como UTF-8 con `TextDecoder(..., { fatal: true
})`. Si falla, se usa Windows-1252, que cubre Latin-1 en todos los caracteres
imprimibles y es lo que exporta Excel en Windows. Node 22 trae ICU completo, así
que `TextDecoder("windows-1252")` está disponible sin dependencias. La vista
previa muestra la codificación detectada y se puede forzar la otra: una "Ã±"
en los nombres es la señal de que se eligió mal.

**Hojas.** Hoy se lee solo la primera. El asistente lista las hojas del XLSX y
deja elegir una por lote.

### 4.2 Google Sheets por link

**Solo para stock** (decisión 3). El stock no tiene datos personales: marca,
modelo y precio son información que la agencia publica. Los contactos y el
historial entran solo por archivo, y el asistente no ofrece el link para esos
tipos. El backend también lo rechaza, no solo la pantalla.

El admin pega el link de una planilla compartida como "cualquier persona con el
enlace puede ver". El backend:

1. valida que sea `https://docs.google.com/spreadsheets/d/<id>/…` y extrae el id
   y el `gid` de la pestaña. Cualquier otra forma se rechaza;
2. arma él mismo la URL de exportación
   `https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>`.
   El usuario nunca elige el host;
3. la descarga con el helper de §9.3 (topes de tamaño y tiempo), siguiendo
   redirecciones solo a `docs.google.com` y `*.googleusercontent.com`;
4. si la respuesta es HTML y no CSV, la planilla no está compartida: error
   claro, "La planilla no está compartida con el enlace";
5. el CSV entra por el mismo parser que un archivo subido. Lo que se guarda en
   staging es la **foto** de la planilla en ese momento: si alguien la edita
   entre la vista previa y la confirmación, se confirma lo que se vio.

**Riesgos de esta opción**, para que la elección sea informada:

- **La planilla queda pública para quien tenga el link.** El link circula por
  mail o WhatsApp, y con datos personales de clientes eso es una exposición que
  nosotros no controlamos ni podemos revocar. Para el stock (marca, modelo,
  precio) el riesgo es bajo, porque es información que la agencia publica. Para
  contactos es alto.
- **No sabemos quién la comparte.** Cualquiera que tenga un link puede hacerlo
  pasar por la planilla del cliente.
- **Google puede limitar o cambiar la exportación.** No es una API con
  contrato. Si deja de funcionar, la sincronización falla (§7 la pausa sola).
- **Solo una pestaña por link** y sin formato: las fechas y los números llegan
  como el texto que muestra la planilla, según la configuración regional de
  quien la creó. El paso de ajustes de formato existe para esto.

**Cuándo conviene OAuth en vez del link.** Cuando hay datos personales, cuando
el cliente no quiere hacer pública la planilla, o cuando se va a sincronizar por
mucho tiempo. La conexión de Google que existe es la de Calendar: es por
sucursal y tiene scopes de calendario, y el código ya advierte que agregarle
scopes obliga a reconsentir a todas las sucursales conectadas. Lo razonable
sería una conexión aparte, de la organización, que reuse el cifrador y el
patrón de `oauthState`. Antes hay que resolver un costo: `spreadsheets.readonly`
y `drive.readonly` son scopes **sensibles o restringidos** para Google, y
exigen verificar la app (con revisión de seguridad en el caso restringido)
para salir de modo prueba. `drive.file` con el selector de archivos de Google
(Picker) no es sensible y alcanza para "elegí esta planilla". **Decidido:** en
la Fase 1 solo hay link y solo para stock. OAuth con `drive.file` y el Picker
queda diseñado y se construye cuando un cliente lo pida.

---

## 5. Tipos de dato y campos destino

En todos los tipos: una celda vacía es "sin dato", nunca "borrar". Un valor que
no se puede interpretar (una fecha imposible, una opción que no existe) hace
fallar **la fila** con el nombre de la columna y el valor, salvo donde se dice
que solo se advierte.

### 5.1 Empresas

| Destino | Columna | Notas |
|---|---|---|
| `name` | obligatoria | 255 caracteres. Es la clave por defecto. |
| `domain`, `industry`, `phone`, `city`, `country` | opcionales | Mismos largos que el modelo. |
| `ownerId` | email de un usuario de la organización | Si no existe, se advierte y queda sin dueño. |

### 5.2 Contactos

| Destino | Columna | Notas |
|---|---|---|
| `firstName`, `lastName`, `email`, `phone`, `jobTitle` | como hoy | Mismo `ingestContactSchema` y misma normalización de teléfono con el país de la organización. Para una sola columna "Nombre completo", ver abajo. |
| `leadNotes` | notas | Se agrega con `appendLeadNotes`, no se reemplaza. |
| `lifecycleStage` | etapa | Se mapean los valores del origen a `LEAD`/`MQL`/`SQL`/`CUSTOMER`/`CHURNED` en el paso de ajustes ("Cliente" → `CUSTOMER`). Nunca degrada una etapa existente (§4), ni con "pisar". |
| `source` | origen | Texto libre, 100 caracteres. Sin columna, el nombre de la fuente. |
| `ownerId` | email del vendedor | Usuario de la organización, no borrado. Si no existe, se advierte y queda sin asignar. |
| `vehicleOfInterestId` | código de stock del origen o patente | Se busca en los vínculos de vehículos y después por patente. Con `vehicleOfInterestSetBy = HUMAN`. Si no se encuentra, se advierte. |
| `companyId` | nombre de la empresa | Se busca por la clave de empresa. Si no existe, **se crea** (decisión 10). La vista previa dice "Se crearán N empresas" y tiene la opción de no crearlas: en ese caso la referencia queda vacía y advertida. |
| `customerSince` | fecha de alta original | "Cliente desde", visible en la ficha (decisión 6). `createdAt` es la fecha de la importación, y `importedAt` marca al contacto como importado (§2.5). |
| `customFields.<key>` | una columna por campo | Se interpreta según el tipo (abajo) y se valida con `validarValorDeCampo`. |

**Nombre completo en una columna** (decisión 11). Se parte en el primer
espacio: la primera palabra es el nombre y el resto el apellido ("Ana María
Pérez" → "Ana" / "María Pérez"). Si hay una sola palabra, el apellido queda
"-", porque la base lo exige, y la fila lleva una advertencia. Aparte, sin
hacerlo ahora, se propone **hacer opcional el apellido**: `lastName` NOT NULL
obliga a inventar un valor cada vez que un canal trae solo un nombre (WhatsApp,
el widget, esta importación). Hacerlo opcional es una migración y un repaso de
los lugares que arman el nombre para mostrar.

**Campos personalizados por tipo:**

- `TEXT`: tal cual, hasta 500 caracteres.
- `NUMBER`: con el separador decimal del ajuste (`1.234,56` o `1,234.56`).
- `DATE`: con el formato de fecha del ajuste, guardada `YYYY-MM-DD`.
- `BOOLEAN`: con la lista de "sí" y "no" del ajuste (por defecto `sí/si/s/x/1/true/yes`
  y `no/n/0/false`). Lo que no esté en ninguna lista falla.
- `SELECT`: compara contra las opciones sin distinguir mayúsculas, tildes ni
  espacios de más, con el mismo criterio que ya usa la definición para decidir
  si dos opciones están repetidas, y guarda el texto exacto de la opción.
- `MULTI_SELECT` (#426, ya en master): se parte por `;` o `,` (ajustable) y se
  compara cada parte como en `SELECT`.

Una opción que no existe **falla la fila**. No se crean opciones nuevas desde la
importación: las opciones las define un ADMIN, y una planilla con "Contado",
"contado." y "CONTADO " terminaría con tres. La vista previa agrupa las fallas
por valor ("12 filas con «Financiado», que no es una opción de Forma de
pago") para que se resuelva agregando la opción una vez y reanalizando.

### 5.3 Historial

| Destino | Columna | Notas |
|---|---|---|
| `type` | tipo | `NOTE`, `CALL` o `TASK`, con un mapeo de valores en los ajustes. También se puede fijar un tipo para todo el lote. |
| `contactId` | email, teléfono o id del contacto en el origen | Se busca primero por el vínculo (si se mapea el id del origen), después por email y por teléfono normalizado. Sin contacto, la fila falla: una actividad suelta no tiene dónde mostrarse. |
| `subject` | asunto | Obligatorio en el modelo (255). Si no hay columna, se arma con el tipo y la fecha ("Llamada del 14/03/2025"). |
| `body` | texto | Sin tope propio. Se aplica el tope de celda (§9). |
| fecha | fecha original | Tarea: `dueDate`, y `completedAt` con la fecha original si una columna o el ajuste dice que estaba hecha (decisión 7). Nota y llamada: ver la pregunta pendiente P1 al final de §13. |
| `authorId` | — | El usuario de la organización que se elige en el asistente; por defecto, el ADMIN más antiguo (decisión 5). Si el origen trae autor, su nombre va al final del texto: "Autor original: …". |
| `assigneeId` | email del responsable (tareas) | Si no existe, queda asignada al autor elegido. |

**Tareas pasadas** (decisión 7):

- las que vienen hechas quedan completadas con su fecha original;
- las no hechas con fecha vencida quedan abiertas y vencidas, asignadas al
  autor elegido.

### 5.4 Stock de vehículos

El modelo no es "precio + moneda". Tiene dos precios de lista guardados por
separado (`priceListUsd` y `priceListLocal`), y el costo y el precio mínimo son
solo en dólares. El mapeo se adapta así:

| Pedido | Destino | Notas |
|---|---|---|
| marca, modelo, año | `make`, `model`, `year` | Obligatorios en el modelo. Año entre 1900 y 2100. |
| versión | `trim` | |
| km | `mileage` | Entero ≥ 0, con el separador de miles del ajuste. |
| precio + moneda | `priceListUsd` o `priceListLocal` | Según la columna de moneda o, sin ella, la moneda por defecto del ajuste. También se pueden mapear dos columnas de precio, una por moneda. |
| costo, precio mínimo | `acquisitionCostUsd`, `minAcceptablePriceUsd` | Solo USD. En otra moneda, se convierten a USD con la cotización vigente de la organización, y la vista previa muestra cuál se usó. Sin cotización cargada, la fila falla con un motivo claro (decisión 8). |
| estado | `status` | Ver abajo. |
| color | `exteriorColor` | Texto libre, 50. |
| combustible, transmisión | `fuelType`, `transmission` | Mapeo de valores en los ajustes ("Nafta" → `GASOLINE`, "Automática" → `AUTOMATIC`). |
| patente, VIN | `licensePlate`, `vin` | Con la regla de unicidad de `vehicle.service.ts`: una patente o VIN que ya tiene otra unidad de la organización es un choque. |
| código de stock | clave externa (§3.3) | |
| fotos | una columna con varios links o varias columnas | §6. |

Dos datos que el modelo exige y el pedido no menciona:

- **`condition` (NEW/USED)**, NOT NULL: columna si existe, si no un valor por
  defecto del lote (por defecto `USED`).
- **`branchId`**, NOT NULL: el asistente pide la sucursal del lote. Si la
  organización tiene una sola, se elige sola. Opcionalmente, una columna
  "sucursal" por nombre.

**Estado.** La importación escribe `AVAILABLE`, `IN_PREPARATION`,
`IN_TRANSIT` y `UNAVAILABLE`. `RESERVED` y `DELIVERED` los maneja el CRM a
partir de las oportunidades (`vehicleStatusForOpportunityStatus`) y las
entregas, y las oportunidades no se importan. **Las unidades vendidas en el
origen se omiten por defecto.** Una casilla del lote, "Importar también las
vendidas (historial)", las crea como `SOLD`, sin oportunidad (decisión 12).

**`UNAVAILABLE` ("No disponible").** Se agrega al enum porque no hay un flag
que haga lo que pide la decisión 16. `visibleInListing` saca la unidad solo
del listado diario del stock, y eso como filtro opcional: los selectores la
siguen mostrando y el agente no lo mira. El agente ofrece únicamente
unidades `AVAILABLE` (la búsqueda de stock y la base de conocimiento filtran
por ese estado), así que una `UNAVAILABLE` queda afuera sin tocar el agente.
Un test lo fija. En el CRM se muestra con su etiqueta y no se puede vincular a
una oportunidad, igual que una vendida.

Los vehículos se crean y actualizan con las funciones de `vehicle.service.ts`
(código interno, unicidad, registro de cambios y sincronización con la base de
conocimiento), no con un `INSERT` propio.

### 5.5 Orden de dependencias

```
empresas ─► contactos ─► historial
stock ─────► contactos   (solo si los contactos traen vehículo de interés)
```

El asistente lo sostiene así:

- **Impide** confirmar un lote mientras otro lote de la misma organización del
  que depende está en `RUNNING`: el historial no se confirma mientras corre un
  lote de contactos. Si no, una nota buscaría un contacto que todavía no existe.
- **Advierte** en la vista previa, por fila, cada referencia que no resuelve:
  "la empresa «Ejemplo SA» no existe", "el vehículo `AA123BB` no está en el
  stock". Al principio del paso de mapeo, si se mapea una columna de empresa o
  de vehículo y la organización no tiene ninguno, un aviso propone importar eso
  primero.
- **No impide** importar contactos sin haber importado empresas: es legítimo
  que el origen no tenga empresas. La referencia queda vacía y advertida.

---

## 6. Fotos del stock

**Dónde.** En el bucket `vehicle-photos`, con la misma ruta
(`<orgId>/<vehicleId>/<uuid>.<ext>`) y la misma fila `VehiclePhoto` que una foto
subida a mano. La primera foto del origen queda como portada si la unidad no
tenía.

**Cuándo.** No dentro de la promoción del vehículo: descargar 20 fotos dentro de
la transacción que tiene tomado el evento sería colgar el worker y la conexión a
la base. La promoción del vehículo encola un pedido por foto en una tabla
propia y termina. Un worker aparte las descarga:

```
vehicle_photo_imports
  id, organization_id, batch_id, vehicle_id
  url, url_sha256, position
  status    PENDING | DONE | FAILED | SKIPPED
  attempts, next_attempt_at, error
  vehicle_photo_id   la foto creada
  UNIQUE (organization_id, vehicle_id, url_sha256)
```

El único hace que reimportar no vuelva a bajar la misma foto. La foto que se
sacó de la planilla no se borra del vehículo: la importación nunca borra.

**Topes** (decisión 13; el tope por lote lo propone este documento):

| Tope | Valor | Por qué |
|---|---|---|
| Fotos por vehículo | 20 | Hoy no hay tope. Las que sobran se informan y no se bajan. |
| Tamaño por foto | 5 MB | El mismo `VEHICLE_PHOTO_MAX_BYTES` de la subida a mano. Se corta la descarga al pasarlo, no se baja entera. |
| Tiempo por foto | 15 s en total, 5 s para conectar | |
| Fotos por lote | 3.000 | Unos 150 vehículos con 20 fotos. A unos 2 s por foto con 3 en paralelo son unos 35 minutos de worker, el máximo razonable para un alta. Un stock más grande se parte en varios lotes. Las que pasan el tope se informan antes de confirmar. |
| Bytes por lote | 1,5 GB | El peor caso de 3.000 fotos de 5 MB es 15 GB. Este tope protege la cuota del Storage de un lote con fotos enormes. Al llegar, las fotos que faltan quedan `SKIPPED` con el motivo. |
| Redirecciones | 3, cada una validada de nuevo | |
| Concurrencia | 3 descargas a la vez en todo el proceso | El worker es in-process y comparte la máquina con la API. |
| Reintentos | 3, con el backoff de `utils/backoff` | Un 404 o un tipo inválido no se reintenta. |

**Tipo.** JPEG, PNG o WebP, por magic bytes (`detectImageType`), lo mismo que
la subida a mano. WebP se suma **antes** de la importación, en un PR aparte y
para todos los caminos de subida de fotos (decisión 14), así una foto
importada nunca es de un tipo que no se pueda subir a mano.

**Links de Google Drive.** Es común que la planilla tenga
`drive.google.com/file/d/<id>/view`, que devuelve una página HTML y no la
imagen. Se reconoce esa forma y se convierte a la URL de descarga directa. Si
Drive devuelve HTML igual, la foto falla con "El archivo de Drive no está
compartido".

**SSRF.** El helper de §9.3. Solo `http` y `https`, puertos 80 y 443, sin
usuario ni contraseña en la URL, y la IP resuelta tiene que ser pública. Una
foto que falla no tumba el vehículo: queda en el informe con el link y el
motivo.

---

## 7. Sincronización del stock desde Google Sheets

Opcional, solo para un lote de stock que vino de un link de Sheets. En el paso
de confirmar aparece la casilla **"Mantener sincronizado cada N horas"**,
apagada por defecto, con mínimo 1 h y 6 h sugeridas.

```
import_syncs
  id, organization_id, source_id, created_by_user_id
  sheet_id, sheet_gid
  config               JSONB: el mismo mapeo y ajustes del lote que la creó
  interval_hours       >= 1
  mark_missing_unavailable  boolean, apagado por defecto
  next_run_at, locked_until, last_run_at, last_batch_id
  last_status          OK | FAILED, last_error
  consecutive_failures, paused_at, paused_reason (MANUAL | AUTO_FAILURES)
  deleted_at, created_at, updated_at
```

**Cada corrida** es un `ImportBatch` con `origin_kind = SYNC` que se confirma
solo, sin vista previa. Así su informe se ve igual que el de una importación a
mano, con el mismo detalle por fila.

**Reglas:**

- **Solo crea y actualiza los campos mapeados. Nunca borra.** La planilla
  manda sobre los campos mapeados y los pisa: para eso es sincronizar
  (decisión 15). Lo que no está mapeado no se toca. La pantalla lo avisa al
  activar la casilla: **"Los campos mapeados se actualizan desde la planilla
  en cada sincronización"**.
- **Las unidades que desaparecen de la planilla se informan** en el resumen de
  la corrida. Pasarlas a `UNAVAILABLE` es la opción aparte
  `mark_missing_unavailable`, apagada por defecto. Si la unidad vuelve a
  aparecer, la próxima corrida no la devuelve sola a `AVAILABLE`, salvo que la
  columna de estado esté mapeada.
- **Nunca pisa el estado que maneja el CRM.** Si la unidad está `RESERVED`,
  `SOLD` o `DELIVERED`, o tiene una oportunidad abierta vinculada, la columna de
  estado se ignora para esa unidad y se anota en la corrida. Lo mismo vale para
  marcarla no disponible.
- **Fotos:** solo se bajan las URLs nuevas.
- **Estado visible:** en Plataforma → Importar datos → Sincronizaciones, cada
  una con la última corrida, su resultado, su error y el informe.
  Se puede pausar, reanudar y borrar (soft delete).
- **Pausa automática:** con 3 fallas seguidas (no poder bajar la planilla, que
  deje de ser CSV, que el mapeo ya no matchee ninguna columna) se pausa sola con
  `paused_reason = AUTO_FAILURES` y queda resaltada. Una corrida con filas
  fallidas pero que bajó y leyó la planilla no cuenta como falla de la
  sincronización.

**Worker.** `importSyncWorker`, el mismo esquema que los demás (bucle
`setTimeout`, `IMPORT_SYNC_WORKER_ENABLED`, `IMPORT_SYNC_WORKER_POLL_MS`, por
defecto cada 5 minutos). Reclama las sincronizaciones vencidas con el lock en
la base que se describe abajo, y corre `next_run_at` **antes** de bajar la
planilla, en la misma sentencia. Bajar y escribir el staging pasa después,
fuera de esa transacción. Las filas las promueve el worker de ingesta de
siempre.

**El supuesto de una sola instancia.** `docs/deployment.md` dice que el backend
corre como un solo proceso: los workers viven dentro del proceso HTTP y los
rate limiters en memoria. Las auditorías locales lo registran como G-04 y G-09
(`docs-privados/auditoria-2026-10-04-OPUS.md` y
`docs-privados/auditoria-2026-10-05-FABLE.md`, solo en la máquina de Rocco).
Con dos réplicas, cada worker correría dos veces. La sincronización no
depende de ese supuesto, por diseño:

- **el lock está en la base, no en memoria.** El reclamo es un `UPDATE …
  SET next_run_at = now() + interval, locked_until = now() + 15 min WHERE id
  = (SELECT … WHERE next_run_at <= now() AND (locked_until IS NULL OR
  locked_until < now()) … FOR UPDATE SKIP LOCKED LIMIT 1)`. Dos procesos no
  pueden tomar la misma sincronización, y un proceso que muere a mitad de la
  corrida la libera cuando vence `locked_until`;
- **no guarda estado en memoria entre corridas.** Cuándo toca, cuántas veces
  falló y si está pausada viven en `import_syncs`, así que reiniciar el proceso
  (el despertar de Render de G-09) no resetea nada.

Lo que sí depende del proceso único es el tope de 3 descargas de fotos a la
vez: con dos réplicas serían 6. Es un tope de carga, no de corrección.

**Si Render está dormido.** Hoy el servicio se mantiene despierto porque
UptimeRobot le pega cada pocos minutos. Si dejara de hacerlo y el servicio se
durmiera, no corre ningún worker, este tampoco. Al despertar, el worker ve las
sincronizaciones con `next_run_at` vencido y corre **una vez** cada una, no
una por cada intervalo perdido. Después programa la siguiente desde ahora. No se
pierde nada, se atrasa. La pantalla muestra "última sincronización hace 14 h"
para que el atraso se vea. Un deploy a mitad de una corrida tampoco pierde
nada: las filas ya escritas en staging quedan `PENDING` y el worker de ingesta
las sigue al arrancar.

---

## 8. El asistente

En **Plataforma → Importar datos**, solo para platform admin (mismo
`PlatformAdminRoute` y mismo grupo del menú que el resto de Plataforma).

### 8.1 Pasos

1. **Organización, tipo y origen.** La organización se elige de la lista de
   organizaciones. Después el tipo de dato y el sistema de origen (§3.1), con la
   sucursal si es stock.
2. **Archivo o link.** Subir un `.csv`/`.xlsx`, o, solo para stock, pegar un link de Sheets. Se
   parsea y se escribe el staging (`STAGED`). La respuesta trae los
   encabezados, las primeras filas y el mapeo sugerido.
3. **Mapeo de columnas.** Una fila por columna del archivo, con el destino
   sugerido por sinónimos (§9.12, ampliado a los campos nuevos) y editable.
   Incluye "Ignorar columna", los campos personalizados de la organización
   (por etiqueta) y la elección de la columna de id del origen.
4. **Ajustes de formato.** Formato de fecha (`DD/MM/AAAA`, `MM/DD/AAAA`,
   `AAAA-MM-DD`; se propone el que mejor explica las primeras filas), separador
   decimal, moneda por defecto, qué cuenta como sí y no, separador del CSV,
   codificación y, para los campos de lista, el mapeo de valores ("Cliente" →
   `CUSTOMER`).
5. **Vista previa.** El análisis corre en segundo plano y la pantalla muestra
   el progreso. Al terminar: cuatro pestañas con contador (se crean, se
   actualizan, chocan, fallan) y la lista paginada de filas, cada una con su
   motivo. Las advertencias (vendedor desconocido, empresa inexistente) se
   ven sobre la fila sin bloquearla. Cambiar el mapeo o los ajustes vuelve a
   analizar sin volver a subir el archivo: el staging guarda las filas con sus
   encabezados originales (§9.8).
6. **Duplicados.** En la pestaña de choques, cada fila muestra el registro
   existente y, campo por campo, el valor del CRM y el del archivo. Hay una
   política general (por defecto "Completar lo vacío sin pisar") con
   alternativas "Pisar con lo del archivo" y "Omitir", que también se pueden
   elegir por fila.
7. **Confirmar.** Resumen de lo que va a pasar. Si es stock desde Sheets,
   aparece la casilla de sincronizar. Al confirmar, el lote pasa a `RUNNING` y
   la pantalla muestra el progreso. Se puede cerrar y volver: el lote figura en
   la lista de importaciones de la organización.
8. **Informe.** Creados, actualizados, sin cambios, omitidos y fallidos, con el
   motivo de cada falla. Hay tres descargas:
   - un CSV con las filas fallidas, con sus columnas originales y una columna
     "Motivo" agregada, listo para corregir y volver a subir;
   - un CSV con los cambios hechos (fila, registro, campo, antes y después);
   - las fotos fallidas, en el caso del stock.

   Desde el informe se puede deshacer el lote (§8.3).

**Celular.** Todo el asistente usa una columna en pantallas angostas. El mapeo
y la vista previa pasan de tabla a tarjetas por fila, la comparación de
duplicados apila "en el CRM" y "en el archivo", y se verifica con
`check-mobile-overflow.mjs` como el resto de las pantallas.

### 8.2 Duplicados: qué hace cada política

| Política | Campo vacío en el CRM | Campo con valor en el CRM |
|---|---|---|
| Completar lo vacío (por defecto) | se llena | se conserva y se anota el conflicto, como hoy (§4) |
| Pisar | se llena | se reemplaza, y queda en `changes` con el antes y el después |
| Omitir | no se toca nada | no se toca nada |

En las tres: una celda vacía nunca borra y los valores de campos
personalizados se fusionan por clave.

**"Pisar" es una excepción aprobada a §4** (decisión 4, anotada en §4 de
`docs/ingestion-architecture.md`). §4 dice "si ambos tienen valor y
difieren, se conserva el del CRM". Esa regla protege del flujo
**automático**: un formulario que llega solo no puede pisar lo que cargó una
persona. Acá pisar es una elección explícita del platform admin en la vista
previa, sobre filas que ve, y se guarda el antes y el después por fila en
`changes`. No es una sobrescritura en silencio.

**Dos cosas no se pisan nunca, ni con "Pisar":**

- **el email y el teléfono que ya identifican al contacto.** Si el contacto se
  encontró por email, su email no cambia. Si se encontró por teléfono, su
  teléfono no cambia. El otro dato sí se puede completar o pisar, con la
  regla de unicidad de siempre: un email o un teléfono que ya tiene otro
  contacto es un choque, no un cambio;
- **la etapa, que solo avanza.** Un `LEAD` pasa a `CUSTOMER` si el archivo lo
  dice. Un `CUSTOMER` no vuelve a `LEAD`. El orden es el del enum: `LEAD` <
  `MQL` < `SQL` < `CUSTOMER` < `CHURNED`. Cómo tratar `CHURNED` es la
  pregunta pendiente P2 de §13.

**La vista previa es un pronóstico, no un contrato.** Entre el análisis y la
promoción alguien puede editar un contacto o puede entrar un WhatsApp. La
promoción vuelve a calcular contra el estado real de ese momento. Si el
resultado difiere del plan (iba a crear y ya existe), aplica la política
elegida y lo anota en la fila.

### 8.3 Deshacer un lote

- **Lo creado** por el lote se da de baja con soft delete: los registros de
  `external_record_links` con `created_by_batch_id` igual al lote. Va en orden
  inverso de dependencias (historial, contactos, empresas) y por tandas, en el
  worker, con el lote en `UNDOING`. Los vínculos se borran, así que volver a
  importar crea de nuevo.
- **Lo actualizado no se revierte.** El informe y el CSV de cambios dicen qué
  campos cambió cada fila, con el antes y el después, para corregir a mano.
- **Lo que ya tuvo uso propio no se borra: se omite y se informa**
  (decisión 17). Pasa con un contacto creado por el lote que después recibió
  una conversación, una oportunidad o una actividad que no vino del lote, o
  que ya está unido a otro. Borrarlo se llevaría trabajo hecho en el CRM. Lo
  mismo con un vehículo con oportunidad, cotización o entrega, y con una
  empresa con contactos u oportunidades que no vinieron del lote.
- **Plazo:** no hay otro que la purga de 90 días. Se puede deshacer mientras
  existan las filas de staging del lote (§9.4).

**¿Guardar el antes y el después por fila?** Sí, pero solo de los campos que
cambiaron, en `ingestion_events.changes`. Es chico (casi siempre vacío con
"completar lo vacío") y es lo único que hace corregible un "pisar" equivocado.
Como son datos personales, el borrado a pedido
(`anonymizeIngestionEventsOfContact`) también tiene que redactar esa columna, y
eso entra con un test en el PR que la crea.

---

## 9. Seguridad y límites

### 9.1 Acceso

- Todas las rutas nuevas cuelgan de
  `/api/admin/organizations/:organizationId/imports…` y
  `/api/admin/organizations/:organizationId/import-syncs…`, con
  `authenticate`, `businessWriteRateLimiter` y `requirePlatformAdmin`. El
  `organizationId` sale del path validado como uuid, nunca de
  `req.auth.organizationId`, y se verifica que la organización exista.
- Cada `batchId`, `syncId` y `sourceId` se busca **con** ese
  `organizationId`. Un lote de otra organización da 404, y un test de
  integración lo fija para cada ruta.
- Un rate limit propio para subir y analizar, como el de la vista previa de hoy.

### 9.2 Tamaños y archivos hostiles

| Límite | Valor | Hoy |
|---|---|---|
| Archivo | 10 MB | 10 MB (se mantiene). |
| Filas por lote | 10.000 | 10.000 (se mantiene; pasarse es un 400, no un corte silencioso). |
| Columnas | 200 | Sin tope explícito. |
| Celda | 10.000 caracteres; más larga, la fila falla | Sin tope. |
| Fila en staging | 64 KB serializada | El webhook ya tiene 64 KB por payload. |
| XLSX descomprimido | 100 MB en total y 5.000 entradas en el zip | Riesgo aceptado y anotado en `spreadsheet.ts`. |

**Zip bomb.** `exceljs` carga el libro entero en memoria y el lector en
streaming está roto. Antes de entregarle el archivo, se lee el directorio
central del zip (el formato es simple: unas decenas de líneas sin dependencias)
y se rechaza si la suma de los tamaños descomprimidos declarados, la cantidad
de entradas o la proporción de compresión pasan los topes. **Riesgo residual,
dicho explícitamente:** los tamaños declarados pueden mentir. Un zip armado a
mano puede declarar poco y descomprimir mucho. Lo que lo acota es que el
archivo pesa a lo sumo 10 MB y que solo lo sube un platform admin. No es una
garantía.

**NUL y prototipo.** Se mantienen las dos defensas de hoy: el rechazo de `\0` y
las filas construidas con `defineProperty`.

### 9.3 Descargas externas: `fetchPublico`

Helper nuevo, sin dependencias, en `src/lib/`. Lo usan las fotos y el link de
Sheets:

- solo `http:` y `https:`, puertos 80 y 443, sin credenciales en la URL;
- resuelve el host con `dns.lookup` (todas las direcciones) y rechaza si
  **alguna** es privada, de loopback, link-local (incluye `169.254.169.254`),
  CGNAT, multicast, reservada, ULA de IPv6 o un IPv4 mapeado en IPv6 que caiga
  en esos rangos;
- **conecta a la IP ya validada**, con la opción `lookup` de
  `http.request`/`https.request`, así un DNS que cambia de respuesta entre la
  validación y la conexión (DNS rebinding) no la saltea. El SNI y el header
  `Host` siguen siendo el nombre original;
- redirecciones manuales, cada una validada como la primera;
- tope de bytes cortando el stream, timeout de conexión y total;
- sin cookies, sin headers de autenticación, con un `User-Agent` propio.

Un test unitario cubre la tabla de rangos y uno de integración con un servidor
local verifica que `localhost` y `127.0.0.1` se rechazan.

### 9.4 Fórmulas, retención y registro

**Fórmulas.** Lo importado se guarda tal cual, como hoy (decisión de
FABLE-I-06). Todo lo que se exporta pasa por `neutralizarCeldaParaExportar`:
el CSV de fallidas, el de cambios y el de fotos fallidas. Se neutraliza cada
celda, incluido el "Motivo" que agregamos nosotros, porque puede citar un valor
del archivo. Los CSV salen con separador `;` y en UTF-8 con BOM, para que
abran bien en Excel en español (decisión 18).

**Archivo original: no se guarda** (decisión 19). El staging tiene cada fila
con sus encabezados originales, y eso alcanza para reanalizar, reprocesar y
armar el CSV de fallidas. Guardar además el archivo sería una copia más de
datos personales sin un uso que el staging no cubra. Del archivo quedan el
nombre, el tamaño y el SHA-256 en `import_batches`.

**Staging.** Las filas `PROCESSED` se purgan a los 90 días con
`purge:ingestion-events`, como hoy (`docs/data-classification.md` §5.1). Con
ellas se va el detalle por fila del informe y la posibilidad de deshacer. Los
contadores del lote siguen en `import_batches`. Las filas `STAGED` de un lote
que nunca se confirmó se purgan a los 7 días y el lote pasa a `CANCELLED`, con
el mismo script. Las `FAILED` quedan como hoy: no se purgan. El documento de
clasificación se actualiza en el mismo PR.

**Registro.** `import_batches` registra quién importó, qué, cuándo, en qué
organización, cuántas filas y con qué resultado. Quién deshizo y cuándo. Para
la sincronización, quién la creó, y cada corrida es un lote. Las consultas de
la vista previa y del informe, que muestran datos personales, llaman a
`logAccesoADatosPersonales`, como `GET /api/imports/:batchId`.

---

## 10. Fases 2 y 3: el lector de origen

Para que un conector de CRM o una base entreguen filas al mismo mapeo, vista
previa, deduplicación e informe, el asistente no conoce archivos: conoce
**lectores de origen**.

```ts
interface LectorDeOrigen {
  // "file" | "google_sheets_link" | "hubspot" | ...
  readonly tipo: string;
  // Qué conjuntos de datos ofrece: hojas de un XLSX, pestañas de una
  // planilla, objetos de un CRM ("contacts", "companies").
  listarConjuntos(): Promise<ConjuntoDeOrigen[]>;
  // Las columnas de un conjunto, con el MISMO criterio de nombres que va a
  // usar leer() (§9.11): lo que se mapea es lo que después llega.
  encabezados(conjunto: string): Promise<string[]>;
  // Las filas, en tandas, como registros planos { encabezado: celda }. Si el
  // origen tiene un id propio, viene en idExterno y es la clave externa sugerida.
  leer(conjunto: string): AsyncIterable<FilaDeOrigen[]>;
}

interface FilaDeOrigen {
  numero: number;
  idExterno?: string;
  datos: Record<string, string | number | boolean | null>;
}
```

En la Fase 1 hay dos implementaciones: archivo (CSV y XLSX) y link de Sheets.
Todo lo que viene después de `leer()` es común: staging, mapeo, análisis,
promoción, vínculos, informe y deshacer.

**Fase 2: conectores a CRMs.** Un conector de HubSpot, Kommo o Pipedrive es
otro `LectorDeOrigen`. Sus "columnas" son las propiedades del objeto y su
`idExterno` es el id del CRM, que hace exacta la reimportación. Lo que cambia de
verdad es la credencial: un token OAuth del CRM del cliente, cifrado con el
mismo cifrador, por organización, de solo lectura cuando el CRM lo permite y
revocable desde la pantalla. Se diseña con el primer cliente concreto.

**Fase 3: bases SQL.** §7 sigue vigente y este documento no lo reabre:
conectarse a la base de un cliente es guardar credenciales de infraestructura
ajena. La alternativa que cubre el caso sin ese riesgo es pedirle al cliente
**una exportación a CSV por tabla** (contactos, empresas, notas, stock), con el
id de cada tabla incluido. Entra por el asistente de la Fase 1 como cualquier
archivo, y los ids de origen dan una reimportación exacta. Si después hace
falta algo continuo, la exportación programada del lado del cliente a una
planilla o a un endpoint de ingesta sigue siendo *push*, que es lo que §7
recomienda.

---

## 11. Plan de PRs de la Fase 1

Cada PR lleva sus tests: unitarios del parseo y el mapeo, integración contra el
Supabase local de staging, promoción, deduplicación, deshacer y sincronización,
según corresponda, y un archivo de ejemplo inventado por tipo en
`tests/fixtures/` (personas `@example.com`, teléfonos de rango ficticio,
patentes inventadas).

**Una sola migración, en el PR 1** (decisión 20). Ese PR queda abierto hasta que
Rocco autorice migrar desde la rama. Los PR que usan el esquema nuevo (3 en
adelante) se construyen encima de su rama y esperan a que se mergee. Los que no
lo usan (0 y 2) siguen su camino.

| # | PR | Migración | Qué prueba |
|---|---|---|---|
| 0 | **WebP en las fotos** de todos los caminos de subida (decisión 14). | No | Magic bytes de WebP. La subida a mano lo acepta. Un archivo que dice ser WebP y no lo es se rechaza. |
| 1 | **Esquema de toda la Fase 1** (§2.6): `import_batches`, `external_record_links`, `vehicle_photo_imports`, `import_syncs`, columnas nuevas de `ingestion_events` y `contacts`, `STAGED` y `UNAVAILABLE`. RLS, diagnóstico, slugs y aislamiento. | **Sí** | Aislamiento por organización de las tablas nuevas. `STAGED` no lo reclama el worker. Los lotes viejos de `POST /api/imports` siguen funcionando. |
| 2 | **Parseo ampliado.** Separador y codificación del CSV, elección de hoja, rechazo de XLS y ODS con su mensaje, topes de celda, columnas y fila, defensa contra zip bomb, e intérpretes de fecha, número, sí/no y valores de lista. | No | Unitarios con fixtures hostiles: CSV en Windows-1252 con `;`, BOM, XLSX con directorio central inflado, celda gigante. La vista previa vieja sigue devolviendo lo mismo que la importación (§9.11). |
| 3 | **Asistente backend para empresas y contactos.** Rutas de platform admin, staging `STAGED`, análisis en segundo plano, vista previa, decisiones por fila, confirmar, promotores de empresa y de contacto ampliado (campos nuevos, vínculos, políticas, `customerSince`, `importedAt`), informe y los dos CSV. | No | Re-subida sin duplicar (con id, con email, con teléfono). Las tres políticas. "Pisar" no toca el email ni el teléfono que identifican, y la etapa solo avanza. Campos personalizados por tipo, `MULTI_SELECT` incluido. Empresas que se crean o no. Vendedor y vehículo inexistentes advierten. Un lote de otra organización da 404. No se emiten eventos al outbox. CSV neutralizado, con `;` y BOM. El borrado a pedido redacta `changes`. |
| 4 | **Asistente frontend** (Plataforma → Importar datos) para empresas y contactos, celular incluido. | No | Vitest de los pasos y del mapeo sugerido. Chequeo de desborde móvil. |
| 5 | **Deshacer un lote.** | No | Deshace lo creado y no lo actualizado. Omite e informa lo que tuvo uso propio (unido, con conversación, con oportunidad, con actividad ajena). Reimportar después de deshacer crea de nuevo. |
| 6 | **Historial.** Promotor de actividades, autor elegido (por defecto el ADMIN más antiguo), "Autor original: …", fechas originales, tareas hechas y vencidas, bloqueo de orden con un lote de contactos corriendo. | No | Ligado por id de origen, por email y por teléfono. Sin contacto, falla. Re-subida sin duplicar por hash. |
| 7 | **Stock sin fotos.** Promotor de vehículos vía `vehicle.service.ts`, sucursal y condición del lote, precio por moneda, conversión a USD con la cotización vigente, estados permitidos, casilla de vendidas, `UNAVAILABLE` en el CRM y fuera del agente. Vehículo de interés por código del origen o patente. | No | Choque de patente y VIN. Sin cotización, falla. No escribe `RESERVED` ni `DELIVERED`. El agente no ofrece una `UNAVAILABLE`. Sincroniza la base de conocimiento. |
| 8 | **Fotos.** `fetchPublico` (SSRF), worker de fotos, topes por vehículo y por lote, links de Drive. | No | Rangos privados, rebinding, tope de bytes y de tiempo, tipo inválido. Una foto rota no tumba el vehículo. No se baja dos veces la misma URL. |
| 9 | **Google Sheets por link**, solo para stock y de lectura única: lector de origen, validación del link, detección de planilla no compartida. | No | Con un servidor local que imita la exportación: link inválido, HTML en vez de CSV, redirección a host no permitido, link para contactos rechazado. |
| 10 | **Sincronización.** `importSyncWorker` con lock en la base, pantalla de sincronizaciones, pausa manual y automática, unidades faltantes. | No | No pisa estados del CRM. No borra. Pausa a las 3 fallas. Una corrida tardía corre una vez. Dos workers no toman la misma sincronización. Un lock vencido se libera. |
| 11 | **Guía de alta** en `docs/`: cómo preparar el archivo, en qué orden importar y cómo leer el informe. Actualiza `data-classification.md` §5.1 si no lo hizo un PR anterior. | No | — |

---

## 12. Lo que queda afuera

- Oportunidades (decisión del 06/10/2026).
- XLS y ODS (decisión 2).
- OAuth de Google para Sheets, y Sheets para contactos e historial (decisión 3).
- Crear opciones de campos personalizados desde la importación (§5.2).
- Reintento masivo de filas fallidas: se corrige y se vuelve a subir el CSV de
  fallidas, que es el camino que el informe ofrece.
- Sincronizar algo que no sea stock desde Sheets.
- Hacer opcional el apellido: propuesto en §5.2, no se hace ahora.

---

## 13. Decisiones de la Fase 0

Respondidas por Rocco el 06/10/2026, sobre el PR #428.

| # | Tema | Decisión |
|---|---|---|
| 1 | Idempotencia | Por `external_record_links`. La importación actual queda igual. Excepción anotada en §4 y §9.14 de `ingestion-architecture.md`. |
| 2 | XLS y ODS | No se soportan: "Guardalo como .xlsx o .csv y volvé a subirlo". |
| 3 | Google Sheets | Por link, solo para stock. Contactos e historial, solo por archivo. OAuth con `drive.file` y el Picker, cuando un cliente lo pida. |
| 4 | "Pisar" | Elección explícita del platform admin, con el antes y el después por fila. Nunca se pisan el email y el teléfono que identifican al contacto, y la etapa solo avanza. Excepción anotada en §4. |
| 5 | Autor del historial | Se elige en el asistente; por defecto, el ADMIN más antiguo. El autor del origen va en el texto: "Autor original: …". |
| 6 | Fecha de alta original | Columna aparte, "Cliente desde" (`customerSince`), visible en la ficha. `createdAt` es la fecha de importación. Las métricas de contactos nuevos excluyen los importados (`importedAt`). |
| 7 | Tareas pasadas | Las hechas quedan completadas con su fecha original. Las no hechas y vencidas quedan abiertas y vencidas, asignadas al autor elegido. |
| 8 | Costo y precio mínimo en otra moneda | Se convierten a USD con la cotización vigente de la organización, que la vista previa muestra. Sin cotización, la fila falla con un motivo claro. |
| 9 | Código de stock del origen | Clave externa, visible en las notas internas. Seguimos con `STK-…`. |
| 10 | Empresas inexistentes | Se crean. La vista previa dice "Se crearán N empresas" y permite no crearlas. |
| 11 | Nombre completo | Se parte en el primer espacio. Con una sola palabra, el apellido es "-" y la fila lleva una advertencia. Hacer opcional el apellido queda propuesto, no se hace ahora. |
| 12 | Vendidas en el origen | Se omiten por defecto, con una casilla para importarlas como `SOLD`. |
| 13 | Topes de fotos | 20 por vehículo, 5 MB y 15 s por foto. Por lote, la propuesta de §6: 3.000 fotos y 1,5 GB. |
| 14 | WebP | Sí, en un PR aparte antes de la importación, para todos los caminos de subida. |
| 15 | Sincronización | La planilla manda sobre los campos mapeados. Lo que maneja el CRM nunca se pisa, y la pantalla lo avisa. |
| 16 | "No disponible" | `visibleInListing` no saca la unidad de las búsquedas del agente, así que se agrega `UNAVAILABLE` al enum. El agente solo ofrece `AVAILABLE`. |
| 17 | Deshacer | No se borra lo que ya tuvo uso propio: se omite y se informa. Sin otro plazo que la purga de 90 días. |
| 18 | CSV de salida | `;` y UTF-8 con BOM. |
| 19 | Archivo original | No se guarda; solo nombre, tamaño y hash. |
| 20 | Migraciones | Una sola, en el primer PR. |
| 21 | Selección múltiple | Incluida; #426 ya está en master. |
| 22 | Una sola instancia | Ver §7: lock de la sincronización en la base y sin estado en memoria. |

### Preguntas pendientes

No frenan los PR 0 a 5. Se responden antes del PR que las necesita.

- **P1 (PR 6). Fecha de las notas y llamadas.** `Activity` no tiene una fecha
  propia del hecho, solo `createdAt`. Si `createdAt` es la fecha de
  importación, como en los contactos, toda la historia importada aparece en la
  ficha el día del alta, en un solo bloque y sin su orden real. Propuesta:
  para el historial, `createdAt` = la fecha original. El argumento de la
  decisión 6 era no inflar "contactos nuevos", y una nota no entra en esa
  métrica. La alternativa es una columna `occurredAt` en `activities`, que
  igual entraría en la migración del PR 1.
- **P2 (PR 3). `CHURNED`.** El enum lo pone después de `CUSTOMER`, así que con
  "solo avanza" un `LEAD` podría pasar a `CHURNED`, y un `CHURNED` reactivado
  en el origen nunca volvería a `CUSTOMER`. ¿Se sigue el orden del enum tal
  cual, o `CHURNED` solo se escribe sobre `CUSTOMER` y `CHURNED → CUSTOMER` se
  permite?
- **P3 (PR 6). Tareas hechas: ¿confirmadas?** Una tarea completada que hizo un
  vendedor queda "pendiente de confirmar" para el ADMIN (§29). ¿Las importadas
  como hechas quedan también confirmadas, con el autor elegido como quien
  confirma, para no llenar esa cola con tareas de años anteriores?
