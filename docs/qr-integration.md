# Integración de QR Reviews — estado y guía de aplicación

Plan completo (todas las fases, decisiones tomadas con Rocco, mapeo de
modelos, verificación) en el plan de sesión que originó esta migración —
este documento es la referencia viva de **cómo aplicar cada paso**, no
reemplaza ese plan.

Fuente de verdad del comportamiento original: las 15 migraciones de
`Plataforma-QR/supabase/migrations/0001..0015` (cada una documenta su propia
decisión DEC-XXX/Cycle). Este documento no las repite — dice adónde fue a
parar cada pieza y qué falta para terminar de aplicarla.

## Estado

- [x] **Fase 1 — Esquema. Completa (2026-09-02).** `prisma/schema.prisma`
  tiene los modelos nuevos (`QrCode`, `PaymentEvent`,
  `QrSubscriptionStatusChange`, `QrBillingExemptionChange`,
  `PlatformAdmin`) y los campos nuevos en `Organization`
  (`qrSubscriptionStatus`, `qrMercadopagoSubscriptionId`,
  `qrBillingExempt`, `nextQrDisplayNumber`). La migración es
  `prisma/migrations/20260903120000_qr_integration` — aplicada al proyecto
  Supabase del `.env` con `npm run migrate:deploy`, `prisma generate`
  corrido, y `npm run verify:schema` en verde (14/14 chequeos afirmados,
  incluidos los nuevos: política RLS de `qr_codes`, los tres CHECK y la FK
  compuesta `qr_codes -> branches`). La sesión anterior no había podido
  correrla porque el sandbox en la nube no tenía salida de red hacia
  Supabase. Ver "Cómo aplicar Fase 1" abajo por lo que cambió respecto del
  plan original al ejecutarla.
- [x] **Fase 2 — Backend Express. Completa (2026-09-03).** Los 10 endpoints
  de la guía de más abajo están implementados en `src/` (rutas `qrPublic`,
  `qr`, `qrAdmin` y `qrWebhook`, con sus controllers, services y
  repositorios), con `requirePlatformAdmin` como middleware nuevo y las tres
  env vars (`MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`,
  `QR_CLAIM_APP_URL`) opcionales en `config/env.ts` y `.env.example`. Ver
  "Qué se desvió del plan al implementar Fase 2" al final de la sección de
  Fase 2. Sin cambios de esquema: `verify:schema` sigue igual.
- [x] **Fase 3 — Frontend. Completa (2026-09-03).** Módulo QR del frontend
  implementado con el design-system actual del CRM: `features/qr/` (listado,
  crear/editar en diálogo, imagen, enviar, reclamar), `features/branch/`
  (solo lectura, para el selector de sucursal), `lib/{qrImage,sendQr,
  publicUrl,validation}.ts` portados, rutas `/qr` y `/claim/:qrId` y el
  link "QR" del nav. Verificado de punta a punta contra el backend de Fase 2
  con un browser real (claim de un QR físico atravesando el login, QR
  digital reusable y de un solo uso, imagen generada con la URL pública
  correcta, edición, borrado, aislamiento entre organizaciones, rol USER).
  Ver "Qué se desvió del plan al implementar Fase 3" al final de la sección
  de Fase 3. Rocco todavía no hizo el rediseño, así que no se replica el
  look de `Plataforma-QR/admin` ni se inventa uno nuevo; cuando el rediseño
  exista, se re-skinnea sin tocar la lógica de datos (queries/mutations/api
  quedan intactas).
- [ ] **Fase 4 — Corte e infraestructura.** Cloudflare Worker, decomiso de
  Vercel, borrado del proyecto `qr-reviews` (dashboard, manual, al final).
- [ ] **Fase 5 — Repo.** Archivar/borrar `Plataforma-QR` una vez portado.

## Cómo aplicar Fase 1

> **Ya aplicada (2026-09-02).** Los pasos de abajo quedan como registro del
> plan y de lo que se desvió al ejecutarlo:
>
> - **El paso 2 no funciona en este repo.** `prisma migrate dev` (con o sin
>   `--create-only`) replica el historial en una *shadow database* y
>   `20260821140000_incorporate_manual_ddl_into_migrations` falla ahí con
>   `schema "auth" does not exist`: la shadow no es un proyecto Supabase. Es
>   la razón por la que todas las migraciones de este repo llevan timestamp
>   redondo escrito a mano. El equivalente que sí funciona: aplicar lo
>   pendiente con `prisma migrate deploy`, generar el DDL con
>   `prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel
>   prisma/schema.prisma --script`, y armar la carpeta de la migración a
>   mano. Ese diff propone además nueve `DROP INDEX *_trgm_idx` (los GIN de
>   `20260828120100`, que el DSL no modela) — se descartan, no son drift.
> - **Los enums se llaman `"QrType"`, `"QrSubscriptionStatus"` y
>   `"QrSubscriptionChangeSource"`** (Prisma conserva el nombre del DSL,
>   entre comillas). El bloque SQL del paso 3 entró tal cual: los literales
>   se castean solos al tipo de la columna.
> - **`QrCode.branch` lleva `onDelete: NoAction` explícito.** Prisma pone
>   `SET NULL` por defecto en una relación opcional, y la fila 14 del
>   diagnóstico (regla de `20260821140200`: columna referenciante nullable
>   → NO ACTION) lo habría rechazado en CI.
> - **El diagnóstico se actualiza en el mismo PR**, como cada vez que entra
>   una tabla con objetos manuales: `qr_codes` en la fila 5 (políticas RLS),
>   los tres CHECK en la fila 8, la FK compuesta en la fila 16, y los
>   contadores de `scripts/verify-schema.ts`. Sin eso, `verify:schema`
>   falla en CI por "política que sobra".
> - **El paso 4 se corrió como `npm run migrate:deploy`** (la variante
>   `deploy` que el paso ya contemplaba, más la reaplicación idempotente
>   del SQL manual — el flujo estándar del proyecto y del CI).

1. `cd` a `Plataforma CRM` y correr, para chequear sintaxis antes de generar
   nada (esta sesión no pudo correrlo — el sandbox no baja los engine
   binaries de Prisma, bloqueados por la política de egress):
   ```
   npx prisma format
   npx prisma validate
   ```
2. Generar la migración versionada **sin aplicarla todavía**
   (`--create-only` es la parte importante: `prisma migrate dev` sin ese
   flag generaría el archivo y lo aplicaría en el mismo paso, antes de que
   puedas agregarle el SQL manual del punto 3 — quedaría una migración
   aplicada e incompleta, y arreglarla exigiría una migración de más en vez
   de una sola limpia):
   ```
   npx prisma migrate dev --name qr_integration --create-only
   ```
   Esto crea `prisma/migrations/<timestamp>_qr_integration/migration.sql`
   con todo lo que el DSL de Prisma puede expresar (tablas, columnas, FKs,
   índices no parciales) — todavía sin tocar la base.
