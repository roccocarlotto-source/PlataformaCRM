# Relevamiento — frontend para `Source` / `ApiKey` / importaciones

**Fecha:** 2026-08-27
**Base revisada:** `master` en `ce1f7af`
**Alcance:** investigación previa. No se escribió ni una línea de frontend, ni se
tomó ninguna decisión de UI.

Objetivo: mapear qué superficie de backend existe hoy para administrar la capa de
ingesta desde la UI, y cómo está armado el frontend para las entidades que sí
tienen pantalla, para que lo nuevo siga la convención existente.

---

## 1. Superficie de backend disponible

### 1.1 Endpoints, con archivo y línea

Todos montados bajo `/api` en `src/routes/index.ts:54-56` (`sourceRouter`,
`apiKeyRouter`, `importRouter`), **excepto** `POST /api/ingest`, que se monta
aparte en `src/app.ts:66`, antes del `express.json()` global.

#### `Source` — `src/routes/source.routes.ts`

| Método y ruta | Línea | Auth | Entrada | Respuesta |
|---|---|---|---|---|
| `GET /api/sources` | `:20` | `authenticate` + `authorize("ADMIN")` | query: `listQuerySchema` (`src/controllers/source.controller.ts:72`) — `page`, `pageSize` (máx 100), `search`, `type`, `isActive`, `sortBy` (`name`\|`createdAt`), `sortOrder` | `200` `{ data: Source[], pagination: { page, pageSize, total, totalPages } }` (`src/services/source.service.ts:29-45`) |
| `GET /api/sources/:id` | `:21` | ídem | `id` uuid | `200` `Source` · `404` si no existe, es de otra organización o está retirada |
| `POST /api/sources` | `:26` | ídem + `businessWriteRateLimiter` | `createSourceSchema` (`source.controller.ts:44`) — `name`, `type`, `isActive?`, `fieldMapping?` | `201` `Source` |
| `PATCH /api/sources/:id` | `:33` | ídem | `updateSourceSchema` (`source.controller.ts:60`) — `name?`, `isActive?`, `fieldMapping?` (nullable) | `200` `Source` |
| `DELETE /api/sources/:id` | `:40` | ídem | `id` uuid | `204` sin body |

**Forma de `Source` en la respuesta** — proyección explícita en
`src/repositories/source.repository.ts:32-41`:

```
id, organizationId, name, type, isActive, fieldMapping, createdAt, updatedAt
```

`deletedAt` **no se expone** (divergencia deliberada con los 8 módulos viejos, que
devuelven la fila cruda — documentado en ese mismo archivo, líneas 13-30).

Dos restricciones que la UI tiene que respetar:

- **`type` es inmutable.** No figura en `updateSourceSchema`
  (`source.controller.ts:60-70`): una fuente de webhook no se convierte en una de
  importación, se crea otra.
- **`fieldMapping` solo se acepta en `FILE_IMPORT`.** En el create lo valida el
  schema (`source.controller.ts:48-57`); en el PATCH lo valida el service, porque
  `type` no viaja en el body (`src/services/source.service.ts:100-105`). Mandar
  `fieldMapping: null` **limpia** el mapeo; omitirlo lo deja intacto
  (`source.controller.ts:66-68`).
- La forma de `fieldMapping` es un mapa plano `encabezado del archivo → campo de
  Contact`, con destinos restringidos a los 5 campos que la ingesta sabe escribir
  (`src/schemas/fieldMapping.schema.ts:38-84`; los destinos salen de
  `CAMPOS_DE_CONTACTO` en `src/schemas/ingestContact.schema.ts`). Máximo 50
  columnas, sin destinos repetidos.

#### `ApiKey` — `src/routes/apiKey.routes.ts`

| Método y ruta | Línea | Auth | Entrada | Respuesta |
|---|---|---|---|---|
| `GET /api/api-keys` | `:21` | `authenticate` + `authorize("ADMIN")` | query: `listQuerySchema` (`src/controllers/apiKey.controller.ts:14`) — `page`, `pageSize`, `sourceId`, `status` (`ACTIVE`\|`REVOKED`), `sortBy` (`createdAt`\|`lastUsedAt`), `sortOrder` | `200` `{ data: PublicApiKey[], pagination }` |
| `POST /api/api-keys` | `:22` | ídem + `businessWriteRateLimiter` | `{ sourceId }` uuid (`apiKey.controller.ts:10`) | **`201` `PublicApiKey & { key: string }`** — única respuesta del sistema con la clave en claro |
| `DELETE /api/api-keys/:id` | `:30` | ídem | `id` uuid | **`200` con la clave revocada en el body** (no `204`) · `409` si ya estaba revocada |

