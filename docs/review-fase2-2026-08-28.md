# Reviews del Toolkit — Fase 2 de la capa de ingesta (PRs #18 a #23)

**Fecha:** 2026-08-28
**Manifest ID:** `RM-2026-08-28-FASE2`
**Alcance revisado:** estado de `master` en `aff9f11` — deliverable completo de la
Fase 2 de la capa de ingesta: los tres endpoints agregados después de los ítems
1 a 5 y las cuatro pantallas de frontend. Revisado **desde cero**, sin heredar
ningún resultado de la ronda del 2026-08-27.
**Reviews conducidos:** `RV-ENG`, `RV-SECURITY`, `RV-STANDARDS`.

> Este archivo es el registro completo de los tres reviews, con la misma
> estructura que `docs/review-ingesta-2026-08-27.md`. Se escribe en el repo
> porque la convención propia del Toolkit
> (`reviews/archive/{engagement}/cycle-{N}/`) vive dentro de la instalación del
> Toolkit, que es otro repositorio, y porque `state/` sigue sin existir en este
> proyecto.

**Relación con la ronda anterior.** `RM-2026-08-27-INGESTA-1-5` cubrió los ítems
1 a 5 del orden de construcción de `docs/ingestion-architecture.md` §6. Este es
un **manifest nuevo**, no una continuación: los hallazgos de aquella ronda no se
dan por buenos ni por cerrados, y los tres que su Q-2 propuso para "ciclo corto"
(E-1, S-2, S-3) se verificaron de cero contra el código actual — ver §2.4. Los
identificadores de este ciclo llevan prefijo `E2-`, `S2-` y `D2-` para que no se
confundan con los de aquel.

**Commits del deliverable revisado.** Identificados contra el historial real de
`master`, no copiados del enunciado: cada merge se resolvió con
`git log $merge^1..$merge^2`.

| PR | Merge | Commits | Qué trajo |
|---|---|---|---|
| #18 | `fc286c6` | `13aa596`, `e8c4748` | Backend: `GET /api/ingestion-events`, `POST /api/ingestion-events/:id/retry` |
| #19 | `6e8f803` | `ad22409`, `bad5e37` | Frontend: `Source` — listado, formulario, `FieldMappingEditor` |
| #20 | `4cbace5` | `4bb3c9a`, `3e1d717` | Frontend: `ApiKey` — listado, creación con secreto de una sola vez, revocación, primer `Modal` |
| #21 | `d34aa31` | `26249b7` | Backend: `POST /api/imports/preview` |
| #22 | `106ae21` | `defdc6b`, `52da007` | Frontend: sugerencia de mapeo desde archivo, pantalla de subida, `uploadFile()` |
| #23 | `0118a59` | `ed0b1a7` | Frontend: listado y reintento de eventos de ingesta |

Los diez commits son del 2026-08-27. `git diff --stat ce1f7af 0118a59` da **62
archivos, 7.157 líneas agregadas, 4 borradas**.