3. **Antes de aplicarla**, agregarle a mano el bloque de abajo al final de
   ese mismo archivo — mismo criterio que
   `20260821140000_incorporate_manual_ddl_into_migrations` (C-2) y
   `20260901120000_rls_booking_and_outbox_tables`: los CHECK constraints y
   las políticas RLS no viven en el DSL de Prisma, se escriben a mano en la
   migración versionada.

   ```sql
   -- ---------------------------------------------------------------------
   -- RLS — mismo patrón uniforme que el resto (ver
   -- prisma/sql/rls_policies.sql y 20260901120000_rls_booking_and_outbox_tables).
   -- ---------------------------------------------------------------------
   alter table public.qr_codes enable row level security;
   drop policy if exists qr_codes_isolation on public.qr_codes;
   create policy qr_codes_isolation on public.qr_codes
     for all
     using (organization_id = public.current_organization_id())
     with check (organization_id = public.current_organization_id());

   -- Tablas internas (D7/D8/D9/DEC-060 originales): ningún grant a
   -- anon/authenticated, ninguna policy — mismo criterio que el original
   -- (payment_events/platform_admins/subscription_status_changes/
   -- billing_exemption_changes tampoco la tenían). RLS habilitada igual,
   -- por la misma razón que 20260901120000 documenta: defensa en
   -- profundidad para el día que algo distinto de Express llegue a public.
   alter table public.qr_payment_events enable row level security;
   alter table public.qr_subscription_status_changes enable row level security;
   alter table public.qr_billing_exemption_changes enable row level security;
   alter table public.platform_admins enable row level security;

   -- ---------------------------------------------------------------------
   -- CHECK constraints — equivalentes exactos de los originales.
   -- ---------------------------------------------------------------------

   -- Original: qr_codes_name_destination_iff_claimed (0008_qr_own_destination.sql).
   -- Un QR Stock (branch_id null) no tiene nombre/destino; uno reclamado, sí.
   alter table public.qr_codes
     add constraint qr_codes_name_destination_iff_claimed
     check (
       (branch_id is null and name is null and destination_url is null)
       or
       (branch_id is not null and name is not null and destination_url is not null)
     );

   -- Original: qr_codes_used_at_only_single_use (0015_single_use_qr.sql).
   -- used_at solo tiene sentido para qr_type = SINGLE_USE.
   alter table public.qr_codes
     add constraint qr_codes_used_at_only_single_use
     check (used_at is null or qr_type = 'SINGLE_USE');

   -- Original: changed_by_only_for_platform_admin (0001_init.sql, adaptado a
   -- QrSubscriptionChangeSource). changed_by_platform_admin_id obligatorio
   -- sii source = PLATFORM_ADMIN.
   alter table public.qr_subscription_status_changes
     add constraint qr_subscription_status_changes_changed_by_only_for_admin
     check (
       (source = 'PLATFORM_ADMIN' and changed_by_platform_admin_id is not null)
       or
       (source = 'MERCADOPAGO_WEBHOOK' and changed_by_platform_admin_id is null)
     );
   ```

   Ojo con el nombre real de los enums en Postgres: Prisma va a crear
   `qr_type`/`QrSubscriptionStatus`/`QrSubscriptionChangeSource` (o el nombre
   que el DSL infiera) como tipos — confirmar el nombre exacto que generó el
   paso 2 antes de pegar el CHECK (los valores del enum sí quedan tal cual
   están escritos en el DSL: `'SINGLE_USE'`, `'PLATFORM_ADMIN'`, etc.).

4. Correr `npx prisma migrate dev` de nuevo (o `prisma migrate deploy` según
   el flujo que uses) para aplicar el archivo ya completo, y
   `scripts/apply-manual-sql.ts` si ese script también toca algo relevante
   acá (no debería — el nuevo contenido va en la migración versionada, no en
   `prisma/sql/*.sql`).
5. `npx prisma generate` para que el Prisma Client tipado incluya
   `QrCode`/`PaymentEvent`/etc. — recién ahí arranca la Fase 2.

## Dar de alta el primer platform admin

Igual que en el original (`Plataforma-QR/supabase/README.md`): no hay UI a
propósito. Acceso directo a la base:

```sql
insert into platform_admins (user_id) values ('<tu-user-id-de-auth.users>');
```

## Mapeo de modelos (referencia rápida)

| QR Reviews (original) | Plataforma CRM |
|---|---|
| `businesses` | eliminada — atributos de suscripción → `Organization` |
| `businesses.subscription_status`, `.mercadopago_subscription_id` | `Organization.qrSubscriptionStatus`, `.qrMercadopagoSubscriptionId` |
| `businesses.billing_exempt` | `Organization.qrBillingExempt` |
| `businesses.next_qr_display_number` | `Organization.nextQrDisplayNumber` |
| `qr_codes` | `QrCode` — `business_id` → `branchId` nullable (null = stock) |
| `payment_events` | `PaymentEvent` (tabla `qr_payment_events`) |
| `subscription_status_changes` | `QrSubscriptionStatusChange` |
| `billing_exemption_changes` | `QrBillingExemptionChange` |
| `platform_admins` | `PlatformAdmin` (misma tabla, sin scope por Organization) |

Cambio de comportamiento pendiente de decidir en Fase 2, no asumido en
silencio: `claim` pasa de "asociar a mi business" (1:1 implícito) a "asociar
a una Branch de mi Organization" (a elección del caller, validada).

## Fase 2 — Backend Express

Fuente de verdad del comportamiento: las funciones originales en
`Plataforma-QR/supabase/functions/{resolve,claim,mercadopago-webhook,
admin-set-subscription-status}/index.ts` y `_shared/{mercadopago,landing,
validation}.ts`, más las 15 migraciones (cada `security definer` function ahí
es la especificación de negocio de un endpoint acá). Este documento no repite
esa lógica línea a línea — dice a qué archivo Express va cada pieza, qué
cambia y por qué.

### Decisiones tomadas para esta fase (confirmadas con Rocco, no asumidas)

1. **Selección de Branch en `claim`.** El original asocia un QR a "mi
   business" (1:1 admin↔business). Acá un usuario ADMIN pertenece a una
   Organization con varias Branches, así que `claim` pasa a pedir
   `branchId` explícito en el body, validado contra la Organization del
   caller (mismo patrón que cualquier otro alta scoped a Branch —
   `resource`/`serviceType`).

2. **`claim` unifica su input con `digital`/`update`: pide `name` +
   `destinationUrl` (+ `message` opcional) explícitos.** Investigando
   `claim_qr_code` (0008_qr_own_destination.sql) apareció algo que el mapeo
   de Fase 1 no cubrió: el original copia nombre/destino desde
   `businesses.google_review_destination_url` (default fijo `'Reseñas
   Google'`) al reclamar un QR físico — un campo que nunca se portó a
   `Organization` (no existe en el schema ya mergeado de Fase 1).
   `create_digital_qr_code`/`update_qr_code`, en cambio, ya piden estos
   campos explícitos desde la misma migración. Se confirmó con Rocco cerrar
   la brecha unificando: `claim` pasa a pedir `name`/`destinationUrl`
   explícitos igual que `digital`, sin default de Google Reviews — no hace
   falta tocar de nuevo el schema de Fase 1, y encaja mejor con el plan de
   reusar este motor para otros verticales (Turnos, Gastronomía,
   Inmobiliaria) donde "Google Reviews" no es el único destino posible.

3. **`delete_own_account` queda fuera de esta fase.** El original borra el
   business completo del caller (todas sus filas QR) y su fila de
   `auth.users`. Portarlo tal cual acá borraría la **Organization entera**
   (companies, contacts, opportunities, bookings — todo el CRM de esa
   cuenta), muchísimo más alcance que el módulo QR. Se confirmó con Rocco:
   no hay endpoint equivalente hoy en el CRM (`user.routes.ts` solo tiene
   `DELETE /users/:id` ADMIN-only, para borrar a OTRO usuario, no
   autoservicio de la propia cuenta) — queda documentado como pendiente,
   fuera de este plan, no como un olvido.

4. **Hallazgo no bloqueante, flag para revisión en el PR: `QrCode` no tiene
   un verdadero "stock físico anónimo".** En el original, `qr_codes` es un
   pool global de filas sin dueño (`business_id null`) pre-insertadas a
   mano antes de imprimir una tanda de stickers; `claim_qr_code` hace
   `UPDATE ... WHERE id = :id AND business_id IS NULL`. En el schema ya
   mergeado de Fase 1, `QrCode.organizationId` es **NOT NULL** (`branchId`
   es el nullable) — siguiendo la convención general del repo de que toda
   fila tenant-scoped tiene `organizationId` obligatorio. Eso significa que
   ya no existe una fila "sin dueño de ninguna organización": no hay dónde
   insertar el stock antes de saber a qué cuenta va a terminar
   perteneciendo.

   Resolución propuesta para esta fase, sin tocar de nuevo el schema:
   `claim` de un QR físico deja de ser un `UPDATE` sobre una fila
   preexistente y pasa a ser un **`INSERT`** con el `id` que ya viene
   impreso en el sticker (el mismo `id` que hoy se pre-inserta a mano en el
   original) — la fila nace recién en el momento del claim, ya con
   `organizationId`/`branchId` puestos, y falla si ese `id` ya existe (ya
   claimeado). No pierde ninguna garantía de seguridad: un id no
   reclamado sigue sin tener fila, y `resolve` sobre un id sin fila
   responde exactamente igual que hoy ("not found" — DEC-007). Sí cambia
   el proceso operativo: en vez de correr SQL manual para precargar una
   tanda de stock antes de imprimir, los ids de la tanda se generan offline
   (`uuidgen` o similar) y la fila se crea sola en el primer claim — un
   paso manual menos, no uno de más. Documentado acá para que quede a la
   vista en el PR; no bloqueó la escritura de esta guía porque no exige
   otra migración, pero Rocco puede pedir el modelo viejo (agregar
   `organizationId` nullable) si prefiere preservar el pool pre-insertado
   tal cual.