**Forma de `PublicApiKey`** — `src/repositories/apiKey.repository.ts:33-42`:

```
id, organizationId, sourceId, keyPrefix, lastUsedAt, revokedAt, createdAt, updatedAt
```

`keyHash` **nunca sale**: la proyección es explícita y todas las lecturas del
repositorio la usan (comentario en `apiKey.repository.ts:16-31`).

#### Importación de archivo — `src/routes/import.routes.ts`

| Método y ruta | Línea | Auth | Entrada | Respuesta |
|---|---|---|---|---|
| `POST /api/imports` | `:37` | `authenticate` + `businessWriteRateLimiter` + `authorize("ADMIN")` + `importUpload` | **`multipart/form-data`**: archivo en el campo `file`, más `sourceId` como campo de texto (`src/controllers/import.controller.ts:15`, `src/middlewares/importUpload.ts:29-40`) | `202` `ResultadoImportacion` |
| `GET /api/imports/:batchId` | `:46` | `authenticate` + `authorize("ADMIN")` | `batchId` uuid | `200` `ResumenDeLote` · `404` si no existe o es de otra organización |

`ResultadoImportacion` (`src/services/import.service.ts:28-45`):

```ts
{ batchId, encabezados: string[], filasLeidas, insertados, duplicados }
```

`ResumenDeLote` (`src/repositories/ingestionEvent.repository.ts:383-392`):

```ts
{ batchId, total, pendientes, promovidos, fallidos,
  fallas: { id, errorMessage, rawPayload }[], fallasOmitidas }
```

Límites que la UI tiene que mostrar, no esconder:

- Archivo: 10 MB (`src/utils/spreadsheet.ts:IMPORT_MAX_FILE_BYTES`), 10.000 filas
  (`MAX_FILAS_POR_ARCHIVO`), solo `.csv` y `.xlsx` (`formatoDesdeNombre`, 415 si no).
- Solo una `Source` de tipo `FILE_IMPORT` y activa acepta importaciones
  (`src/services/import.service.ts:60-72`, `400` en los dos casos).
- `fallas` está **topeada en 100** (`MAX_FALLAS_DEVUELTAS`,
  `ingestionEvent.repository.ts:397`), y `fallasOmitidas` dice cuántas quedaron
  afuera. Nunca se trunca en silencio, pero **no hay paginación de fallas**.

#### `POST /api/ingest` — no es para el frontend

`src/routes/ingest.routes.ts:39`, montado en `src/app.ts:66`. Pasa por
`authenticateApiKey` (`src/middlewares/authenticateApiKey.ts:29`), **no** por
`authenticate`. Su contexto es `IngestContext` (`src/types/ingest.ts:37`), un tipo
**deliberadamente disjunto** de `AuthContext`: no tiene `userId` ni `role`.

Es el endpoint que consume la landing page del cliente con su API key. El frontend
del CRM no debería llamarlo nunca — y no podría, porque tendría que llevar la clave
en claro en el browser, que es exactamente lo que el diseño evita (ver el
comentario de CORS en `src/app.ts:19-30`).

### 1.2 Respuestas a las preguntas puntuales

**¿Hay endpoint para listar/paginar `IngestionEvent` con su estado?**
**No.** Verificado por grep sobre `src/controllers/` y `src/routes/`: las únicas
menciones a `ingestionEvent` en esas carpetas están dentro de archivos
`*.integration-test.ts`, que usan Prisma directo como helper de test. Ningún
controller lo expone.

Lo único que sale por HTTP son los **contadores agregados de UN lote**
(`GET /api/imports/:batchId`), y solo si conocés su `batchId`. No hay:

- listado de eventos, ni paginado ni sin paginar;
- filtro por `Source`;
- listado de lotes de una `Source` (no existe `GET /api/imports` a secas);
- forma alguna de ver los eventos que entraron **por webhook** — esos no tienen
  `batchId` (`batchId` queda en `null` para siempre, ver el comentario del campo en
  `prisma/schema.prisma`), así que ninguna consulta existente los alcanza.