`aff9f11` (merge de PR #24) es posterior al deliverable y toca **solo**
`docs/ingestion-architecture.md` y `docs/project-overview.md`; no cambia ninguna
línea de código, así que revisar contra `aff9f11` y contra `0118a59` es lo mismo
para todo lo que sigue.

---

## 1. Activación del Toolkit

```
Claude-Toolkit-V1.1 — Active

Runtime      initialized
Systems      8 operational systems
Providers    2 knowledge provider(s) active
Project      no prior context

! el contenido del proveedor gstack está vencido — last-verified 2026-07-07, SLA mensual
! el contenido del proveedor ui-ux-pro-max está vencido — last-verified 2026-07-16, SLA mensual
```

Paso 1 — los 7 componentes requeridos y los 4 esperados verificados como
presentes y legibles. Paso 2 — ROM, Capability Router y Knowledge Sources
internalizados. Paso 3 — las 8 especificaciones de Operational System presentes,
ninguna `UNAVAILABLE`. Paso 4 — dos proveedores `active: true`, los dos con
`freshness-sla: monthly` vencido contra la fecha de hoy. Paso 5 — `state/` no
existe en el proyecto: sin estado de engagement previo, coherente con que ni M1
a M7 ni la ronda del 27 se archivaron.

Los dos warnings son de frescura de proveedores externos (Rank 6) y no bloquean.
Ninguno de los dos se usó como fuente de autoridad acá: la autoridad aplicada fue
Rank 1 a 4 (ROM y protocolos del Toolkit, estándares bindeados,
`docs/ingestion-architecture.md` y `docs/project-overview.md`, y el código real).

---

## 2. Project Brief y Routing Manifest (condensados)

| Campo | Valor |
|---|---|
| Engagement | New (sin estado previo; no continúa `RM-2026-08-27-INGESTA-1-5`) |
| Orientation Confidence | Complete |
| Manifest ID | `RM-2026-08-28-FASE2` |
| Dominio primario | Software Engineering |
| Disciplina de apoyo | Product Design (cuatro pantallas) — no es Owner, ver §2.2 |
| Problem Type | Evaluation |
| Complejidad | Complex |
| Ambiguity Flag | Clear |
| Owner System | `OS-SW-ENG` |
| Specialist Perspectives | Security, Performance, **Data Privacy** (Accessibility evaluada y **no** activada — §2.3) |
| Estándares vinculados | STD-SW-001 SOLID (Mandatory por complejidad Complex) · STD-SW-002 OWASP (Mandatory) · STD-SW-003 Testing (Mandatory) · STD-SW-004 Code Review (Mandatory) · **STD-LEG-002 Data Privacy (Mandatory)** · STD-LEG-001 GDPR (Conditional — condición sigue sin verificar, ver Q-1) · STD-DES-001 WCAG 2.2 AA (**no bindeado** — §2.3) · STD-GEN-001/002 (Advisory) |
| Secuencia de reviews | RV-ENG → RV-SECURITY → RV-STANDARDS |

### 2.1 Por qué Data Privacy sigue activa, y por qué ahora pesa más

La razón original se mantiene entera: toda la capa existe para recibir datos
personales de leads y guardar una segunda copia cruda en
`IngestionEvent.rawPayload`.

La Fase 2 agrega una razón nueva y de otra naturaleza: **es la primera vez que
esos datos salen del servidor hacia el navegador de una persona.**
`IngestionEventListPage` renderiza `errorMessage` y el link a
`promotedContactId` fila por fila, e `ImportPage` consume
`GET /api/imports/:batchId`. Hasta el 27, STD-LEG-002 se evaluaba sobre datos que
solo existían en Postgres y en los logs del servidor; desde el 27 a la noche hay
un tercer lugar donde viven. Eso cambia qué hay que verificar, no solo cuánto —
ver D2-2, D2-5 y la verificación afirmativa de §5.3.

### 2.2 Product Design es disciplina de apoyo, no Owner

Cuatro de los seis PRs son de frontend, así que la pregunta de si el Owner debía
ser `OS-PROD-DESIGN` es real y se contestó, no se salteó. Owner sigue siendo
`OS-SW-ENG`: el deliverable son componentes React, hooks de TanStack Query,
clientes HTTP y rutas — código, no artefactos de diseño (flujos, wireframes,
especificación de un design system). Las entry conditions de `OS-PROD-DESIGN`
piden lo segundo.

Consecuencia sobre la secuencia de reviews: la *Default Review Sequence* de
`OS-SW-ENG` en `registry/operational-systems.md` es literalmente
`Engineering Review → Security Review (if Security perspective active) →
Standards Review`. Los tres reviews pedidos **son** la secuencia por defecto de
este Owner. No hay ninguna review omitida que requiera waiver registrado bajo el
Principio Constitucional 4.

### 2.3 Accessibility: evaluada como perspectiva y no activada

Esta es la decisión de routing de este ciclo que más conviene revisar, y se deja
explícita en vez de resolverla en silencio (Principio Constitucional 3).

**A favor de activarla.** La Fase 2 estrena tres patrones que son puntos de
riesgo clásicos de accesibilidad y que el proyecto no tenía antes: el primer
`Modal` (`design-system/Modal.tsx`), el primer editor de filas dinámicas
(`FieldMappingEditor`) y los primeros `<input type="file">`. El Router activa una
perspectiva cuando su preocupación *está implícitamente en riesgo*, y acá lo
está.

**En contra, y es lo que decide.** El disparador que el propio STD-DES-001
declara es *"cuando el trabajo produce interfaces de usuario para audiencias
públicas"*. Las cuatro pantallas viven dentro de `AdminRoute`, detrás de
`ProtectedRoute`, y sus seis endpoints son ADMIN-only con lectura incluida: no
hay audiencia pública. Activarla bindearía WCAG 2.2 AA como Mandatory, y su
propio criterio de cumplimiento —*"falla cuando se viola cualquier criterio de
nivel A o AA"*, con las violaciones clasificadas Critical o High— convertiría
este ciclo en una auditoría de conformidad completa sobre las cuatro pantallas
**y sobre todo el design system preexistente que reusan**. Eso es otro
engagement, no un matiz de este.

**Decisión:** Accessibility **no** se activa; STD-DES-001 **no** se bindea. Las
observaciones de accesibilidad que aparecieron igual mientras se leía el código
se anotan en Q-3, fuera de gate, para que no se pierdan y para que Rocco decida
si quieren un ciclo propio.

### 2.4 Verificación de cero de E-1, S-2 y S-3

El enunciado pide explícitamente no dar por buenos los tres hallazgos que la
ronda anterior mandó a "ciclo corto" solo porque el reporte de PR #24 diga que se
corrigieron. Se verificaron contra el código actual, uno por uno.

| Hallazgo anterior | Qué había que confirmar | Verificación | Resultado |
|---|---|---|---|
| **E-1** | Que `promotion.service.ts` valide el `count` del CAS | `exigirTransicion(count, evento, destino)` existe (`promotion.service.ts:271`) y se invoca en los **tres** call sites que descartaban el `count`: líneas 294 y 309 (`markEventFailed`) y 351 (`markEventProcessed`). Lanza `Error` pelado, no `AppError`, con la razón escrita | **Cerrado de verdad** |
| **S-2** | Que la dependencia `ip-address` esté resuelta o mitigada | `npm ls ip-address` → `express-rate-limit@8.5.2 → ip-address@10.5.0` (era 10.2.0). `npm audit --omit=dev` en el backend: **0 vulnerabilidades high**, quedan 2 moderate, las dos del mismo advisory de `uuid` vía exceljs (S-1) | **Cerrado de verdad** |
| **S-3** | Que el gate de `npm audit` siga en `ci.yml` | Step *"Auditoría de dependencias (bloquea high/critical sin excepción)"* en `.github/workflows/ci.yml:87-90`, con `scripts/audit-gate.ts` decidiendo por GHSA ID y no por severidad, con la excepción de S-1 documentada y con su hallazgo referenciado | **Cerrado de verdad** — pero **solo para el backend**, ver S2-1 |

**Ninguno de los tres resultó estar abierto.** El único matiz es de alcance, no
de veracidad: el gate de S-3 vive en el job `backend` de `ci.yml` y no cubre el
workspace `frontend/`, que la Fase 2 volvió sustancial. Eso no reabre S-3 — el
gate hace lo que su hallazgo pedía — sino que es un hallazgo **nuevo** de este
ciclo (S2-1), porque la superficie que no cubre es la que este deliverable
agregó.

---

## 3. RV-ENG — Engineering Review

```
Report ID:  RR-ENG-2026-08-28-01     Manifest: RM-2026-08-28-FASE2
Outcome:    CONDITIONAL PASS
```

### 3.1 Criterios de aceptación

| Criterio | Evaluación | Evidencia |
|---|---|---|
| Código internamente consistente, produce lo declarado | **PARTIALLY MET** | `typecheck` limpio en los dos workspaces; 115 tests unitarios de backend y 604 de frontend en verde; lint y prettier limpios. La paginación del listado nuevo no es estable sobre empates de `created_at` — **E2-1** |
| Sin vulnerabilidades Critical/High introducidas | **MET** | Ver RV-SECURITY: ninguna Critical; el único aviso HIGH es de dependencia, verificado no alcanzable, con arreglo no disruptivo |
| Cobertura de tests en caminos críticos | **MET** | El frontend pasa de 466 a 600 casos (14 archivos de test nuevos, +134 casos, contados con `git show` en las dos revisiones); 22 tests de integración nuevos para `/api/ingestion-events` y 6 para `/imports/preview`, incluidos aislamiento cross-organización, 401/403/404/409/400 y el ciclo completo retry → worker → contacto promovido |
| Estándares de ingeniería satisfechos | **MET** | Ver RV-STANDARDS (STD-SW-001/003/004) |
| Riesgos de performance documentados | **PARTIALLY MET** | El backend documenta cada índice y el porqué del único `sortBy`. En el frontend, la resolución de nombres de fuente dispara hasta 20 requests por render sin que nada lo diga — **E2-3** |
| Sin complejidad innecesaria | **PARTIALLY MET** | El código es sobrio. Tercera copia byte a byte de `sourceResolution` — **E2-5** |

### 3.2 Hallazgos

#### E2-1 · Medium · corrección

`findManyIngestionEvents` (`src/repositories/ingestionEvent.repository.ts`) ordena
por una sola columna:

```ts
orderBy: { createdAt: sort.sortOrder },
skip: pagination.skip,
take: pagination.take,
```

y `created_at` **no es único ni casi único en esta tabla**. La importación escribe
sus filas con `insertPendingEventsBatch`, que arma tandas de `FILAS_POR_TANDA =
500` y las manda en un solo `INSERT ... VALUES (...), (...)` con `now()` en la
columna. En PostgreSQL `now()` es `transaction_timestamp()`, constante dentro de
la transacción, y una sentencia suelta es su propia transacción: **las 500 filas
de cada tanda quedan con el mismo `created_at` al microsegundo.**

`ORDER BY created_at LIMIT n OFFSET m` sobre un bloque de empates no tiene orden
definido en Postgres: el planner puede devolver las filas empatadas en distinto
orden en cada ejecución, y cada página es una ejecución distinta. El resultado no
es "el orden se ve raro" sino que **una fila puede aparecer en dos páginas y otra
no aparecer en ninguna**.

**Escenario de falla.** Un archivo de 600 filas se importa; 40 fallan. El ADMIN
usa el cross-link "Ver estas filas" de `ImportPage`, que lo lleva a
`/ingestion-events?batchId=…` — o sea, exactamente al conjunto de filas que
comparten `created_at`. Pagina de a 20. Una fila fallida puede no aparecer nunca,
y es una fila que necesitaba el botón "Reintentar". El propósito declarado del PR
#18 (G-1/G-2: hacer visible lo que era invisible) queda parcialmente sin cumplir
justo en el caso de volumen.

**Por qué es Medium y no High.** No hay pérdida ni corrupción de datos, y en el
camino del webhook —eventos de a uno, con timestamps distintos— no se manifiesta.
El daño es una fila que no se ve, no una fila que se rompe.

**Acción requerida.** Agregar un desempate determinista al `orderBy`
(`[{ createdAt: order }, { id: order }]` es suficiente y no necesita índice
nuevo para el tamaño de bloque que hay que reordenar). Vale la pena mirar de paso
el mismo patrón en la consulta de `fallas` de `getResumenDeLote`, que hace
`orderBy: { createdAt: "asc" }` con `take: MAX_FALLAS_DEVUELTAS` sobre el mismo
conjunto de empates: **cuáles** 100 fallas devuelve tampoco es determinista. Eso
último es del ítem 5, no de la Fase 2, y se anota acá solo porque el arreglo es
el mismo.

#### E2-2 · Medium · trazabilidad

Nueve lugares de `master` citan `docs/research-frontend-ingesta-2026-08-27.md`
como la autoridad de la que salen los requisitos G-1, G-2, G-6 y G-7:

```
src/routes/index.ts                              src/services/ingestionEvent.service.ts
src/routes/ingestionEvent.routes.ts              src/repositories/ingestionEvent.repository.ts
src/controllers/ingestionEvent.controller.integration-test.ts
frontend/src/lib/api.ts                          frontend/src/features/apiKey/sourceResolution.ts
docs/ingestion-architecture.md                   docs/project-overview.md
```

**Ese archivo no está en `master`.** Vive únicamente en la rama
`docs/research-frontend-ingesta`, commit `3073506`, que nunca se mergeó
(`git cat-file -e master:docs/research-frontend-ingesta-2026-08-27.md` falla;
`git branch -a --contains 3073506` devuelve solo esa rama y su remoto). PR #24,
que puso al día los dos documentos de arquitectura, tampoco lo trajo.

Consecuencia concreta: los identificadores `G-1`, `G-2`, `G-6` y `G-7` que el
código usa para justificar sus decisiones **no se pueden resolver** por nadie que
lea `master`. Un comentario que apunta a un documento inexistente es peor que no
tener comentario, porque afirma que la decisión está fundamentada en algún lado.

**Acción sugerida.** Mergear la rama del relevamiento, o reemplazar las nueve
referencias por la sección de `docs/ingestion-architecture.md` que corresponda.
Es lo uno o lo otro; dejarlo como está es la única opción que no sirve.

#### E2-3 · Medium · performance

`IngestionEventListPage` y `ApiKeyListPage` resuelven el nombre de la fuente de
cada fila con `useSourcesByIds`, que dispara un `GET /api/sources/:id` por
`sourceId` distinto de la página visible (deduplicado, nunca uno por fila — eso
está bien resuelto). Con `PAGE_SIZE = 20` son hasta **20 requests HTTP
adicionales por render**.

Lo que lo convierte en hallazgo es que **esos nombres ya están en memoria**. Las
dos pantallas hacen, arriba en el mismo componente:

```ts
const sourcesQuery = useSources({ page: 1, pageSize: SOURCES_PARA_SELECT }); // 100
const fuentes = sourcesQuery.data?.data ?? [];
```

para alimentar sus `<select>`. `ApiKeyListPage` incluso lo sabe y lo usa:
`nombreDeFuenteElegida` busca dentro de `fuentes` justamente para no ir a la red.
Pero las filas de la tabla no lo hacen, y las claves de cache no se cruzan
(`sourceKeys.list({...})` no alimenta a `sourceKeys.detail(id)`), así que las 20
requests salen igual.

El multiplicador es `refetchOnWindowFocus: true` con `staleTime: 30_000`
(`lib/queryClient.ts`): volver a la pestaña después de medio minuto vuelve a
disparar la ronda entera.

**Acción sugerida.** Buscar primero en `fuentes` y pedir por id solo los que no
estén ahí — la fuente número 101 sigue necesitando el fallback, así que
`useSourcesByIds` no sobra, solo deja de ser el primer recurso.

#### E2-4 · Low · contrato de UI

En `IngestionEventListPage` hay **una sola** instancia de mutación para toda la
tabla, y su estado pendiente deshabilita el botón de todas las filas:

```tsx
<Button disabled={retryMutation.isPending} onClick={() => retryMutation.mutate(evento.id)}>
```

Con veinte filas fallidas, reintentar una deja las otras diecinueve
deshabilitadas mientras dura el request. No hay riesgo de reintentar la fila
equivocada —el `id` va en el `onClick`— así que es una molestia, no un bug de
corrección. Se registra porque contradice el propio criterio del componente, que
en el resto de los casos condiciona la acción fila por fila (`evento.status ===
"FAILED"`, `evento.promotedContactId ?`).

**Acción sugerida.** Comparar contra la variable en vuelo
(`retryMutation.isPending && retryMutation.variables === evento.id`).

#### E2-5 · Low · duplicación

`features/ingestionEvent/sourceResolution.ts` es la **tercera** copia del mismo
hook, y es byte a byte idéntica a `features/apiKey/sourceResolution.ts` una vez
quitados los comentarios (verificado con `diff`). El proyecto ya tiene cinco
módulos de resolución (`companyResolution`, dos `relationResolution`, dos
`sourceResolution`).

El criterio está escrito y es defendible: *"son doce líneas, y una abstracción
sobre dos o tres casos elegiría mal qué parametrizar. El día que aparezca una
diferencia real entre los consumidores, cada copia la absorbe sin arrastrar a las
otras."* No se propone cambiarlo por gusto. Se registra que **la diferencia real
no apareció en la tercera copia tampoco**, que es el dato que el propio criterio
decía que había que esperar: dos copias son una decisión, tres son un patrón, y
un cambio en la resolución de fuentes hoy hay que hacerlo dos veces sin ninguna
divergencia que lo justifique.

### 3.3 Lo que está bien hecho

STD-SW-004 exige señalarlo explícitamente: *"una review que solo lista problemas
es desalentadora e incompleta"*.

- **`INGESTION_EVENT_PUBLIC_SELECT` excluye `rawPayload` y `promotionNotes`, y
  argumenta por qué.** Es la decisión de diseño más importante del PR #18 y es la
  correcta por dos razones a la vez —volumen y privacidad— aunque el comentario
  solo desarrolle la primera. Sin ella, el hallazgo D2-2 sería sobre la pantalla
  principal y no sobre un endpoint secundario.
- **El CAS del retry se lee, y se lee bien.** `retryIngestionEvent` no repite el
  error que la ronda anterior encontró en `promotion.service.ts`: verifica
  `result.count === 0` y deja escrito que *"el CAS ya decidió — este re-read
  NUNCA participa de esa decisión"*. Distinguir el re-read que decide del re-read
  que solo reporta es exactamente lo que E-1 pedía que se entendiera.
- **`previsualizarEncabezados` reusa la cadena de parseo entera en vez de
  escribir una propia**, y el comentario explica que la alternativa no era más
  rápida sino incorrecta: un BOM o un espacio de diferencia entre lo que la vista
  previa muestra y lo que la importación interpreta desalinearía el mapeo en
  silencio. Es la razón buena, no la obvia.
- **`uploadFile()` no fija `Content-Type` a propósito**, con el mecanismo del
  boundary explicado. Es el error clásico de multipart y acá está prevenido con
  el porqué escrito, no con una convención que alguien pueda "arreglar" después.
- **`handleResponse` se extrajo al agregar multipart** en lugar de duplicar el
  manejo de 401/204/error entre `request()` y `uploadFile()`. Es la lectura
  correcta de cuándo una abstracción se gana su lugar — y contrasta con E2-5.
- **Los 22 tests de integración del listado y el retry** cubren aislamiento
  cross-organización en los dos sentidos, el 409 de no idempotencia, el `DUPLICATE`
  que da página vacía en vez de 400, y el ciclo completo *corregir el fieldMapping
  → reintentar el mismo evento → el worker lo promueve*. Ese último test prueba la
  promesa de §1 de punta a punta, que es lo que hacía falta probar.

### 3.4 Gate

**Ninguna Critical. Ninguna High.** Tres criterios de aceptación quedan
PARTIALLY MET, los tres con camino de resolución claro y acotado.

Liberado condicionalmente. Condición: **E2-1** resuelto o waived explícitamente
—es el único hallazgo que produce un resultado incorrecto— y **E2-2** resuelto en
alguna de sus dos direcciones. E2-3, E2-4 y E2-5 son sugerencias sin obligación
de acción.

---

## 4. RV-SECURITY — Security Review

```
Report ID:  RR-SEC-2026-08-28-01     Manifest: RM-2026-08-28-FASE2
Outcome:    CONDITIONAL PASS
```

Ejecutado directamente contra el procedimiento nativo del Toolkit. **No** se
delegó en la skill `security-review` de Claude Code ni en `/cso` de gstack, de
acuerdo con la sección *Execution* del protocolo.

### 4.1 Clasificación de los datos en alcance (paso 1)

| Dato | Clase STD-LEG-002 | Dónde aparece por primera vez en la Fase 2 |
|---|---|---|
| `firstName`, `lastName`, `email`, `phone`, `jobTitle` de un lead | **Sensitive** | En el navegador, dentro de `rawPayload` de la respuesta de `GET /api/imports/:batchId` que consume `ImportPage` |
| `IngestionEvent.errorMessage` | **Internal** hoy; ver D2-7 | Renderizado fila por fila en `IngestionEventListPage` |
| `promotedContactId` | **Internal** (identificador, no dato) | Link a `/contacts/:id/edit` en `IngestionEventListPage` |
| Secreto de `ApiKey` (`key` en claro) | **Sensitive** (credencial) | `ApiKeySecretDialog`, y —contra lo declarado— el `MutationCache`: ver S2-4 |
| Encabezados de un archivo de muestra | **Internal** | Respuesta de `POST /api/imports/preview` |

### 4.2 Modelo de amenaza (STRIDE) — solo las fronteras nuevas

| Cruce de frontera | Amenaza | Mitigación | Riesgo residual |
|---|---|---|---|
| Persona → `GET /api/ingestion-events` | **I** — leer la cola de otra organización | `organizationId` en el `WHERE` de `buildIngestionEventWhere`, en `findMany` y en `count`; proyección que excluye `rawPayload` y `promotionNotes`; dos tests de integración que verifican el cruce en los dos sentidos | Ninguno |
| Persona → `GET /api/ingestion-events` | **E** — un USER leyendo la cola | `authenticate` + `authorize("ADMIN")`, lectura incluida; test explícito del 403 | Ninguno |
| Persona → `GET /api/ingestion-events` | **D** — agotar la base | Ninguna: sin rate limit y sin tope de `page` | **S2-5** |
| Persona → `GET /api/ingestion-events` | **R** — negar haber leído datos personales | Ninguna: no hay log de acceso por registro | **D2-5** (se reporta en RV-STANDARDS, que es donde vive el criterio) |
| Persona → `POST /ingestion-events/:id/retry` | **T** — reprocesar un evento ajeno | `organizationId` en el `WHERE` del `updateMany`, no en el pre-chequeo; CAS sobre `status: FAILED`; 404 indistinguible entre "no existe" y "es de otra organización" | Ninguno |
| Persona → `POST /api/imports/preview` | **D** — agotar memoria | `businessWriteRateLimiter` (100/min por `userId`), tope de 10 MB de subida. El parseo se hace **sin ninguna precondición** | **S2-3** |
| Navegador ← respuestas con datos personales | **I** — quedar en cache del cliente o de un intermediario | Ninguna cabecera de cache declarada | **S2-6** |
| Navegador → DOM | **I/T** — XSS por un `errorMessage` o un nombre de fuente hostil | React escapa todo lo interpolado; verificado que no hay ningún `dangerouslySetInnerHTML`, `innerHTML` ni `eval` en `frontend/src` | Ninguno |
| Cadena de dependencias del frontend | **cualquiera** — CVE que entra sin que nada lo diga | Ninguna: el gate de auditoría no cubre este workspace | **S2-1**, **S2-2** |

### 4.3 OWASP Top 10 (STD-SW-002)

| | Categoría | Estado |
|---|---|---|
| A01 | Broken Access Control | **Addressed** — las seis rutas nuevas son ADMIN-only con lectura incluida; `organizationId` en el `WHERE` de toda lectura y escritura nueva; `AdminRoute` en el frontend es restricción visual, la real sigue siendo `authorize` |
| A02 | Cryptographic Failures | **Partially Addressed** — el secreto sigue saliendo una sola vez y el hash nunca por la API, pero vive más de lo declarado del lado del cliente: **S2-4** |
| A03 | Injection | **Addressed** — el código nuevo no agrega SQL crudo; `findMany`/`count`/`updateMany` de Prisma con `where` estructurado. En el frontend, cero sinks de HTML |
| A04 | Insecure Design | **Addressed** — el retry devuelve a `PENDING` y deja la promoción del lado del worker, sin meterla en el ciclo del request; el preview no persiste nada |
| A05 | Security Misconfiguration | **Partially Addressed** — helmet sigue puesto; sin `Cache-Control: no-store` en las respuestas con datos personales (**S2-6**) |
| A06 | Vulnerable and Outdated Components | **Partially Addressed** — **S2-1** (el gate no cubre el frontend) y **S2-2** (aviso HIGH en una dependencia de producción del frontend) |
| A07 | Identification and Authentication Failures | **Addressed** — el camino de auth de las rutas nuevas es el existente; una API key no puede leer la cola ni pedir reprocesos, y está escrito por qué |
| A08 | Software and Data Integrity Failures | **Addressed** — el retry es un CAS cuyo `count` se verifica; no es idempotente y el 409 está probado |
| A09 | Security Logging and Monitoring Failures | **Partially Addressed** — sin registro de quién leyó qué datos personales (**D2-5**) |
| A10 | SSRF | **Not Applicable** — ninguna de las rutas nuevas hace peticiones salientes |

### 4.4 Hallazgos

#### S2-1 · Medium · brecha de proceso

**El gate de auditoría de dependencias no cubre el frontend.** El step
*"Auditoría de dependencias"* de `ci.yml:87-90` corre dentro del job `backend`,
con su `working-directory` y su `package-lock.json`. El job `frontend`
(`ci.yml:92-110`) corre `npm ci`, `typecheck`, `build` y `test`, y **nada que
mire sus dependencias**.

Hasta el 27 eso era casi inocuo: el frontend era chico y ningún PR reciente lo
tocaba. La Fase 2 lo vuelve la mayor parte del deliverable —cuatro de seis PRs,
50 de los 62 archivos, 5.767 de las 7.157 líneas— y la brecha pasa a ser el mismo
problema que S-3 describió para el backend, sobre la superficie que este ciclo
agregó.

**Verificado a mano**, que es exactamente lo que S-3 decía que no debería hacer
falta: `npm audit` en `frontend/` devuelve **5 vulnerabilidades (4 high, 1
moderate)**. `npm audit --omit=dev` devuelve **2 high**, las dos de S2-2.

**Acción requerida.** Extender el mismo mecanismo al job `frontend`.
`scripts/audit-gate.ts` ya lee un JSON producido por quien lo invoca y no ejecuta
`npm audit` él mismo, así que sirve tal cual: el arreglo es un step, no un
script nuevo. Su lista de excepciones tendría que poder distinguir workspaces o
duplicarse, cosa que hoy no contempla.

#### S2-2 · Medium (aviso HIGH, severidad contextual menor) · dependencia

`react-router@7.18.1`, vía `react-router-dom@7.18.1`, que es **dependencia de
producción** del frontend. Advisory GHSA-qwww-vcr4-c8h2, severidad *high*:
*"React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400
Response"*.

**Verificado no alcanzable por este camino.** La advisory es del modo RSC (React
Server Components) del handler de servidor de react-router. Esta app es una SPA
de Vite servida como estáticos, con `createBrowserRouter` en
`frontend/src/app/router.tsx` y ningún runtime de react-router del lado del
servidor: no hay handler RSC que evitar, ni `action` de router que ejecutar antes
de tiempo — el proyecto no usa `action`/`loader` en absoluto, todas las
escrituras van por TanStack Query contra la API. Se suma que la app no usa
cookies de sesión (el token es Bearer, inyectado por `getAccessToken`), así que
la clase CSRF no aplica de entrada.

**Arreglable sin ruptura:** `npm audit fix` se queda dentro de `^7`.

Las otras tres *high* (`undici@7.28.0`) llegan por `jsdom`, y la *moderate*
(`postcss`) por `vite`: las dos son devDependencies y no se despliegan. Se dejan
anotadas para que la lista completa quede en el registro, no como hallazgo.

**Por qué se reporta como Medium y no como High.** Mismo criterio que la ronda
anterior aplicó a S-2: la severidad del advisory es del ecosistema, la de este
review es contextual. Lo que sí es un hallazgo de proceso completo es que nadie
se hubiera enterado — eso es S2-1.

#### S2-3 · Medium · amplificación de un riesgo aceptado

`POST /api/imports/preview` duplica la superficie del riesgo que la ronda
anterior aceptó como S-5 (expansión de XLSX en memoria; `IMPORT_MAX_FILE_BYTES`
acota lo que se sube, no lo que ocupa al expandirse, y `load()` materializa el
libro entero).

El route comment anticipa la mitad del problema y por eso le pone
`businessWriteRateLimiter` a un endpoint que no escribe — desviación deliberada
del criterio del proyecto, bien argumentada. Lo que no dice es la asimetría con
la importación real:

```
importarArchivo:            findSourceById → 404
                            type !== FILE_IMPORT → 400
                            !isActive → 400
                            ─────────────────────────── recién acá: parsearArchivo()

previsualizarEncabezados:   ─────────────────────────── parsearArchivo()
```

La importación real paga el parseo **solo después** de tres precondiciones que un
atacante no controla (tiene que existir una fuente suya, del tipo correcto y
activa). El preview no tiene ninguna: es ADMIN autenticado y nada más. Es el
camino **estrictamente más barato** de llegar a la operación más cara de la app.

**Cupo real:** `BUSINESS_WRITE_MAX = 100` por `BUSINESS_WRITE_WINDOW_MS = 60_000`,
por `userId`. Hasta 100 expansiones de XLSX de 10 MB por minuto y por cuenta
ADMIN, sin tocar ninguna tabla.

**Acción sugerida.** No hay arreglo obvio sin resolver S-5 de fondo (el lector en
streaming de exceljs está verificado como roto). Lo que sí es barato es bajar el
cupo específico de este endpoint: 100/min es el umbral pensado para escrituras de
negocio de alta frecuencia, y una vista previa de encabezados no lo es. Si se
decide dejarlo, corresponde registrarlo como mitigación aceptada igual que S-5.

#### S2-4 · Low · vida de un secreto

`features/apiKey/mutations.ts` afirma, sobre el secreto en claro que devuelve el
201:

> *"no se guarda en cache de TanStack Query (no hay queryKey donde caiga), no se
> persiste"*

y `ApiKeySecretDialog.tsx` lo repite: *"ni en el cache de TanStack Query (no hay
queryKey donde caiga)"*. La primera mitad de la frase es cierta y la conclusión
no: **`useMutation` también cachea.** El resultado de `createApiKey` queda en el
`MutationCache` como `createApiKeyMutation.data`, con el campo `key` en claro, y
sigue ahí después de que el modal se cierra —`setSecreto(null)` limpia el estado
del componente, no la mutación— hasta que el `gcTime` por defecto lo recoge.