5. **Alcance de esta fase se extiende a `update_qr_code`/`delete_qr_code`/
   listar QRs**, que el plan original no mencionaba explícitamente en la
   lista corta de 4 funciones. Están en 0008 igual que `claim`/`digital`, y
   la Fase 3 (Dashboard) no tiene nada que mostrar/editar/borrar sin ellos
   — se investigaron igual que el resto porque el plan pide revisar las 15
   migraciones como especificación, no solo los 4 nombres originales.

### Endpoints

Convención de prefijo: `/api` es para la API de negocio autenticada (igual
que el resto del repo); las rutas públicas de resolución de QR NO llevan
`/api` (misma excepción que `/health` — no son JSON de negocio, un teléfono
las abre directo desde la cámara). El webhook de MercadoPago tampoco lleva
`/api`, y se monta ANTES del `express.json()` global, mismo motivo exacto
que `ingestRouter` (ver comentario de `app.ts`): necesita verificar la firma
sobre el body crudo antes de confiar en nada parseado, y un
`express.json()` global corrido antes dejaría el stream ya consumido.

#### Públicos, sin auth — `src/routes/qrPublic.routes.ts`

**`GET /qr/resolve/:qrId`** — puerto de `resolve/index.ts` método GET.
Sin `X-Internal-Proxy-Secret` (esa gate era específica del Worker de
Cloudflare — decisión de Fase 4, todavía abierta; no hay Worker apuntando
acá todavía, así que no hay nada que autenticar en este tramo). `qrId` no
UUID → misma respuesta que "no encontrado" (nunca 400, nunca revela por qué
— DEC-007). Resuelve vía Prisma (reemplaza `get_qr_public_state`/
`get_qr_redirect_target`):
  - No existe fila `QrCode` con ese id → landing (`buildLandingHtml`, sin
    `claimUrl` — no tiene sentido ofrecer reclamar un id que no existe).
  - Existe, `branchId` es null → **no debería poder pasar** con el modelo
    de la decisión 4 (una fila solo existe ya reclamada) — tratar como "no
    existe" de todas formas, nunca un 500, por si el modelo viejo (stock
    pre-insertado) termina siendo el elegido.
  - `deletedAt` no nulo → landing, igual que "no encontrado" (DEC-007).
  - `qrType = SINGLE_USE` y `usedAt` no nulo → `singleUseUsedResponse` (la
    única excepción a DEC-007 — "ya usado" no es información sensible).
  - `qrType = SINGLE_USE` y `usedAt` nulo → si la Organization dueña no
    está activa (`qrSubscriptionStatus = INACTIVE` y `qrBillingExempt =
    false`) → landing genérica (igual que reusable inactivo, NO el caso
    "ya usado"); si está activa → `singleUseConfirmResponse` (la página con
    el botón "Continuar", sin consumir nada todavía — el GET nunca
    escribe).
  - `qrType = REUSABLE` → activa → redirect 302 a `destinationUrl`;
    inactiva → landing genérica.

**`POST /qr/resolve/:qrId`** — puerto de `resolve/index.ts` método POST
(consumo de single-use). Body vacío, sin JSON — es un `<form method="POST">`
real sin JavaScript (mismo motivo que el original: el consumo nunca depende
de un fetch privilegiado del lado del cliente). Consumo atómico equivalente
a `consume_single_use_qr()`: una única `UPDATE QrCode SET usedAt = now()
WHERE id = :id AND qrType = 'SINGLE_USE' AND usedAt IS NULL AND deletedAt IS
NULL AND <organization activa o billing_exempt>` (join/subquery contra
`Organization`), chequeando `rowCount`. Si actualizó 1 fila → redirect 302 a
`destinationUrl`. Si actualizó 0 → recalcular el estado real (mismo camino
que el GET) y renderizar la respuesta que corresponda — nunca asumir "ya
usado" solo porque el UPDATE no pegó, exactamente como en el original.

`src/utils/qrLanding.ts` — puerto directo de `_shared/landing.ts`:
`buildLandingHtml`, `buildSingleUseConfirmHtml`, `buildSingleUseUsedHtml`
devolviendo `string`; los controllers hacen
`res.status(x).type("html").send(html)` en vez de `new Response(...)` (Deno
→ Express). Mismo `escapeHtml`, mismo shell visual, mismo copy (incluida la
nota "copy provisional, pendiente de una pasada de Design" — no inventar
copy nuevo). El link "¿Sos el dueño...?" usa una env var nueva
`QR_CLAIM_APP_URL` (opcional, igual que `ADMIN_APP_URL` original) que hoy no
apunta a ningún lado — se completa en Fase 3 cuando el módulo QR del
frontend tenga una ruta de claim real; hasta entonces, sin la env var
seteada, el link simplemente no se renderiza (mismo comportamiento que hoy
con `ADMIN_APP_URL` ausente).

#### Autenticados, ADMIN — `src/routes/qr.routes.ts`, montado en `/api`

Mismo criterio que `branchRouter`/`resourceRouter`: `authenticate` para
leer, `authenticate` + `businessWriteRateLimiter` + `authorize("ADMIN")`
para escribir.

- **`POST /api/qr/claim`** `{ qrId: uuid, branchId: uuid, name: string,
  destinationUrl: string, message?: string }` — valida `branchId`
  pertenece a `req.auth.organizationId` (404/403 genérico si no, mismo
  criterio que el resto del repo — nunca confirmar existencia de una Branch
  ajena). Transacción: incrementa `Organization.nextQrDisplayNumber` (con
  lock, `SELECT ... FOR UPDATE` vía `$queryRaw` o
  `Prisma.sql`/`SERIALIZABLE`, mismo problema de concurrencia que
  `next_qr_display_number` original) y crea/reclama el `QrCode` (ver
  decisión 4 — `INSERT`, no `UPDATE`) con `displayNumber` = el valor
  incrementado. `id` ya reclamado → 409 (`"QR ya reclamado o no existe"`,
  mismo mensaje genérico que el original — no distinguir "ya reclamado" de
  "no es un id válido de stock" en el mensaje, aunque acá con el modelo de
  INSERT esa segunda categoría deja de existir). Validación de
  `destinationUrl` (`http(s)://`, máx 2048) y `name` (máx 80)/`message`
  (máx 500) igual que `create_digital_qr_code`/`update_qr_code` originales,
  con Zod en vez de los `if` a mano de plpgsql.

- **`POST /api/qr/digital`** `{ branchId: uuid, name: string,
  destinationUrl: string, message?: string }` — igual que `claim` pero
  `id` se genera (`gen_random_uuid()`, default de Prisma) en vez de venir
  del caller. Misma transacción de `nextQrDisplayNumber`, misma validación.

- **`GET /api/qr?branchId=`** — lista los `QrCode` de la Organization
  (`branchId` opcional para filtrar una sucursal), `deletedAt IS NULL` por
  default. No tiene equivalente directo en el original (el Dashboard leía
  la tabla directo vía PostgREST/RLS) — necesario para Fase 3.