**¿Se puede ver el motivo de un fallo?**
Sí, pero solo para filas de importación de archivo, y solo por lote:
`ResumenDeLote.fallas[].errorMessage` trae el mensaje real, y `rawPayload` la fila
original con sus encabezados. Los dos tipos de error llegan por ahí:

- error de mapeo — `traducirConMapeo` en `src/services/promotion.service.ts` (p. ej.
  *"ninguna columna del fieldMapping existe en esta fila…"*);
- error de validación de schema — `ingestContactSchema.safeParse` en el mismo
  archivo, con los issues de zod concatenados.

Para un evento de webhook fallido **no hay ningún camino de lectura**.

**¿La `ApiKey` en claro se ve una sola vez?**
**Confirmado leyendo el código, no asumido.** `generateApiKey()`
(`src/utils/apiKey.ts`) devuelve `{ key, keyPrefix, keyHash }`; el service persiste
solo `keyHash` y `keyPrefix`, y agrega `key` al objeto de respuesta
(`src/services/apiKey.service.ts:103`, tipo `CreatedApiKey` en `:61`). El
repositorio nunca ve la clave en claro, y `API_KEY_PUBLIC_SELECT`
(`apiKey.repository.ts:33-42`) no incluye `keyHash`, así que ninguna lectura
posterior puede reconstruirla.

Lo que sí queda consultable siempre es `keyPrefix` — 12 caracteres
(`API_KEY_PREFIX_LENGTH` en `src/utils/apiKey.ts`), pensado explícitamente para que
la UI pueda identificar **cuál** de varias claves se está por revocar.

**¿Existe importación manual?**
Sí: `POST /api/imports`, descripto arriba. Es la segunda vía de entrada, con
persona autenticada del otro lado — no usa API key en ningún momento
(`src/routes/import.routes.ts:12-22`).

**¿Hay tests de integración que sirvan como especificación de contrato?**
Sí, y son la mejor fuente de request/response reales:

| Archivo | Líneas | Qué fija |
|---|---|---|
| `src/controllers/apiKey.controller.integration-test.ts` | 454 | 201 con la clave en claro exactamente una vez y sin `keyHash`; la clave no reaparece en ninguna respuesta posterior; proyección pública del listado; 403 para `USER`; aislamiento entre organizaciones; revocar dos veces → `409` |
| `src/controllers/import.controller.integration-test.ts` | 796 | multipart real, CSV y XLSX; `PATCH` de `fieldMapping`; 404/400/413/415 de la subida; `GET /imports/:batchId` antes y después de drenar; 403 para `USER` |
| `src/controllers/ingest.controller.integration-test.ts` | 781 | contrato del webhook (no aplica al frontend, pero fija la forma de `IngestionEvent`) |
| `src/services/promotion.service.integration-test.ts` | 574 | política de merge, notas de promoción, transiciones de estado |

---

## 2. Convención de frontend existente

### 2.1 Anatomía de un feature slice

Referencia elegida: **`Contact`** para la capa de datos (es la que pediste y es
representativa: los 8 módulos usan exactamente la misma estructura).

```
frontend/src/features/contact/
  types.ts        — tipos reconstruidos del contrato REAL del backend
  api.ts          — funciones sueltas sobre request(), una por endpoint
  queries.ts      — key factory + hooks useQuery
  mutations.ts    — hooks useMutation con invalidación selectiva
  ContactListPage.tsx
  ContactFormPage.tsx
  *.test.ts(x)    — colocados, uno por archivo
```

**`types.ts`** (`frontend/src/features/contact/types.ts:1-3`) abre con un comentario
que fija la regla del proyecto: *"Reconstruido desde el contrato real del backend
… No se agrega ningún campo que el backend no devuelva o no acepte."* Los tipos
distinguen `Contact` (respuesta), `ContactListResponse` (`{ data, pagination }`),
`ContactListQuery` (filtros), `CreateContactInput` y `UpdateContactInput = Partial<…>`.

Hay precedente explícito de tipar contra el **contrato HTTP real** y no contra el
tipo interno del backend cuando difieren (`types.ts:60-70`, sobre `null` vs
`undefined` en el PATCH).

**`api.ts`** — funciones planas, sin clase ni cliente propio. Cada una:

```ts
export function listContacts(query, signal?) {
  return request<ContactListResponse>(`/contacts${buildListQueryString(query)}`, {
    getAccessToken, signal,
  });
}
```