**Impacto real, sin inflarlo.** Es el secreto de la propia persona, en la memoria
de su propio navegador, alcanzable desde React DevTools o desde cualquier código
que ya corra en esa página. No cruza ninguna frontera de confianza. La razón por
la que se registra es que **el diseño explícitamente prometía lo contrario** —
"el llamador es responsable de que ese valor no sobreviva más allá del modal que
lo muestra"— y una garantía que no se cumple es peor que una que no se prometió,
porque nadie la vuelve a mirar.

**Acción sugerida.** `createApiKeyMutation.reset()` en el `onClose` del modal, y
corregir los dos comentarios para que digan `QueryCache` donde hoy dicen "cache
de TanStack Query".

#### S2-5 · Low · defensa en profundidad

`GET /api/ingestion-events` no tiene rate limit, y su `page` no tiene tope:

```ts
page: z.coerce.number().int().positive().default(1),
pageSize: z.coerce.number().int().positive().max(100).default(20),
```

`pageSize` sí está acotado; `page` no, así que `?page=100000000` produce un
`OFFSET` de dos mil millones que Postgres recorre y descarta. Cada request son
**dos** consultas —`findMany` y `count`— sobre la tabla de mayor volumen del
esquema, y el `count` sin filtros no se beneficia de ningún índice parcial.