- **`PATCH /api/qr/:id`** `{ name?, destinationUrl?, message? }` — puerto
  de `update_qr_code`. Re-verifica que el `QrCode` pertenezca a la
  Organization del caller (nunca confía en un `organizationId` del body —
  no lo pide). "No existe" / "no es tuyo" / "está borrado" → mismo 404
  genérico (anti-enumeración, igual que el original).

- **`DELETE /api/qr/:id`** — puerto de `delete_qr_code`. Soft delete
  (`deletedAt = now()`), nunca borra `name`/`destinationUrl`/
  `displayNumber`. Mismo 404 genérico que PATCH.

#### Webhook — `src/routes/qrWebhook.routes.ts`, montado en `app.ts` ANTES de `express.json()`

**`POST /webhooks/mercadopago`** — puerto de `mercadopago-webhook/index.ts`
+ `_shared/mercadopago.ts`. Trae su propio `express.json({ limit })` igual
que `ingestRouter` (ver `middlewares/ingestBody.ts` como referencia de
"traducir errores de body-parser a 4xx en vez del 500 de `errorHandler`").

Orden exacto (igual al original, no reordenar — cada paso corta antes del
siguiente si falla):
1. Leer `x-signature`, `x-request-id`, `data.id`/`id` (query param).
2. Verificar firma HMAC-SHA256 + frescura del `ts` (puerto 1:1 de
   `verifyMercadoPagoSignature`/`isTimestampFresh` a
   `src/utils/mercadopagoSignature.ts` — usa Node `crypto.createHmac` en
   vez de `crypto.subtle`, mismo algoritmo). Firma inválida o vencida →
   401, **sin leer el body todavía** (mismo orden que el original: la
   firma se calcula sobre `id`/`request-id`/`ts`, no sobre el body).
3. Parsear body JSON. `type !== "subscription_preapproval"` → 200
   `{ ok: true, ignored: true }` (no-op intencional, firmado mal ≠ evento
   que no importa).
4. `extractNotificationId(body)` — el id de la notificación en sí
   (`body.id`), NUNCA `dataId` (mismo bug que TF-005 documentó en el
   original: dos transiciones de estado distintas comparten `dataId`, así
   que idempotencia keyed por `dataId` perdería la segunda).
5. Re-fetch `GET https://api.mercadopago.com/preapproval/:dataId` con
   `MERCADOPAGO_ACCESS_TOKEN` (nunca confiar en el `status` del payload del
   webhook — mismo motivo que el original cita).
6. Mapear `preapproval.status` → `ACTIVE`/`INACTIVE`
   (`mapPreapprovalStatus`, mismos sets `authorized` → active,
   `cancelled`/`paused` → inactive; cualquier otro → 200 ignored).
7. Buscar `Organization` por `qrMercadopagoSubscriptionId = preapproval.id`
   — no encontrada → 200 `{ ok: true, ignored: true }` (no-op, nunca 404 —
   esto lo llama MercadoPago, no un cliente nuestro).
8. Transacción: crear `PaymentEvent` (`mercadopagoEventId` = el
   `notificationId` del paso 4, `UNIQUE` — el índice único es la barrera de
   idempotencia real, igual que el original) + actualizar
   `Organization.qrSubscriptionStatus` + insertar
   `QrSubscriptionStatusChange` (`source = MERCADOPAGO_WEBHOOK`,
   `changedByPlatformAdminId = null` — el CHECK de Fase 1
   `qr_subscription_status_changes_changed_by_only_for_admin` ya exige
   exactamente esto). Violación de unicidad en `mercadopagoEventId` → 200
   `{ ok: true, duplicate: true }` (reintento esperado de MercadoPago, no
   un error — mismo criterio que el original, capturar el código de
   Postgres `23505` igual que `services/*.ts` ya hace en otros lados del
   repo para violaciones de unique).

Env vars nuevas: `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`
(agregar a `config/env.ts`, opcionales igual que `SECRET_ENCRYPTION_KEY` —
el server tiene que poder arrancar sin ellas, fallar recién si llega un
webhook real sin configurar).

#### Platform admin — nuevo middleware `src/middlewares/requirePlatformAdmin.ts`