El query string se arma con un `buildListQueryString` local que **omite los
parámetros vacíos** (`api.ts:15-26`). `organizationId` nunca viaja: se resuelve
server-side desde el JWT.

**`lib/api.ts`** es el único wrapper sobre `fetch`:

- `buildUrl` prefija `/api` en un solo lugar (`lib/api.ts:47-49`) — no lo hace cada
  call site.
- `ApiError` con `.status` y el mensaje extraído de `{ error: { message } }`
  (`:3-10`, `:63-79`).
- Un `401` dispara el `unauthorizedHandler` global registrado por `AuthContext`
  (`:26-33`, `:104-113`).
- `204` devuelve `undefined` (`:115-117`).
- **El body siempre se serializa como JSON** (`:88`, `:97`) y se fuerza
  `Content-Type: application/json` (`:86`). Ver brecha **G-6**.

**`queries.ts`** — key factory jerárquica, idéntica en todos los módulos:

```ts
export const contactKeys = {
  all: ["contacts"] as const,
  lists: () => [...contactKeys.all, "list"] as const,
  list: (query) => [...contactKeys.lists(), query] as const,
  details: () => [...contactKeys.all, "detail"] as const,
  detail: (id) => [...contactKeys.details(), id] as const,
};
```

Sin namespacing por `organizationId`: la higiene entre identidades la da
`queryClient.clear()` en la frontera de `AuthContext` (`queries.ts:6-8`).

**`mutations.ts`** — invalidación mínima y explícita, nunca `clear()` global:
`create` invalida `lists()`; `update` invalida `lists()` **y** `detail(id)`.

### 2.2 Formularios

Un **único componente para crear y editar**, distinguiendo el modo por el param de
ruta `:id` (`ContactFormPage.tsx:73-75`). Tres piezas fijas:

- `interface XFormValues` + `EMPTY_FORM` con strings vacíos, nunca `undefined`;
- `toInput(values)` — convierte `""` a `undefined` antes de mandar
  (`ContactFormPage.tsx:36-50`);
- `toFormValues(data)` — función **pura** que deriva del registro persistido
  (`:53-71`).

El estado usa **`useFormDraft`** (`frontend/src/lib/useFormDraft.ts`), no un
`useState` + `useEffect`. El comentario del archivo (líneas 1-30) documenta que el
patrón anterior **perdía datos**: con `refetchOnWindowFocus: true`, volver a la
pestaña disparaba un refetch y el efecto pisaba lo tipeado. Cualquier formulario
nuevo tiene que usar este hook.

### 2.3 Componentes y design system

**Existe** un design system mínimo en `frontend/src/design-system/`: `Button`
(3 variantes), `Table` (solo wrapper con scroll horizontal), `FormField`,
`EmptyState`, `ErrorState` (con `role="alert"`), `LoadingState`, `Pagination`, más
`tokens.css` y `design-system.css`.

**Pero está adoptado en un solo módulo.** Verificado por grep:

| Componente | Quién lo importa |
|---|---|
| `Button` | `CompanyFormPage`, `CompanyListPage`, `AppLayout` |
| `Table`, `EmptyState`, `Pagination` | `CompanyListPage` |
| `FormField` | `CompanyFormPage` |
| `ErrorState`, `LoadingState` | `CompanyFormPage`, `CompanyListPage`, `AppLayout` |

Los otros **siete** módulos —`Contact` incluido— siguen con HTML crudo:
`<table>`, `<button>`, `<p role="alert">`, y el bloque de paginación
copiado-pegado (`ContactListPage.tsx:150-236`).

O sea: hay **dos convenciones vivas a la vez**, `Company` (nueva) y el resto
(vieja). Esto no lo decido acá — ver pregunta abierta **Q-1**.

**Lo que NO existe** (verificado por grep, sin resultados fuera de tests):

- ningún modal ni `<dialog>`;
- ningún sistema de toasts o notificaciones;
- ningún uso de `navigator.clipboard`;
- ningún `<input type="file">`, `FormData` ni manejo de multipart.

La confirmación destructiva se hace hoy con **`window.confirm`**
(`ContactListPage.tsx:64-67`).

### 2.4 Acciones "sensibles que se muestran una sola vez"

**No hay precedente.** Grepeé `clipboard`, `copiar`, `secret`, `api-key` y "una sola
vez" en todo `frontend/src`: las únicas coincidencias son comentarios sobre
registrar handlers una sola vez (`AuthContext.tsx:80`, `:103`) y sobre evaluar un
flujo una sola vez (`AcceptInvitationPage.tsx:72`). Ninguna tiene que ver con
mostrar un secreto.