Es la convención del proyecto (las lecturas no llevan limiter) y por eso es Low y
no Medium. Lo que lo vuelve reportable es que **este mismo deliverable se desvía
de esa convención en el archivo de al lado**, y por el argumento correcto:
`import.routes.ts` le pone el limiter a un endpoint de solo lectura porque *"el
limiter acota COSTO por identidad"*. Ese argumento aplica igual acá y no se
aplicó.

**Acción sugerida.** Un `.max()` en `page` es una línea y elimina la parte más
barata de abusar. El limiter es una decisión de convención que conviene tomar una
vez para todas las lecturas, no acá sola.

#### S2-6 · Low · defensa en profundidad

Ninguna respuesta de la API declara `Cache-Control`. `helmet()` no la fija
(`src/app.ts:17` lo usa con la configuración por defecto, que no incluye
`noCache`), Express tampoco, y `res.json()` agrega un `ETag`. Desde la Fase 2 hay
respuestas con datos personales de leads viajando a un navegador
(`GET /api/imports/:batchId` con `rawPayload`), sin ninguna instrucción de que no
se almacenen.

En la práctica hoy el riesgo es bajo: son `GET` autenticados con `Authorization`,
y sin `Cache-Control` ni `Expires` ni `Last-Modified` un navegador no tiene
frescura heurística que aplicar. Se registra porque es la clase de supuesto que
deja de valer sin aviso en cuanto aparezca un proxy, un CDN o un service worker
entre el navegador y la API.