`authorize()` solo conoce `ADMIN`/`USER`, roles **dentro de una
Organization** — no sirve acá: un `PlatformAdmin` es global (es Rocco, el
operador de la plataforma), no necesariamente `ADMIN` de la Organization
sobre la que está actuando, ni siquiera necesariamente parte de ella. Nuevo
middleware, después de `authenticate`, que resuelve
`prisma.platformAdmin.findUnique({ where: { userId: req.auth.userId } })` y
lanza `AppError(403)` si no existe — mismo criterio async que `authenticate`
(usa `asyncHandler`), mismo mensaje genérico ("No tenés permisos...") que
`authorize`. Alta de la primera fila: sigue siendo manual por SQL directo,
sin write path de aplicación — igual que el original (ver sección "Dar de
alta el primer platform admin" arriba).

- **`POST /api/admin/organizations/:organizationId/qr-subscription-status`**
  `{ newStatus: "ACTIVE" | "INACTIVE", reason?: string }` — puerto de
  `admin-set-subscription-status`. `authenticate` +
  `requirePlatformAdmin` (NO `authorize("ADMIN")` — deliberado, ver
  arriba). Actualiza `Organization.qrSubscriptionStatus` + inserta
  `QrSubscriptionStatusChange` (`source = PLATFORM_ADMIN`,
  `changedByPlatformAdminId = req.auth.userId`, obligatorio por el CHECK).
  `organizationId` no existe → 404.

- **`POST /api/admin/organizations/:organizationId/qr-billing-exemption`**
  `{ newValue: boolean, reason: string }` — puerto de
  `set_billing_exemption` (0004_billing_exemption.sql), que el plan
  original no había listado explícitamente pero que sí tiene su propia
  tabla de auditoría ya migrada en Fase 1 (`QrBillingExemptionChange`) —
  sin este endpoint esa tabla queda muerta. Misma gate
  `requirePlatformAdmin`. `reason` es **obligatorio y no vacío** (a
  diferencia del endpoint de arriba, donde es opcional) — mismo criterio
  que el original: acá no existe un "source = webhook", cada fila es
  siempre una acción manual de un platform admin, así que siempre tiene
  que quedar dicho el motivo.

### Verificación

Mismo criterio que Fase 1 y que el resto del repo — tests reescritos como
tests del backend Express, corridos con `npm test`, cubriendo lo que
`Plataforma-QR/supabase/functions/*/index.test.ts` y
`Plataforma-QR/supabase/tests/integration/rls_and_authorization.test.ts` ya
prueban del lado original:

- `resolve`: los 6 casos de estado del árbol de arriba (no encontrado,
  borrado, reusable activo/inactivo, single-use no-usado activo/inactivo,
  single-use ya usado) para GET; consumo atómico + fallback a lectura real
  para POST (incluido el caso "dos POST concurrentes al mismo single-use,
  solo uno consume" — mismo tipo de test de carrera que
  `create_digital_qr_code`/`claim_qr_code` ya tienen del lado Postgres
  original vía el row lock).
- `claim`/`digital`: aislamiento entre Organizations (no se puede reclamar
  para una Branch ajena), `nextQrDisplayNumber` se incrementa una vez por
  claim sin duplicar bajo concurrencia, validación de `destinationUrl`/
  `name`/`message`.
- `update`/`delete`: anti-enumeración (ajeno/borrado/inexistente → mismo
  404).
- Webhook: firma inválida → 401 sin tocar la base; idempotencia real (el
  mismo `notificationId` dos veces → la segunda es no-op, nunca dos
  `QrSubscriptionStatusChange`); `TF-005` — dos notificaciones con el mismo
  `dataId` pero distinto `id` de notificación se procesan ambas.
- Admin endpoints: `requirePlatformAdmin` rechaza a un `ADMIN` de
  Organization común; CHECK de `changedByPlatformAdminId` respetado en
  ambas tablas de auditoría.
- `npm run verify:schema` sigue en verde (esta fase no toca el esquema).

### Pasos de aplicación

1. Nuevo worktree limpio, mismo patrón que Fase 1 (no reusar
   `plataforma-crm-qr-integration` a ciegas — confirmar primero que
   `origin/master` ya tiene el merge de PR #134):
   ```
   cd "U:/Proyectos/Plataforma CRM"
   git fetch origin
   git worktree add ../plataforma-crm-qr-integration-fase2 -b feat/qr-integration-fase2 origin/master
   cd ../plataforma-crm-qr-integration-fase2
   git log --oneline -3
   git log --oneline origin/master..HEAD   # tiene que salir vacío
   ```
2. Confirmar que `schema.prisma` en este worktree ya tiene `QrCode`/
   `PaymentEvent`/etc. (fue lo que mergeó PR #134) y correr
   `npx prisma generate` para asegurarse de que el Prisma Client local
   tipa los modelos nuevos antes de escribir código contra ellos.
3. Implementar en el orden: `qrLanding.ts` → `qrPublic.routes.ts`/
   `.controller.ts`/`.service.ts` (resolve) → `mercadopagoSignature.ts` →
   `qrWebhook.routes.ts` (webhook) → `qr.routes.ts`/`.controller.ts`/
   `.service.ts` (claim/digital/list/update/delete) →
   `requirePlatformAdmin.ts` → endpoints de platform admin. Montar cada
   router nuevo en `src/routes/index.ts` (los de `/api`) y en `src/app.ts`
   (el webhook, antes de `express.json()` — igual que `ingestRouter`, con
   el mismo comentario explicando por qué el orden importa).
4. Agregar `MERCADOPAGO_WEBHOOK_SECRET`/`MERCADOPAGO_ACCESS_TOKEN`/
   `QR_CLAIM_APP_URL` a `config/env.ts` (opcionales) y a `.env.example` si
   el repo tiene uno.
5. Tests (ver "Verificación" arriba), `npm run typecheck`, `npm run lint`,
   `npx prettier --check .`.
6. Actualizar este documento: tildar Fase 2 en el checklist de "Estado" y
   dejar la misma clase de nota de "qué se desvió del plan y por qué" que
   tiene la sección de Fase 1, si algo cambió al implementar.
7. `gh pr create` — nunca mergear. Igual que Fase 1, la verificación y el
   merge quedan para después de que se revise el PR real.

### Qué se desvió del plan al implementar Fase 2 (2026-09-03)

Mismo criterio que la nota de Fase 1: lo que cambió al ejecutar, con el
porqué, para que quede a la vista en el PR.

- **`POST /api/qr/digital` acepta `qrType` (`REUSABLE` | `SINGLE_USE`,
  default `REUSABLE`).** El contrato de la guía no lo listaba, pero
  `create_digital_qr_code` del original lo tiene desde 0015 (`p_qr_type`) y
  es el ÚNICO camino por el que puede nacer un single-use — sin él, todo el
  árbol de single-use del endpoint de `resolve` (que la guía sí especifica
  completo) sería código muerto. `claim` NO lo acepta: un QR físico es
  siempre `REUSABLE`, igual que en el original (el single-use físico sigue
  fuera de alcance, pendiente de su propia decisión — 0015, encabezado).
- **`claim` y `digital` toman `lockOrganizationForUpdate` además del
  INSERT.** La guía lo dejaba a elección ("`SELECT ... FOR UPDATE` vía
  `$queryRaw` o `SERIALIZABLE`"); se usó el lock de fila que el repo ya
  tiene (B-17) porque es el mismo `select ... for update` sobre el business
  que hacía 0006, y porque el schema de Fase 1 no trajo el
  `UNIQUE (organization_id, display_number)` ni el CHECK
  `display_number iff claimed` del original — sin el lock, dos claims
  concurrentes del mismo tenant podrían repartir el mismo número sin que
  nada lo rechace. El test de carrera real (`carreras.test-helper`) lo
  afirma. Traer esas dos constraints al schema queda como candidato para
  una migración chica posterior, no bloquea nada hoy.
- **La sucursal ajena responde 400, no 404/403.** La guía decía "404/403
  genérico, mismo criterio que el resto del repo"; el criterio real del
  repo para ese caso es `validateBranchId` en `resource.service.ts`:
  `AppError(400, "La sucursal indicada no existe o no pertenece a tu
  organización")`. Se reusó ese mismo mensaje y ese mismo status — nunca
  se confirma que la sucursal exista.
- **`PATCH /api/qr/:id` es parcial de verdad.** `update_qr_code` del
  original exigía `name` y `destination_url` siempre (era un reemplazo
  completo). Acá cada campo es opcional, se exige al menos uno, y
  `message: null` lo vacía explícitamente — misma semántica que el resto
  de los PATCH del repo (M-10).
- **El webhook usa `data.id` o `id` del query, y exige `application/json`
  con 400 explícito.** Lo segundo no estaba en el original (Deno hacía
  `req.json()` y fallaba con 400 ante cualquier cosa): con body-parser, un
  Content-Type distinto dejaría un `req.body` vacío en silencio y el
  handler contestaría `200 ignored` a un request malformado. El 400
  explícito es lo que evita mentirle a MercadoPago.
- **`fetchPreapproval` valida la forma de la respuesta** (`id` y `status`
  strings) antes de usarla; el original la casteaba. Un 502 solo cuando
  el fallo fue el re-fetch a MercadoPago; todo lo demás sigue al
  `errorHandler`.
- **Los tests de platform admin no pasan por Supabase Auth.** La app de
  test reemplaza `authenticate` por un stub que pone `req.auth`; lo que se
  prueba es `requirePlatformAdmin` (contra `platform_admins` real) y los
  services. La verificación de JWT ya la cubren `me.controller` y
  `rateLimit.integration-test` — no se duplica.
- **Se trabajó en el worktree `plataforma-crm-qr-integration-fase2`** que
  el paso 1 ya había creado (existía, limpio, en `origin/master` con PR
  #136 incluido), con `.env` copiado y `npm ci` propio.

Lo que NO cambió y conviene tener presente al revisar:

- Los mensajes de error hacia el cliente son en español, como el resto del
  repo, aunque el original los tuviera en inglés ("QR already claimed or
  does not exist" → "QR ya reclamado o no existe").
- `QR_CLAIM_APP_URL` sigue sin valor: el link "¿Sos el dueño...?" no se
  renderiza hasta Fase 3.
- El mapeo de estados de MercadoPago (`authorized` → ACTIVE, `cancelled` /
  `paused` → INACTIVE) es el supuesto heredado del original, todavía no
  verificado contra un sandbox real.

## Fase 3 — Frontend

Fuente de verdad del comportamiento: `Plataforma-QR/admin/src/pages/{Dashboard,Claim}.tsx`
y `admin/src/lib/{qrImage,sendQr,publicUrl,validation}.ts`. Fuente de verdad
del contrato: los endpoints ya mergeados de Fase 2
(`src/routes/{qrPublic,qr,qrAdmin}.routes.ts` y sus controllers/services) —
esta guía no repite ese contrato, dice qué pantalla/archivo del frontend
llama a cada endpoint y qué cambia respecto al original.

Rocco todavía no hizo el rediseño del frontend (aclarado explícitamente al
retomar esta fase). Esta guía asume la decisión ya tomada con él: portar el
módulo **funcional, completo, usando el design-system actual del CRM**
(`Button`/`Modal`/`Table`/`FormField`/`Pagination`/`EmptyState`/`ErrorState`/
`LoadingState`), sin replicar el look visual de `Plataforma-QR/admin` y sin
inventar un estilo nuevo. Cuando el rediseño exista, se re-skinnea la
presentación sin tocar `api.ts`/`queries.ts`/`mutations.ts` — esa es la
razón de separar tan estrictamente datos y presentación en el plan de
archivos de abajo.

### Decisiones tomadas para esta fase (confirmadas con Rocco, no asumidas)

1. **Funcional ahora, con el design-system actual — no con el look del
   original ni con un diseño nuevo.** Ver arriba.

2. **Alcance explícitamente excluido, con motivo:**
   - El formulario de "nombre de negocio + URL de destino global" de
     `Dashboard.tsx` no se porta: ese concepto vivía en `businesses`, que
     Fase 1 eliminó — cada `QrCode` ya tiene su propio `destinationUrl`
     desde Fase 2 (decisión #2 de esa fase), no hay un default a nivel
     cuenta que editar.
   - "Eliminar cuenta" no se porta — mismo motivo que la decisión #3 de
     Fase 2 (no existe el endpoint, y no debería: borraría la Organization
     entera, no solo el módulo QR).
   - No hay pantalla de platform admin (subscription-status /
     billing-exemption). Esos dos endpoints (`requirePlatformAdmin`) siguen
     operándose como hoy — a mano, con `curl`/Postman autenticado como
     Rocco — hasta que exista una necesidad real de UI para eso.
   - **No se muestra el estado de suscripción de la propia Organization en
     ninguna pantalla.** Ningún endpoint de Fase 2 expone
     `Organization.qrSubscriptionStatus`/`qrBillingExempt` de lectura para
     un `ADMIN` común (todo lo que toca esos campos vive detrás de
     `requirePlatformAdmin`) — agregar ese endpoint de lectura es un
     cambio de contrato que no estaba en el plan de Fase 2 y queda fuera de
     esta fase, documentado, misma clase de gap que el punto 3 de la nota
     de desvíos de Fase 2 (no es un olvido).

3. **Ruta de claim fija e innegociable: `/claim/:qrId`.** La arma
   `buildLandingHtml` (`src/utils/qrLanding.ts`, ya mergeado) con
   `` `${QR_CLAIM_APP_URL}/claim/${qrId}` ``. Cualquier otro path rompe
   todos los QR de stock físico ya impresos (si los hay) apenas
   `QR_CLAIM_APP_URL` se configure.

4. **`Claim` deja de ser "confirmar con un botón".** El original
   (`Claim.tsx`) llama a una función que solo pide `qr_id`, porque el resto
   salía por default de `businesses`. El contrato real de Fase 2
   (`POST /api/qr/claim`) pide `branchId` + `name` + `destinationUrl` (+
   `message` opcional) explícitos — mismo shape que crear un QR digital.
   La página nueva es un formulario completo (con `BranchSelect`, ver
   punto 5), no un botón de confirmar.

5. **`features/branch` nuevo, deliberadamente mínimo.** No existe ninguna
   feature de Branch en el frontend hoy (`branch.controller.ts` no tiene
   consumidor todavía). Se agrega solo `api.ts` (un `listBranches` sobre
   `GET /api/branches`) + `queries.ts` (`useBranches`) + `types.ts` +
   `BranchSelect.tsx` — mismo patrón exacto que `UserSelect.tsx` (select
   simple sin búsqueda, `pageSize` al máximo del contrato, sin manejo de
   más de 100 sucursales — mismo riesgo residual documentado que ese
   componente). **No** se agrega `BranchListPage`/`BranchFormPage`/
   `mutations.ts` — CRUD de sucursales completo es un feature aparte, fuera
   de este plan, si Rocco lo pide después.

6. **`lib/publicUrl.ts` se simplifica al portar, no se porta literal.**
   Original: `buildPublicResolutionUrl(domain, qrId)` = `${domain}/r/${qrId}`,
   con `domain` viniendo de una env var propia del admin (el Edge Function
   vivía en un dominio distinto al admin). Acá `qrPublicRouter` está montado
   en el mismo Express app que el resto del API — no hace falta ninguna env
   var nueva del lado del frontend. Nueva función:
   `buildPublicResolutionUrl(qrId) = \`${env.apiUrl}/qr/resolve/${qrId}\``,
   reusando `env.apiUrl` (`frontend/src/config/env.ts`) tal cual. Ojo:
   `env.apiUrl` es la base de la API (`/api` se agrega dentro de
   `lib/api.ts`'s `buildUrl()`), y `/qr/resolve/:qrId` está montado **sin**
   `/api` (ver Fase 2) — esta función arma la URL directo sobre `env.apiUrl`,
   sin pasar por `request()`/`buildUrl()`.

7. **Qué pasa si alguien escanea un QR de stock sin sesión iniciada —
   verificar al implementar, no resuelto en esta guía.** `ProtectedRoute`
   hoy redirige a login a cualquiera sin sesión; hay que confirmar en el
   código real si preserva la URL de origen para volver ahí después de
   loguearse. Si no la preserva, `/claim/:qrId` se pierde en el camino y el
   usuario vuelve a una pantalla genérica sin el `qrId` — en ese caso hay
   que decidir un mecanismo (ej. guardar el `qrId` en `sessionStorage`
   antes de que `ProtectedRoute` redirija, o agregar el `state` de retorno
   si `ProtectedRoute` ya soporta ese patrón para otras rutas). Se deja
   como ítem a resolver en el PR real, con la misma lógica que los puntos
   "flag para revisión" de Fase 2: no bloquea escribir el resto del código,
   pero hay que decidirlo antes de mergear.

8. **El chequeo de rol ADMIN en `/claim/:qrId` es interno a la página, no a
   nivel de ruta.** `AdminRoute` (route-level) redirige a un USER no-ADMIN
   antes de que la página cargue — eso perdería el `qrId` de la URL de la
   misma forma que el punto 7. En cambio, `ClaimPage` se monta dentro de
   `ProtectedRoute` (fuera de `AdminRoute`) y hace el chequeo de
   `useAuth().me.role === "ADMIN"` ella misma: si no es ADMIN, muestra un
   mensaje claro ("Necesitás iniciar sesión como administrador de tu cuenta
   para reclamar este QR") en vez de perder el contexto. El backend igual
   rechaza con 403 si alguien se salta este chequeo (`authorize("ADMIN")`
   en `POST /api/qr/claim`, Fase 2) — el chequeo del frontend es solo para
   no mostrarle un formulario inútil a quien no puede usarlo.

### Plan de archivos

**Nuevo — `frontend/src/features/branch/`** (solo lectura, ver decisión 5):
`types.ts`, `api.ts` (`listBranches`), `queries.ts` (`useBranches`),
`BranchSelect.tsx`.

**Nuevo — `frontend/src/features/qr/`** (mismo patrón que `company`/
`apiKey`):
- `types.ts` — `QrCode`, `QrCodeListQuery`, `QrCodeListResponse`,
  `CreateDigitalQrInput`, `ClaimQrInput`, `UpdateQrInput`. Campos de
  `QrCode` esperables por el modelo Prisma ya mergeado en Fase 1 (`id`,
  `organizationId`, `branchId` nullable, `name`, `destinationUrl`,
  `message` nullable, `qrType`, `displayNumber`, `claimedAt` nullable,
  `usedAt` nullable, `createdAt`, `updatedAt`) — **confirmar contra
  `qr.controller.ts`/`qr.service.ts` reales cuáles de estos campos
  serializa el JSON de cada endpoint** antes de tipar en firme (mismo
  criterio que el resto de este documento: la guía orienta, el código
  mergeado de Fase 2 es la fuente de verdad final).
- `api.ts` — `listQrCodes` (`GET /api/qr`), `createDigitalQrCode`
  (`POST /api/qr/digital`), `updateQrCode` (`PATCH /api/qr/:id`),
  `deleteQrCode` (`DELETE /api/qr/:id`), `claimQrCode`
  (`POST /api/qr/claim`) — mismo `request()`/`getAccessToken` que
  `company/api.ts`, nada de cliente Supabase directo.
- `queries.ts` — `qrKeys` (factory `all/lists/list(query)`), `useQrCodes`.
- `mutations.ts` — `useCreateDigitalQrCode`, `useUpdateQrCode`,
  `useDeleteQrCode`, `useClaimQrCode` — invalidando `qrKeys.lists()` en
  `onSuccess`, mismo patrón que `company/mutations.ts`.
- `QrListPage.tsx` — tabla (`Table` del design-system): número de display,
  nombre, sucursal, estado derivado, destino, tipo, acciones. Estado
  derivado en el propio componente (sin campo nuevo en el backend): sin
  `claimedAt` → "Sin reclamar"; con `claimedAt`, `qrType === "SINGLE_USE"`
  y `usedAt` → "Usado"; si no, "Activo". Botón "Generar QR digital" abre
  `QrFormPage` en modo creación (o navega a una ruta `/qr/new`, según
  convención real de `company` — confirmar si usa modal o ruta propia al
  implementar). Acciones por fila: Editar, Eliminar (confirmación, mismo
  patrón que `company`), Ver imagen (`QrImageDialog`), Enviar
  (`QrSendDialog`), Copiar link (usa `buildPublicResolutionUrl`,
  `navigator.clipboard.writeText`, sin mutación — no hay llamada de red).
  `Pagination`/`EmptyState`/`ErrorState`/`LoadingState` igual que
  `CompanyListPage`.
- `QrFormPage.tsx` — crear y editar en un componente, mismo patrón que
  `CompanyFormPage` (`useFormDraft`, `toFormValues`/`toInput`). Crear:
  `BranchSelect` + `name` + `destinationUrl` + `message` opcional +
  `qrType` (radio `REUSABLE`/`SINGLE_USE`, default `REUSABLE` — mismo
  default que el backend). Editar: sin `BranchSelect` ni `qrType`
  (inmutables tras la creación — ninguno de los dos aparece en la nota de
  desvíos de Fase 2 como aceptado por `PATCH`), solo `name`/
  `destinationUrl`/`message`.
- `QrImageDialog.tsx` — `Modal` que genera la imagen client-side (ver
  `lib/qrImage.ts` portado) a partir de la URL pública
  (`buildPublicResolutionUrl`) y el `message` del QR, con botón de
  descarga (`downloadSvg`). Sin mutación de TanStack Query — es una
  transformación pura de datos que ya están en caché de `useQrCodes`, así
  que el hallazgo S2-4 (`.reset()` de `apiKey`) no aplica directo acá; si
  en algún momento se agrega una llamada de red propia a este diálogo,
  revisar ese hallazgo antes de reusar el patrón.
- `QrSendDialog.tsx` — `Modal` con las opciones de `lib/sendQr.ts`
  portado (WhatsApp/email), mismo criterio que arriba: sin red, sin
  mutación.
- `ClaimPage.tsx` — ver decisiones 4, 7 y 8. Reusa `BranchSelect` y
  `useClaimQrCode`. Ubicación: seguir la convención real ya usada por
  otras páginas montadas fuera de un feature CRUD (páginas públicas como
  login) si existe una carpeta común para eso; si no hay ninguna,
  `features/qr/ClaimPage.tsx` reusando `features/qr/api.ts` es aceptable.

**Portado con cambios mínimos — `frontend/src/lib/`:**
- `qrImage.ts` — `generateQrSvg`/`composeQrImage`/`downloadSvg` tal cual el
  original. Requiere agregar `qrcode` a `frontend/package.json`
  (+ `@types/qrcode` si el paquete no trae tipos propios).
- `sendQr.ts` — `normalizeWhatsAppNumber`/`buildWhatsAppLink`/
  `buildMailtoLink`/`buildEmailMessageForCopy`/`openPreparedMessage` tal
  cual.
- `publicUrl.ts` — reescrito, ver decisión 6. `looksLikeUrl` de
  `validation.ts` se reusa si `QrFormPage` valida `destinationUrl` en el
  cliente antes de enviar (además de la validación del backend).

**Wiring:**
- `app/router.tsx` — agregar `/claim/:qrId` dentro del árbol de
  `ProtectedRoute` (fuera de `AdminRoute`, ver decisión 8); agregar
  `/qr` (lista) y lo que corresponda para crear/editar dentro del árbol
  `ProtectedRoute > AppLayout > AdminRoute` (alta de QR es `authorize("ADMIN")`
  en el backend — mismo nivel que `company`/`apiKey`).
- `layout/AppLayout.tsx` — agregar el link de nav "QR" al lado de los
  existentes.

### Verificación

- `BranchSelect` lista solo sucursales de la propia Organization (mismo
  aislamiento que `UserSelect`, ya lo garantiza el backend).
- `QrFormPage` en creación: falta `name`/`destinationUrl` → error de
  validación en el cliente antes de pegarle al backend; el mensaje de
  error del backend (400) se muestra si igual se envía inválido.
- `QrFormPage` en edición: `branchId`/`qrType` no aparecen en el formulario
  ni se envían en el `PATCH`.
- `ClaimPage`: usuario ADMIN de la Organization dueña de la sucursal
  elegida reclama con éxito y es redirigido/ve confirmación; usuario no
  ADMIN ve el mensaje de la decisión 8, sin intentar la mutación; QR ya
  reclamado o inexistente → mensaje genérico (nunca distinguir "ya
  reclamado" de "no existe" en el copy, mismo criterio DEC-007 que ya
  aplica del lado backend).
- `QrImageDialog`: la URL codificada en el SVG generado apunta a
  `${env.apiUrl}/qr/resolve/:qrId`, nunca a `/r/:qrId` ni a un dominio de
  Supabase.
- `QrSendDialog`: número UY de 8 y 9 dígitos (con y sin 0 inicial) se
  normalizan igual que en el `lib/sendQr.test.ts` original (portar esos
  casos de test).
- Copiar link: `navigator.clipboard.writeText` con fallback si el
  navegador de test no lo soporta (mismo criterio que `buildEmailMessageForCopy`).
- Fixtures/handlers MSW nuevos para `/api/qr*` y `/api/branches` en el
  setup de tests ya existente (mismo archivo donde viven los handlers de
  `company`/`apiKey`), con fixtures análogas.
- `npm run typecheck`, `npm run lint`, `npx prettier --check .`, `npm test`
  (frontend) en verde.

### Pasos de aplicación

1. Nuevo worktree limpio, mismo patrón que Fase 1/2 (confirmar primero que
   `origin/master` ya tiene el merge del PR de esta guía y el de Fase 2):
   ```
   cd "U:/Proyectos/Plataforma CRM"
   git fetch origin
   git worktree add ../plataforma-crm-qr-integration-fase3 -b feat/qr-integration-fase3 origin/master
   cd ../plataforma-crm-qr-integration-fase3
   git log --oneline -3
   git log --oneline origin/master..HEAD   # tiene que salir vacío
   ```
2. `cd frontend && npm install qrcode` (+ tipos si hace falta) antes de
   escribir código contra el paquete.
3. Implementar en orden: `features/branch` (api/queries/types/
   `BranchSelect`) → `lib/publicUrl.ts` adaptado → `lib/qrImage.ts` y
   `lib/sendQr.ts` portados → `features/qr/{types,api,queries,mutations}.ts`
   → `QrListPage.tsx` → `QrFormPage.tsx` → `QrImageDialog.tsx` →
   `QrSendDialog.tsx` → `ClaimPage.tsx` → wiring en `app/router.tsx` y
   `layout/AppLayout.tsx`.
4. Resolver en el código el ítem de la decisión 7 (preservar `qrId` a
   través del redirect de login) antes de dar la fase por terminada — no
   dejarlo para "después".
5. Tests (ver "Verificación" arriba, incluyendo portar los casos de
   `lib/sendQr.test.ts` del original), `npm run typecheck`, `npm run lint`,
   `npx prettier --check .`.
6. Verificación manual de punta a punta contra un backend real (local o el
   de Fase 2 ya mergeado): crear un QR digital para una sucursal, ver la
   imagen generada, escanear/abrir `GET /qr/resolve/:qrId` y confirmar el
   redirect, reclamar un QR de stock (si existe alguno insertado a mano) o
   simular el flujo con un QR creado a propósito para probar `claim`,
   confirmar que un QR de otra Organization no aparece en la lista propia.
7. Actualizar este documento: tildar Fase 3 en el checklist de "Estado" y
   agregar la misma clase de nota "qué se desvió del plan al implementar"
   que tienen Fase 1 y Fase 2, si algo cambió.
8. `gh pr create` — nunca mergear. La verificación del PR real (línea por
   línea, no el transcript pegado) y el merge quedan para después.

### Qué se desvió del plan al implementar Fase 3 (2026-09-03)

Mismo criterio que las notas de Fase 1 y Fase 2: lo que cambió al ejecutar,
con el porqué, para que quede a la vista en el PR. Dos de estos puntos ya se
habían detectado en la sesión que se cortó a mitad de la fase (reinicio de
máquina); se volvieron a confirmar contra el código antes de escribirlos.

- **El `QrCode` real no tiene `updatedAt`, y `displayNumber`/`name`/
  `destinationUrl` son nullable.** La guía listaba `updatedAt` como campo
  "esperable"; el modelo Prisma de Fase 1 no lo tiene (a diferencia de
  `Company`/`Branch`), y los tres campos nullable son herencia del modelo de
  stock pre-insertado del original, aunque todo camino de escritura de Fase 2
  los deje siempre poblados. Los endpoints devuelven la fila entera de Prisma
  (sin `select`), así que `deletedAt` también viaja, siempre `null` en el
  listado. `features/qr/types.ts` tipa exactamente eso — no se inventa
  `updatedAt` — y la UI muestra "—" donde falte un valor.
- **La decisión 7 (preservar `qrId` a través del login) ya estaba resuelta
  sin código nuevo.** `ProtectedRoute` redirige con
  `state={{ from: location }}` y `LoginPage` vuelve a `from.pathname` en
  cuanto la sesión existe; como el `qrId` viaja en la URL, no hace falta
  `sessionStorage` ni nada extra. Confirmado en el código y de punta a punta
  con un browser real: abrir `/claim/:qrId` sin sesión → `/login` →
  iniciar sesión → de vuelta en `/claim/:qrId` con el mismo id.
  `getSafeRedirectTarget` de `validation.ts` del original NO se porta por
  la misma razón (el redirect post-login nunca sale de un query param acá);
  solo se porta `looksLikeUrl`.
- **Crear y editar son un `Modal` (`QrFormDialog.tsx`), no una
  `QrFormPage` con ruta propia.** La guía decía "según convención real de
  `company`" (que usa rutas `/companies/new` y `/companies/:id/edit`). No se
  puede seguir esa convención porque **no existe `GET /api/qr/:id`** en
  Fase 2 (`qr.routes.ts` tiene listado, `claim`, `digital`, `PATCH` y
  `DELETE`, nada más): una ruta `/qr/:id/edit` no tendría de dónde hidratar
  el formulario tras un reload. El diálogo recibe la fila del listado por
  prop y no fetchea nada. No hay rutas `/qr/new` ni `/qr/:id/edit`
  (`router.test.tsx` lo afirma), `features/qr/api.ts` no tiene
  `getQrCode` y `qrKeys` no tiene `detail`. Tras crear, se abre directo
  `QrImageDialog` con el QR nuevo — el equivalente del panel "QR nuevo"
  del Dashboard original.
- **`/qr` (listado) va fuera de `AdminRoute`, y el link "QR" del nav se ve
  para ambos roles.** La guía lo ponía dentro de
  `ProtectedRoute > AppLayout > AdminRoute`. El contrato real es el mismo
  que `/companies` y `/activities`: `GET /api/qr` es lectura abierta a
  cualquier usuario autenticado (`qr.routes.ts`: solo `authenticate`), y las
  acciones de solo lectura (ver imagen, enviar, copiar link) son exactamente
  el caso de uso de un USER de mostrador. Las escrituras (generar, editar,
  eliminar) son botones que la página muestra solo a ADMIN, y el backend
  las sigue rechazando con 403 vía `authorize("ADMIN")` igual que antes.
- **`BranchSelect` también es el filtro del listado, y la misma query
  resuelve los nombres de sucursal de las filas.** El listado devuelve
  `branchId` sin `include` de la sucursal, y no hay `GET /api/branches/:id`
  por fila que valga la pena; `QrListPage` pide exactamente la misma query
  que `BranchSelect` (`BRANCHES_PARA_SELECT`, `pageSize: 100`) y TanStack
  Query la dedupe en una sola request. Riesgo residual documentado: una
  organización con más de 100 sucursales ve "—" en las que queden afuera,
  mismo que `UserSelect`.
- **Handlers MSW por test, no en `src/test/msw/handlers.ts`.** La guía decía
  "en el mismo archivo donde viven los handlers de `company`/`apiKey`"; ese
  archivo solo tiene los helpers de `/api/me`, y cada test de `company`/
  `apiKey` compone lo suyo con `server.use(...)`. Se siguió la convención
  real del repo. Las fixtures sí son compartidas (`test/qrFixtures.ts`,
  `test/branchFixtures.ts`).
- **El estado "Sin reclamar" existe en el código pero no puede aparecer
  hoy.** Con el modelo de Fase 2 (la fila nace en el claim, ya con
  `claimedAt`) todo QR listado tiene `claimedAt`; la rama se conserva en
  `estadoDeQr` por si el stock pre-insertado termina siendo el elegido
  (candidato abierto de la nota de Fase 2).
- **"Copiar link" tiene un respaldo visible cuando el portapapeles no está
  disponible** (contexto no seguro o permiso denegado — es lo que pasa en un
  browser headless): el listado muestra el link como texto para copiar a
  mano, y los diálogos ya lo tienen en un campo de solo lectura. La
  verificación manual ejercitó justo ese camino.
- **`/claim/:qrId` con un id que no es UUID muestra el mismo copy genérico
  que un 409** ("QR ya reclamado o no existe"), sin pegarle al backend —
  nunca se distingue "malformado" de "ya reclamado" de "no existe" (DEC-007,
  mismo criterio que el backend).
- **Verificación manual con organizaciones temporales, no con datos
  reales.** Se crearon dos organizaciones, tres identidades de Supabase Auth
  (ADMIN y USER de la primera, ADMIN de la segunda), sucursales y un QR de la
  segunda organización con la misma técnica que `createFixtureUser` de los
  integration tests (service role), se ejercitó todo el flujo con el browser
  headless de gstack contra `npm run dev` de backend y frontend, y se borró
  todo al terminar (incluidas las identidades de Auth). La primera
  organización se marcó `qrBillingExempt` para que `GET /qr/resolve`
  redirija sin pasar por MercadoPago. Lo verificado: claim de un "sticker"
  (id inventado) atravesando el login, segundo claim del mismo id → 409 con
  el copy genérico, `GET /qr/resolve/:qrId` → 302 al destino, QR digital de
  un solo uso → página de consentimiento, `POST` → 302, segundo `GET` →
  "ya fue utilizado" y estado "Usado" en el listado, imagen SVG con el
  mensaje escapado (`<`, `&`, `"`) y la URL pública `${apiUrl}/qr/resolve/…`,
  mailto con el mensaje del QR y el link público, edición, borrado con
  confirmación, el QR de la otra organización nunca en el listado, y USER
  sin botones de escritura y con el mensaje de la decisión 8 en `/claim`.
- **`prisma generate` hace falta en el worktree nuevo** aunque
  `node_modules` exista: el cliente generado no viene con `npm ci`, y sin
  él `npm run dev` del backend muere al arrancar. No cambia nada del
  código; queda anotado para el próximo worktree.

Lo que NO cambió y conviene tener presente al revisar:

- La ruta `/claim/:qrId` es exactamente la que arma `buildLandingHtml`
  (decisión 3) — `router.test.tsx` la afirma con ese path literal.
- Sin pantalla de platform admin, sin estado de suscripción de la propia
  organización, sin "eliminar cuenta", sin URL de destino global (decisión
  2): nada de eso se agregó.
- `QR_CLAIM_APP_URL` sigue sin valor en `.env.example`: el link "¿Sos el
  dueño...?" de la landing pública recién aparece cuando se configure
  apuntando al frontend desplegado (Fase 4).
- Los mensajes al usuario son en español, como el resto del frontend; la
  redacción de los mensajes de WhatsApp/email es el default mínimo del
  original, no una decisión de diseño aprobada.