El caso más cercano en espíritu es `AcceptInvitationPage`, que maneja una sesión de
recuperación que llega por URL — pero no muestra ningún valor al usuario.

La UI de `ApiKey` va a ser **la primera vez** que el frontend muestra un secreto
irrecuperable. No hay patrón que copiar.

### 2.5 Routing y navegación

`frontend/src/app/router.tsx`: rutas planas bajo `ProtectedRoute` → `AppLayout`.
Las de escritura y las ADMIN-only van dentro de un único `<AdminRoute />`
(`router.tsx:74-101`).

Precedente exacto y aplicable: **`/users` e `/invitations`** están dentro del
`AdminRoute` porque en esos módulos **también la lectura es ADMIN-only**
(comentario en `router.tsx:75-84`). `Source`, `ApiKey` e `imports` están en la
misma situación: las cinco rutas de `sourceRouter` y las tres de `apiKeyRouter`
llevan `authorize("ADMIN")`, lectura incluida.

La navegación es un **header horizontal**, no un menú lateral
(`frontend/src/layout/AppLayout.tsx:47-64`). Los links ADMIN-only ya se gatean con
`isAdmin` (`AppLayout.tsx:22`, `:57-62`), que es exactamente donde entrarían los
nuevos.

### 2.6 Tests de frontend

Vitest + Testing Library + **MSW v2**. Los handlers se componen por test con
`server.use(...)` en vez de tener defaults globales
(`frontend/src/test/msw/handlers.ts:13-16`). Hay un archivo de fixtures por entidad
en `frontend/src/test/` (`contactFixtures.ts`, `invitationFixtures.ts`, …) — lo
nuevo debería sumar los suyos.

---

## 3. Brechas de backend detectadas

### G-1 · No existe ningún endpoint para listar `IngestionEvent` — bloqueante

Es la brecha central. La tarea pide "ver el estado de los `IngestionEvent`
(pendientes, procesados, fallidos)" y **hoy eso no se puede pedir por HTTP**. Haría
falta algo tipo `GET /api/ingestion-events` con paginación y filtros por `sourceId`,
`status`, rango de fechas y `batchId`.

El repositorio ya tiene las piezas de lectura (`getResumenDeLote` en
`ingestionEvent.repository.ts:399`) y el índice `(organizationId, sourceId,
createdAt)` que una consulta así usaría, pero no hay service ni controller ni ruta.

### G-2 · Los eventos de webhook son invisibles por completo

Derivada de G-1 pero peor: un evento de webhook tiene `batchId = null`, así que ni
siquiera el camino indirecto de `GET /api/imports/:batchId` los alcanza. Hoy la
única forma de saber si el webhook de una landing page está fallando es mirar la
tabla en la base.

### G-3 · No hay listado de lotes

No existe `GET /api/imports` (sin `:batchId`). El `batchId` se devuelve una sola
vez, en el `202` del `POST`. Si el ADMIN cierra la pestaña, **no hay forma de
recuperar el identificador de su propia importación**, y por lo tanto tampoco su
resultado.

### G-4 · `duplicados` solo existe en la respuesta del `POST`

`ResumenDeLote` no tiene campo de duplicados, porque las filas duplicadas quedan
asociadas al lote que las trajo primero, no al nuevo
(`src/services/import.service.ts:36-45`, documentado como §9.9 de
`docs/ingestion-architecture.md`). Consecuencia concreta para la UI: si se recarga
la pantalla de resultado, ese número desaparece; y **re-subir un archivo idéntico da
`404` en el `GET`**, no un resumen en cero.

### G-5 · Las fallas de un lote no se pueden paginar

`fallas` viene topeada en 100 y `fallasOmitidas` dice cuántas faltan, pero no hay
`offset`/`cursor` para traer las siguientes. Un archivo de 5.000 filas mal mapeado
muestra 100 y "4.900 omitidas", sin camino para verlas.

### G-6 · `lib/api.ts` no soporta multipart — brecha del lado del frontend

`request()` fuerza `Content-Type: application/json` y hace `JSON.stringify(body)`
(`frontend/src/lib/api.ts:86`, `:97`). Mandar un `FormData` por ahí lo rompería.
`POST /api/imports` es multipart, así que hace falta extender el wrapper (o agregar
una función hermana) — es el primer endpoint del proyecto que no es JSON.