**Acción sugerida.** `Cache-Control: no-store` en las respuestas que llevan datos
personales, o en toda la API, que es más simple de sostener que una lista.

### 4.5 Gate

**Ninguna Critical.** Hay un aviso HIGH del ecosistema (S2-2), verificado no
alcanzable por el uso que esta app le da a la dependencia, con arreglo no
disruptivo disponible: es una High *con mitigación documentada*, no una High sin
tratar. El `FAIL absoluto` de RV-SECURITY no aplica.

Liberado condicionalmente. Condiciones: **S2-1** con un gate de auditoría en el
job `frontend`; **S2-2** con `npm audit fix` (no disruptivo) o waiver registrado;
**S2-3** con cupo propio o mitigación aceptada registrada junto a S-5; S2-4, S2-5
y S2-6 como hardening sin obligación de acción.

---

## 5. RV-STANDARDS — Standards Review

```
Report ID:  RR-STD-2026-08-28-01     Manifest: RM-2026-08-28-FASE2
Outcome:    CONDITIONAL PASS
```

### 5.1 Verificación por estándar bindeado

| Estándar | Criterio | Evaluación |
|---|---|---|
| **STD-SW-001** SOLID (Mandatory) | SRP / DIP / ISP | **MET** — el frontend replica la separación del backend por slice (`api` / `queries` / `mutations` / `types` / componente); `Db` sigue inyectable en cada función de repositorio nueva; `CreatedApiKey extends ApiKey` hace que leer `.key` sobre una fila del listado sea error de compilación |
| | DRY (no es SOLID pero lo evalúa STD-SW-004) | **PARTIALLY MET** — E2-5 |
| **STD-SW-002** OWASP (Mandatory) | 10 categorías evaluadas | **PARTIALLY MET** — A02, A05, A06 y A09 Partially Addressed (S2-1 a S2-6, D2-5); las otras seis Addressed o Not Applicable |
| **STD-SW-003** Testing (Mandatory) | Pirámide | **MET** — lógica pura sin React en su propio módulo y con tests unitarios (`fieldMapping.test.ts`, 23 casos; `fileValidation.test.ts`, 6), componentes con Testing Library, bordes del backend contra Postgres real |
| | Caminos críticos | **MET** — el retry cubre 200, 409 sobre `PENDING`, 409 sobre `PROCESSED`, no idempotencia, 404 cross-organización, 404 inexistente y 400 de uuid inválido |
| | Modos de falla | **MET** — el preview hereda y prueba los rechazos de la importación real (415, 413, sin filas de datos), y hay un test de que los dos caminos dan los mismos encabezados sobre el mismo archivo |
| | Tests que prueban comportamiento, no implementación | **MET** — se verificó una muestra: los tests de página van por rol y texto visible, no por estructura interna |
| | Tests que pasan en CI | **MET** — 115 backend + 604 frontend en verde localmente; el job `integration` reconstruye la base y corre la suite de integración |
| **STD-SW-004** Code Review (Mandatory) | RV-ENG conducido con clasificación de severidad | **MET** |
| | La review señala también lo que está bien | **MET** — §3.3 |
| **STD-LEG-002** Data Privacy (Mandatory) | Clasificación de datos | **NOT MET** — D2-1 |
| | Minimización | **NOT MET** — D2-2 (y D2-6) |
| | Retención y borrado | **NOT MET** — D2-3 |
| | Control de acceso (rol) | **MET** — ADMIN-only en las seis rutas nuevas, aislamiento por organización verificado con tests en las dos direcciones |
| | Control de acceso (log de acceso a datos Sensibles) | **NOT MET** — D2-5 |
| | Derechos del titular — borrado | **PARTIALLY MET** — D2-4 |
| | Privacy by default | **PARTIALLY MET** — la proyección del listado excluye el crudo por defecto (bien), pero el resumen de lote lo incluye por defecto (D2-2) |
| | Third-party data sharing | **Not Applicable** — la Fase 2 no comparte datos con ningún tercero; el frontend no tiene ninguna dependencia de analytics ni telemetría (verificado en `frontend/package.json`) |
| **STD-LEG-001** GDPR (Conditional) | — | **Not Applicable / hueco abierto** — Q-1, sin cambios respecto del 27 |
| **STD-DES-001** WCAG 2.2 AA | — | **No bindeado** en este manifest — ver §2.3 y Q-3 |
| **STD-GEN-001** Documentación (Advisory) | Exactitud | **Notado, no gatea** — E2-2 es el caso concreto |
| **STD-GEN-002** Commits (Advisory) | — | **Notado** — los diez commits siguen convencional, con scope, y cada PR es una unidad lógica |

### 5.2 Hallazgos

#### D2-1 · Medium · STD-LEG-002, Clasificación de datos

Verificado de cero, no heredado: **sigue sin existir ningún documento que
clasifique los datos que maneja esta capa.** Se buscó en `docs/` completo.

Por la tabla del estándar, `firstName`/`lastName`/`email`/`phone`/`jobTitle` de un
lead son **Sensitive**, lo que arrastra cifrado en reposo, log de acceso y control
estricto.

Lo que la Fase 2 agrega no es gravedad, es urgencia: hasta el 27 la ausencia de
clasificación era un papel que faltaba sobre datos que solo vivían en Postgres.
Ahora esos datos llegan a un navegador (D2-2) y se muestran a una persona, y las
decisiones que había que tomar con la clasificación en la mano —qué se manda al
cliente, qué se loguea, cuánto vive— **ya se tomaron sin ella**. La tabla de §4.1
de este reporte es la primera clasificación explícita que existe en el proyecto,
y es de un review, no del diseño.

#### D2-2 · Medium · STD-LEG-002, Minimización

**El hallazgo más sustantivo de este ciclo, y el que contesta directamente la
pregunta de si el frontend toca datos personales que no debería.**

`ImportPage` (PR #22) consume `GET /api/imports/:batchId`. Esa respuesta incluye,
por diseño del ítem 5:

```ts
select: { id: true, errorMessage: true, rawPayload: true },
take: MAX_FALLAS_DEVUELTAS,   // 100
```

`rawPayload` es la fila completa del archivo tal como se subió: nombre, apellido,
email, teléfono y puesto de una persona real. **Hasta 100 registros personales
crudos por consulta viajan al navegador.**

`ImportPage` **nunca los renderiza**. La tabla de "Filas que fallaron" muestra una
sola columna, `falla.errorMessage`. El campo está declarado en el tipo del
frontend (`FallaDeLote.rawPayload: unknown`, `features/import/types.ts:34`) con
un comentario que explica qué es, y no se lee desde ningún componente —verificado
con `grep` sobre todo `frontend/src`, las únicas menciones son ese tipo y dos
comentarios que dicen que la otra proyección *no* lo trae—. Queda en el
`QueryCache` de TanStack Query, bajo `importKeys.detail(batchId)`, hasta que el
`gcTime` lo recoja.

El estándar es literal: *"cada campo debe tener un propósito definido"*. Un campo
que se transfiere y no se usa no tiene ninguno. Esto es distinto de D-2 de la
ronda anterior —que era sobre *guardar* el payload completo, y tenía una razón
buena (§1: sin el crudo intacto no hay reproceso)—: acá no hay ninguna razón,
porque nadie lo consume.

**El contraste dentro del mismo deliverable es la evidencia de que se podía
hacer bien.** `INGESTION_EVENT_PUBLIC_SELECT` del PR #18 excluye `rawPayload`
deliberadamente y deja escrito por qué. El PR #22 se conectó al endpoint que sí
lo trae, sin reabrir esa decisión.

**Acción sugerida.** Quitar `rawPayload` de la respuesta de
`GET /api/imports/:batchId`, o dejarlo detrás de un parámetro explícito que
`ImportPage` no pida. Si en algún momento hace falta mostrar la fila cruda para
diagnosticar, es un endpoint de detalle por evento —que la nota del PR #18 ya
identificó como faltante— y no una descarga de 100 registros por las dudas.

#### D2-3 · Medium · STD-LEG-002, Retención y borrado

Verificado de cero, no heredado: **la purga por retención sigue sin existir.** Se
buscó job, script, entrada de CI y comando de `package.json`. `docs/ingestion-architecture.md`
§9.1 sigue esbozando la consulta
(`DELETE FROM ingestion_events WHERE created_at < ? AND status IN ('PROCESSED','DUPLICATE')`)
y sigue sin correrla nadie. `src/repositories/ingestionEvent.repository.ts:52`
sigue refiriéndose a ella como si existiera.

El estándar exige, por categoría, período máximo de retención, disparador de
borrado y método de borrado. **Siguen sin existir los tres.**

Lo que este ciclo agrega: la Fase 2 le dio a la cola una interfaz —se browsea, se
filtra, se reintenta— **sin darle un final**. Una cola que se puede mirar y
accionar pero no vaciar acumula datos personales indefinidamente con una pantalla
que invita a usarla más. La consulta de §9.1 tampoco tendría hoy quién la dispare
desde la UI.

#### D2-4 · Medium · STD-LEG-002, Derechos del titular (borrado)

Verificado de cero: borrar un `Contact` sigue siendo soft delete y **sigue sin
tocar la copia de `rawPayload`**. Un pedido de borrado no se puede honrar de punta
a punta.

Lo que la Fase 2 agrega es una manifestación visible de la inconsistencia:
`IngestionEventListPage` renderiza `<Link to={/contacts/${id}/edit}>Ver
contacto</Link>` para cada evento `PROCESSED`. Después de un soft delete del
contacto, ese link queda apuntando a un registro que la API ya no devuelve,
mientras el evento —con la copia entera de los datos de esa persona en
`rawPayload`— sigue listado y sigue completo. La pantalla deja ver el hueco sin
explicarlo.

**Alcance honesto, igual que la ronda anterior:** la parte de `ingestion_events`
la introdujo el ítem 1; la ausencia de un mecanismo de derechos del titular es
anterior y de todo el proyecto. Lo que es de la Fase 2 es el link.

#### D2-5 · Medium · STD-LEG-002, Control de acceso (log)

El estándar exige que *"todo acceso a datos Sensitive o Regulated sea logueado
(quién accedió a qué, cuándo, desde dónde)"*.

La ronda anterior evaluó este criterio como PARTIALLY MET: se loguea el request,
no el acceso por registro. **Este ciclo lo baja a NOT MET**, y el cambio de
evaluación no es un endurecimiento arbitrario sino la consecuencia de que cambió
el hecho evaluado:

- Hasta el 27, los accesos a datos personales de esta capa eran de máquina: el
  webhook escribía, el worker leía y promovía. "Quién accedió" tenía una respuesta
  estructural — el sistema.
- Desde el 27 a la noche hay **dos endpoints de lectura de datos personales
  operados por una persona desde una pantalla**: `GET /api/ingestion-events` (que
  expone `errorMessage` y la traza `evento → contacto` de cada lead) y
  `GET /api/imports/:batchId` (que expone hasta 100 registros crudos). "Quién
  accedió a qué" pasó a ser una pregunta con respuesta variable, y no queda
  registrada en ningún lado: ninguno de los dos handlers loguea, y el `pino` de la
  app no tiene middleware de request logging que lo cubra.

Con varios ADMIN en una organización, hoy no hay forma de contestar quién miró la
cola de leads.

#### D2-6 · Low · STD-LEG-002, Minimización

`POST /api/imports/preview` sube el archivo **entero** —hasta 10 MB, hasta 10.000
filas de datos personales— para devolver únicamente la primera fila, la de
encabezados. Todo lo demás se parsea en memoria y se descarta.

Está bien manejado en lo que se puede: no se persiste nada (verificado —
`previsualizarEncabezados` no toca la base, y el texto de la UI se lo dice a la
persona: *"Se leen solo los nombres de las columnas. El archivo no se importa y
no se guarda"*). Y la razón de reusar la cadena de parseo completa es buena
(§3.3 explica por qué un segundo camino sería peor).

Se registra porque el estándar habla de *recolectar*, no de *guardar*: transferir
10.000 registros personales para leer una fila es una recolección desproporcionada
aunque dure lo que dura un request. Para CSV habría un recorte del lado del
cliente; para XLSX, que es un zip, no lo hay — así que puede terminar siendo una
excepción consciente, que es exactamente lo que hay que dejar registrado en vez de
que nadie la haya mirado.

#### D2-7 · Low · STD-LEG-002, Clasificación (dato limítrofe)

`errorMessage` es hoy la columna que la Fase 2 muestra en pantalla, y **se
verificó que no transporta datos personales**: sus dos únicos productores son
`promotion.service.ts`, con mensajes de zod que en este schema son todos
personalizados y sin eco del valor recibido (`"email inválido"`, `"firstName es
requerido"`, `"phone no puede superar los 30 caracteres"`), y `traducirConMapeo`,
cuyo mensaje enumera **encabezados de columna** del `fieldMapping`, no contenido
de filas.

El hallazgo no es que hoy filtre, sino que **nada lo garantiza mañana**. No hay
test, ni comentario, ni invariante que diga "este campo no puede contener el valor
de una celda". Un `z.enum` agregado a `ingestContactSchema` en el futuro produciría
por defecto `"Invalid enum value. Expected 'x' | 'y', received '<valor real>'"`, y
ese valor terminaría en una columna que ahora se renderiza en una tabla y se
cachea en un navegador. La clasificación de `errorMessage` como Internal (§4.1)
depende de una propiedad que nadie está defendiendo.

**Acción sugerida.** Un test que fije la propiedad, o una nota en el schema.

### 5.3 Verificación afirmativa: qué hace el frontend con estos datos

El enunciado pide específicamente evaluar si la Fase 2 introduce algo nuevo bajo
STD-LEG-002 por el lado del navegador. Lo que se verificó, y salió bien, se deja
escrito con el mismo cuidado que lo que salió mal — un review que solo registra
huecos no permite después saber qué se miró.

| Pregunta | Verificación | Resultado |
|---|---|---|
| ¿Se persisten estos datos fuera de la memoria? | `grep` de `localStorage`, `sessionStorage`, `indexedDB`, `persistQueryClient`, `createSyncStoragePersister` sobre todo `frontend/src` | **No.** Los únicos usos de storage del proyecto son de `auth/`: la sesión de Supabase (`persistSession`) y un marcador de aceptación de invitación. Ninguna pantalla de ingesta escribe nada |
| ¿El `QueryClient` tiene persister? | `lib/queryClient.ts` completo | **No.** `staleTime`, `refetchOnWindowFocus` y `retry`; sin `persister`, sin `broadcastQueryClient`. El cache es de memoria y muere con la pestaña |
| ¿Se limpia al cambiar de identidad? | `AuthContext` | **Sí** — `queryClient.clear()` en la frontera de sesión. Los datos de una organización no sobreviven a un cambio de sesión en la misma pestaña |
| ¿Hay logs de browser que los toquen? | `grep` de `console.` sobre `frontend/src` sin tests | **No.** Un solo `console.error`, en `AuthContext.tsx:110`, sobre un fallo de `signOut`. Ninguna pantalla de ingesta loguea nada |
| ¿Hay telemetría o analytics? | `frontend/package.json` completo | **No.** Ninguna dependencia de analytics, error reporting o RUM. Nada sale del navegador hacia un tercero |
| ¿Se filtran datos personales por la URL? | Los tres filtros que viajan en query string | **No.** `sourceId` y `batchId` son UUID; `status` es un enum. Ningún dato de lead entra al historial del navegador ni al `Referer` |
| ¿Hay algún sink de HTML crudo? | `grep` de `dangerouslySetInnerHTML`, `innerHTML`, `eval(` | **No.** Todo lo que viene del servidor se interpola como texto y React lo escapa |

**La conclusión, dicha con precisión:** el navegador **no persiste ni exporta**
estos datos personales; los tiene en memoria mientras la pestaña vive. Lo que la
Fase 2 introduce bajo STD-LEG-002 no es una fuga sino **dos cosas nuevas**:
datos que se transfieren y no se usan (**D2-2**) y accesos humanos a datos
Sensitive que nadie registra (**D2-5**).

### 5.4 Por qué CONDITIONAL PASS y no FAIL

El protocolo dice FAIL ante *"cualquier criterio Mandatory Not Met sin razón
aceptable"*. Cuatro criterios de STD-LEG-002 están Not Met: D2-1, D2-2, D2-3 y
D2-5.

Se asienta como CONDITIONAL PASS por las mismas dos razones que el 27, con una de
ellas debilitada:

1. **Hay camino de remediación claro y trazable en los cuatro.** D2-2 es quitar un
   campo de un `select`. D2-3 tiene la consulta exacta ya escrita en §9.1. D2-5 es
   un log en dos handlers. D2-1 es un documento que este mismo reporte empezó en
   §4.1.
2. **El sistema no está en producción:** no hay pipeline de CD hacia ningún
   hosting, así que todavía no hay titulares de datos reales.

**Y acá está la parte del veredicto que conviene revisar, porque cambió respecto
del 27.** La segunda razón es la que sostiene el CONDITIONAL, y la Fase 2 la
achicó: hasta el 27 el argumento era "estos datos solo viven en una base que
nadie de afuera consulta". Ahora la capa tiene una interfaz completa, usable, que
lleva datos personales a un navegador y los muestra a una persona. Lo único que
falta para que D2-2 y D2-5 sean incumplimientos con titulares reales es un deploy
y un lead. **El día que esta capa reciba leads reales, D2-2, D2-3 y D2-5 son un
FAIL, no una condición.** La diferencia la sigue haciendo un hecho operativo, no
el código — y ese hecho operativo está a un `git push` de cambiar.

---

## 6. Hallazgos consolidados

| ID | Sev. | Review | Qué es | Bloquea |
|---|---|---|---|---|
| E2-1 | Medium | ENG | La paginación del listado de eventos no es estable: un lote entero comparte `created_at`, y filas fallidas pueden no aparecer nunca | No |
| E2-2 | Medium | ENG | Nueve referencias en `master` a un documento que solo existe en una rama sin mergear | No |
| E2-3 | Medium | ENG | Hasta 20 requests HTTP por render para resolver nombres que ya están en memoria | No |
| E2-4 | Low | ENG | Una sola mutación de retry deshabilita el botón de todas las filas | No |
| E2-5 | Low | ENG | Tercera copia byte a byte de `sourceResolution`, sin la divergencia que el criterio decía esperar | No |
| S2-1 | Medium | SEC | El gate de `npm audit` no cubre el workspace `frontend`, que es la mitad de este deliverable | No |
| S2-2 | Medium | SEC | `react-router@7.18.1` (dependencia de producción) con aviso HIGH — verificado no alcanzable, arreglo no disruptivo | No |
| S2-3 | Medium | SEC | `/imports/preview` es el camino más barato a la operación más cara de la app: parsea sin ninguna precondición | No |
| S2-4 | Low | SEC | El secreto de la ApiKey sobrevive al modal en el `MutationCache`, contra lo que el propio comentario afirma | No |
| S2-5 | Low | SEC | `GET /ingestion-events` sin rate limit y con `page` sin tope, contra el criterio que el mismo deliverable aplicó al lado | No |
| S2-6 | Low | SEC | Sin `Cache-Control: no-store` en respuestas con datos personales | No |
| D2-1 | Medium | STD | Sigue sin existir clasificación declarada de datos — y ahora las decisiones ya se tomaron sin ella | No |
| D2-2 | Medium | STD | **`ImportPage` recibe hasta 100 `rawPayload` de leads y no los usa nunca** | No |
| D2-3 | Medium | STD | Sigue sin existir purga de retención — y ahora la cola tiene interfaz pero no final | No |
| D2-4 | Medium | STD | Borrar un Contact sigue sin borrar su copia cruda; el link "Ver contacto" deja ver el hueco | No |
| D2-5 | Medium | STD | Accesos humanos a datos Sensitive sin ningún registro de quién vio qué | No |
| D2-6 | Low | STD | El preview sube 10.000 filas de datos personales para leer una fila de encabezados | No |
| D2-7 | Low | STD | Nada garantiza que `errorMessage` siga sin transportar datos personales | No |

**Ninguna Critical. Ninguna High propia.** El único aviso HIGH es de ecosistema
(S2-2), verificado no alcanzable. **Ningún FAIL.** No se corrigió ningún hallazgo:
los tres reviews se conducen y se reportan, la remediación es una decisión aparte.

**De la ronda anterior:** E-1, S-2 y S-3 verificados de cero y **los tres
efectivamente cerrados** (§2.4). Ningún hallazgo del 27 resultó estar abierto
contra lo que decía su reporte.

---

## 7. Comandos ejecutados

| Comando | Resultado |
|---|---|
| `git log $merge^1..$merge^2` sobre los seis merges | Diez commits del deliverable identificados contra el historial real |
| `git diff --stat ce1f7af 0118a59` | 62 archivos, 7.157 inserciones, 4 borrados |
| `git diff --stat 0118a59 aff9f11` | Solo dos archivos de `docs/` — PR #24 no toca código |
| `git cat-file -e master:docs/research-frontend-ingesta-2026-08-27.md` | Falla — E2-2 |
| `git branch -a --contains 3073506` | Solo `docs/research-frontend-ingesta` y su remoto — E2-2 |
| `npm run typecheck` (backend) | limpio (3 proyectos tsc) |
| `npm test` (backend) | **115 pass, 0 fail** — exit code 0 |
| `npm run lint` · `npx prettier --check .` | limpios los dos |
| `npm run typecheck` (frontend) | limpio |
| `npm test` (frontend) | **604 pass en 69 archivos, 0 fail** |
| `npm run lint` (frontend) | limpio |
| `npm audit --omit=dev` (backend) | 2 moderate, las dos de `uuid` vía exceljs (S-1, ya en la lista de excepciones del gate). **0 high** — S-2 cerrado |
| `npm ls ip-address` (backend) | `express-rate-limit@8.5.2 → ip-address@10.5.0` — S-2 cerrado |
| `npm audit` (frontend) | **5 vulnerabilidades: 4 high, 1 moderate** — S2-1 |
| `npm audit --omit=dev` (frontend) | **2 high**, `react-router`/`react-router-dom` — S2-2 |
| `npm ls undici postcss react-router` (frontend) | `undici` vía `jsdom` (dev), `postcss` vía `vite` (dev), `react-router` de producción — S2-2 |
| `grep` de `localStorage`/`sessionStorage`/`indexedDB`/persisters sobre `frontend/src` | Sin resultados fuera de `auth/` — §5.3 |
| `grep` de `console.`/`dangerouslySetInnerHTML`/`innerHTML`/`eval(` sobre `frontend/src` | Un solo `console.error` en `AuthContext`; cero sinks de HTML — §5.3 |
| `grep -rn "rawPayload" frontend/src` | Solo el tipo y dos comentarios; ningún componente lo lee — D2-2 |
| `diff` entre las dos copias de `sourceResolution.ts` sin comentarios | Idénticas — E2-5 |

`npm run test:integration` **no se corrió**: necesita el stack de Supabase local
que levanta el job `integration` de CI. Se verificó que `ci.yml` lo corre completo
después de reconstruir la base con `migrate:deploy` y auditarla con
`verify:schema`, y se leyeron los 28 tests de integración nuevos para evaluar
cobertura.

---

## 8. Fuera de alcance

- **No se corrigió ningún hallazgo.** Mismo criterio que la ronda anterior.
- No se tocó `docs/project-overview.md` ni `docs/ingestion-architecture.md`.
  Incorporar el resultado de estos reviews a esos documentos es una tarea de
  documentación separada, posterior a que se decida qué hacer con los hallazgos.
- No se re-revisaron los ítems 1 a 5. Los hallazgos del 27 que siguen abiertos
  (S-1, S-4, S-5, D-1 a D-4, E-2, E-3) siguen siendo suyos; donde este ciclo
  encontró que la Fase 2 los agrava, se dijo en el hallazgo `D2-` correspondiente
  con el alcance separado.
- No se creó `state/` ni se archivaron los reports dentro de la instalación del
  Toolkit — nunca se hizo, y hacerlo ahora sería ampliar el alcance sin pedirlo.
- No se conduce RV-DESIGN ni se bindea WCAG: la razón está en §2.2 y §2.3, y las
  observaciones sueltas quedan en Q-3.

---

## 9. Dudas abiertas

### Q-1 · STD-LEG-001 (GDPR) — el mismo hueco, sin resolver

Sigue sin declararse la jurisdicción de los leads. El estándar es Mandatory si
hay datos personales de residentes de la UE en alcance, y una landing page es
alcanzable desde la UE por definición. Se deja como hueco declarado, no como
"no aplica".

**Sin cambios respecto del 27 en el hueco; con un cambio en lo que cuelga de él.**
Si la respuesta es que sí hay leads de la UE, ya no es solo D-3 el que pasa de
condición a bloqueante: **D2-2 y D2-5 pasan también**. Transferir datos personales
a un cliente sin propósito y no registrar quién accede a datos Sensitive dejan de
ser buenas prácticas y pasan a ser obligación.

### Q-2 · Cómo seguir con los 18 hallazgos

Lectura propuesta, con el mismo formato que la ronda anterior:

- **Ciclo corto (una tarde, alto retorno):** E2-1 (un desempate en el `orderBy`),
  E2-2 (mergear la rama o reescribir nueve referencias), S2-1 (un step de CI que
  reusa el script que ya existe), S2-2 (`npm audit fix`), D2-2 (quitar un campo de
  un `select`), S2-5 (un `.max()` en `page`).
- **Ciclo propio de privacidad de datos, con alcance de proyecto y no de
  ingesta:** D2-1, D2-3, D2-4 y D2-5. Es el mismo ciclo que la ronda anterior
  propuso para D-1/D-3/D-4, ahora con D2-5 adentro y con menos margen — ver §5.4.
- **Decisión, no arreglo:** S2-3 (bajarle el cupo al preview, o aceptarlo por
  escrito junto a S-5) y D2-6.
- **Anotaciones:** E2-3, E2-4, E2-5, S2-4, S2-6, D2-7.

### Q-3 · Accesibilidad — observaciones fuera de gate

Consecuencia de la decisión de routing de §2.3. STD-DES-001 no está bindeado, así
que **nada de esto gatea nada** y no está evaluado con el rigor de una auditoría
WCAG. Se anota lo que apareció leyendo el código, para que la decisión de si
merece un ciclo propio se tome sobre datos:

- `design-system/Modal.tsx` no tiene trap de foco ni restaura el foco al elemento
  que lo abrió al cerrarse. El componente lo declara explícitamente y argumenta
  que el caso de uso —dos controles— no lo necesita. Contra WCAG 2.4.3 (Focus
  Order) eso es discutible; contra 2.1.2 (No Keyboard Trap) está bien, porque el
  problema es el inverso.
- El modal no se cierra con Escape, y es una decisión deliberada y bien
  argumentada (el secreto es irrecuperable). Vale la pena saber que es una
  desviación consciente de la expectativa estándar de un diálogo, no un olvido.
- Las tablas de las tres pantallas de listado se repueblan de forma asíncrona sin
  ninguna región `aria-live`, así que un lector de pantalla no anuncia que el
  contenido cambió al filtrar o paginar (4.1.3 Status Messages, AA).
- `FieldMappingEditor` sí tiene `aria-label` por fila en el botón "Quitar"
  (`Quitar la fila N del mapeo`), que es exactamente lo que 2.5.3 y 4.1.2 piden.
  Se anota porque es el caso donde el proyecto ya hizo lo correcto sin que nadie
  se lo pidiera.

### Q-4 · Brecha procedimental del Toolkit ya conocida

El procedimiento de RV-ENG (pasos 3 a 6) no tiene paso de Performance ni de
SOLID, pero sus criterios de aceptación sí los exigen. Se evaluaron igual, contra
los criterios (E2-3 salió de ahí). Ya está registrado como pendiente del Toolkit
para un ciclo dedicado; no se reporta como nuevo.

### Q-5 · Una pregunta de producto que este review no puede contestar

`GET /api/ingestion-events` no tiene endpoint de detalle, y la proyección del
listado excluye `rawPayload` por buenas razones. Consecuencia: **el payload de un
evento de WEBHOOK fallido no es visible por ningún camino.** Para un evento de
importación, `getResumenDeLote` lo muestra (y de más — D2-2); para uno de webhook,
cuyo `batchId` es NULL para siempre, no hay nada.

El comentario del repositorio lo identifica y dice que no se construyó "porque no
se pidió", lo cual es una razón correcta para no construirlo. Se anota acá porque
la decisión de si hace falta —y con qué proyección, ahora que D2-2 mostró lo que
pasa cuando se trae el crudo sin pensarlo— es de producto, no de review.