Lo anoto acá aunque sea frontend porque condiciona el diseño y no es evidente.

### G-7 · No hay forma de reprocesar un evento fallido

Un `IngestionEvent` en `FAILED` es terminal: el worker solo reclama `PENDING`
(`claimNextPendingEvent`, `ingestionEvent.repository.ts:177`). El documento promete
que se puede "corregir un mapeo y volver a correrlo" (§1 de
`docs/ingestion-architecture.md`) y el diseño lo permite —el `rawPayload` está
intacto—, pero **no existe el endpoint** que devuelva un evento a `PENDING`. Una UI
que muestre fallos va a invitar naturalmente a "reintentar", y hoy no hay a qué
llamar.

### G-8 · `DELETE /api/api-keys/:id` no sigue la convención de los otros DELETE

Devuelve `200` con la clave revocada en el body y **no es idempotente** (`409` la
segunda vez), a diferencia del resto del proyecto que responde `204`
(`src/controllers/apiKey.controller.ts:44-54`). Está decidido y argumentado, pero la
UI tiene que tratarlo distinto: hay body que leer y un `409` esperable.

### G-9 · El listado de `ApiKey` trae `sourceId`, no el nombre de la fuente

`API_KEY_PUBLIC_SELECT` no incluye la relación. Para mostrar "clave de *Landing de
precios*" hay que resolver los nombres del lado del cliente. Hay precedente exacto
de ese patrón (`useCompaniesByIds` en
`frontend/src/features/contact/companyResolution.ts`, usado por
`ContactListPage.tsx:49`), así que es trabajo conocido — pero es trabajo.

### G-10 · `Source` no expone ningún contador

Ni cantidad de claves activas, ni eventos ingeridos, ni fecha del último evento.
Una pantalla de fuentes que quiera mostrar "3 claves · 1.240 eventos · último hace
2 h" necesita `N+1` requests o campos nuevos en la respuesta.

### G-11 · `IngestionStatus.DUPLICATE` está declarado pero nunca se escribe

El enum lo declara (`prisma/schema.prisma:67`) pero **ningún código lo asigna**:
verificado por grep sobre `src/`, las únicas apariciones son el enum y un comentario.
Los duplicados no crean fila (`ON CONFLICT DO NOTHING`), así que ese estado no
existe en los datos. Un filtro de estado en la UI que ofrezca las cuatro opciones
tendría una que nunca devuelve nada.

---

## 4. Preguntas abiertas

**Q-1 · ¿Qué convención visual sigue lo nuevo?** Hay dos vivas: el design system
(solo `Company`) y el HTML crudo (los otros siete módulos). Las pantallas de
ingesta pueden estrenar el design system —y ser el segundo módulo en adoptarlo— o
copiar el patrón mayoritario. Es una decisión de diseño y de deuda técnica, no algo
que se pueda leer del código.

**Q-2 · ¿La UI de eventos entra en este alcance?** Depende enteramente de si se
construyen G-1 y G-2 (endpoints nuevos de backend). Si el alcance es solo
`Source` + `ApiKey` + subir un archivo y ver el resultado de *ese* lote, alcanza con
lo que ya existe. Ver "el estado de los `IngestionEvent`" en general, no.

**Q-3 · ¿`Source` necesita pantalla de detalle o alcanza con lista + formulario?**
El backend tiene `GET /api/sources/:id`, pero los 8 módulos existentes usan el
patrón lista + formulario sin vista de detalle. Una fuente tiene más cosas colgando
(claves, lotes, eventos) que una `Company`, así que puede justificar una pantalla de
detalle — pero sería el primer módulo con esa forma.

**Q-4 · ¿Dónde vive `fieldMapping` en la UI?** Es un mapa de longitud variable
(hasta 50 pares) que hoy no tiene ningún control visual precedente en el proyecto —
todos los formularios existentes son campos fijos. Es la parte de mayor
incertidumbre de diseño de todo el conjunto.

**Q-5 · ¿Se muestra `keyPrefix` como identificador en la UI?** El backend lo expone
justamente para eso (`src/utils/apiKey.ts`, comentario de
`API_KEY_PREFIX_LENGTH`), pero expone 48 bits del secreto por diseño. No es un
problema —está razonado en ese archivo— pero conviene que sea una decisión
consciente y no un efecto de que el campo esté disponible.
