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

> **PIVOT DE PRODUCTO, 2026-09-04 — leé esto antes que el resto de la sección.**
> Rocco decidió abandonar el QR físico (claim) y el QR de un solo uso por
> completo: la fidelización automatizada se resuelve mandando un link
> (de reseñas, o su propio linktree) con un mensaje directo desde el CRM, no
> con algo para escanear. Los dos se **eliminaron a fondo** (columnas y enum
> incluidos, no solo UI/endpoints) en la migración
> `20260904120000_remove_qr_claim_and_single_use` — ver
> "Qué se elimina: QR físico y QR de un solo uso (2026-09-04)" al final de
> este documento para el detalle completo y por qué. Las Fases 1-4 de abajo
> describen el módulo TAL COMO SE IMPLEMENTÓ EN SU MOMENTO — son historia, no
> el estado actual — y quedan sin reescribir a propósito, salvo los ítems que
> se marcaron explícitamente como eliminados. El módulo QR que queda en pie es
> solo el QR digital reusable (crear/listar/editar/borrar/enviar/copiar link).

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
  quedan intactas). **(2026-09-04: ese rediseño ya está en curso**, en el
  worktree `feat/qr-integration-fase3`/`plataforma-crm-qr-integration-fase3`
  — aplica el mismo design-system que ya se usó para restylear
  Activities/Opportunities/Pipelines-Stages/Contacts/Dashboard, sin tocar
  `api.ts`/`queries.ts`/`mutations.ts`/`types.ts`. Todavía sin PR — Rocco lo
  está trabajando en paralelo. No confundir con un "Fase 3 sigue abierta":
  la implementación funcional de Fase 3 ya está mergeada y verificada; esto
  es una pasada de estilo posterior e independiente.)**
- [ ] **Fase 4 — Corte e infraestructura.** Guía completa en "Fase 4 — Corte
  e infraestructura" más abajo. Dos PRs separados, en dos repos: el gate de
  secreto compartido en `/qr/resolve/:qrId` (`Plataforma CRM`) y el repunte
  del Cloudflare Worker al nuevo backend (`Plataforma-QR`). Decomiso de
  Vercel y borrado del proyecto `qr-reviews` (dashboard, manual) quedan para
  el final, después de confirmar que el módulo QR funciona de punta a punta
  sobre el proyecto unificado.
  - [x] **Backend — gate de secreto compartido. Listo (2026-09-03).**
    `src/middlewares/requireInternalProxySecret.ts` montado en
    `qrPublic.routes.ts` delante de `GET`/`POST /qr/resolve/:qrId`, con
    `QR_RESOLVE_PROXY_SECRET` y `QR_RESOLVE_PROXY_SECRET_PREVIOUS` opcionales
    en `config/env.ts` y `.env.example`. **Falla cerrado: hasta que el
    secreto tenga un valor real en el entorno de producción, el endpoint
    responde el 404 genérico a todo el mundo** — configurarlo antes o junto
    con el deploy de este cambio. Ver "Qué se desvió del plan al implementar
    el backend de Fase 4" al final de la sección. Sin cambios de esquema.
  - [x] **Cloudflare Worker — repunte. Mergeado y deployado (2026-09-04, dos
    PRs en `Plataforma-QR`).** `wrangler.toml`/`src/index.ts`/`src/handler.ts`
    apuntan a `BACKEND_PUBLIC_BASE_URL=https://plataformacrm.onrender.com`
    (segundo PR: reemplaza el placeholder por el origen real, verificado con
    `GET /health` antes de cambiarlo). El bloque `routes` de `wrangler.toml`
    quedó completo con `nexoraqrs.com/r/*` — **TF-001 (dominio propio) está
    cerrado**: el dominio ya estaba comprado y la ruta ya existía en el
    dashboard de Cloudflare desde el cierre de TF-001 (commit `cbeb286`,
    previo a estos PRs); el primer PR solo hizo que `wrangler.toml`
    versionado dejara de mentir al respecto. Confirmado a mano el
    2026-09-04, mirando los dos dashboards (no los valores, nunca
    comparados ni pegados en chat): `INTERNAL_PROXY_SECRET` existe en
    Cloudflare (Worker `resea-resolve-proxy` → Settings → Variables and
    secrets, tipo `Secret`; confirmado también con
    `npx wrangler secret list` desde `Plataforma-QR/cloudflare/worker`) y
    `QR_RESOLVE_PROXY_SECRET` existe en Render (Environment del servicio
    `PlataformaCRM`). Los *nombres* coinciden con lo que espera el código en
    los dos lados; que el *valor* sea idéntico en ambos solo lo confirma una
    prueba real end-to-end (ver el ítem de abajo), no la sola presencia de
    la variable.
  - [x] **Gap encontrado el 2026-09-04, resuelto el mismo día: `lib/publicUrl.ts`
    ya apunta al Worker.** `buildPublicResolutionUrl` armaba
    `${env.apiUrl}/qr/resolve/:qrId` — directo contra
    `https://plataformacrm.onrender.com`, nunca contra
    `https://nexoraqrs.com`. Consecuencia concreta que tenía esto: **todo
    link que el CRM generaba para un QR (la imagen, "Copiar link", WhatsApp,
    email) esquivaba el Worker por completo**, llegaba al backend sin el
    header `x-internal-proxy-secret`, y `requireInternalProxySecret` lo
    rechazaba con el 404 genérico — como si el QR no existiera, aunque
    estuviera activo. Arreglado: nueva env var `VITE_QR_PUBLIC_BASE_URL`
    (`frontend/src/config/env.ts`, `.env`/`.env.example`) con el dominio del
    Worker, y `buildPublicResolutionUrl` ahora arma
    `${env.qrPublicBaseUrl}/r/${qrId}` — mismo formato de path que el
    original de `Plataforma-QR` (la decisión 6 de Fase 3, más abajo, quedó
    obsoleta por este cambio, se deja sin reescribir como registro
    histórico). Ver "Qué se corrigió: publicUrl.ts apunta al Worker
    (2026-09-04)" al final del documento.
  - [ ] **Verificación end-to-end pendiente**, ya NO bloqueada por el gap de
    arriba (resuelto): abrir el link público de un QR digital real (uno
    inventado no sirve — un secreto mal puesto y un QR inexistente dan a
    propósito la misma respuesta, DEC-007) y confirmar que redirige a su
    `destinationUrl`. Esto es manual, contra el Worker y el backend reales —
    no se puede confirmar desde acá.
  - [ ] **Decomiso** (deployment de Vercel del admin viejo, borrado manual
    del proyecto `qr-reviews` desde el dashboard de Supabase) — sin
    empezar, correctamente: es lo último, después de la verificación
    end-to-end real.
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

## Fase 4 — Corte e infraestructura

Fuente de verdad del comportamiento: `Plataforma-QR/supabase/functions/resolve/index.ts`
(el gate de secreto — `hasValidInternalProxySecret`, `INTERNAL_PROXY_SECRET_HEADER`,
el comentario AUD-09 completo) y `Plataforma-QR/cloudflare/worker/src/{handler,index}.ts`
(la lógica de proxy/rate-limit ya implementada, nunca deployada — `README.md`
de ese directorio confirma que TF-001, el dominio, sigue sin resolver y que
el Worker nunca llegó a un deploy real).

No hay datos que migrar en esta fase (mismo punto de partida que Fase 1-3:
piloto sin negocios reales) — es pura infraestructura y un endpoint que
hasta ahora no tenía protección contra acceso directo.

### Decisiones tomadas para esta fase (confirmadas con Rocco, no asumidas)

1. **Repuntar el Worker al nuevo backend, no retirarlo.** Sigue teniendo
   valor: rate limiting nativo de Cloudflare delante de `resolve` (10/min
   por IP, 500/min global) antes de que la request llegue a Postgres.

2. **Agregar el gate de secreto compartido al backend — no dejarlo como
   "mejor esfuerzo".** Fase 2 portó toda la lógica de negocio de `resolve`
   (los 6 estados, DEC-007, consumo atómico de single-use) pero **no portó
   este gate** — quedaba fuera de esa fase a propósito, es infraestructura,
   no negocio. Sin él, `GET/POST /qr/resolve/:qrId` sigue siendo alcanzable
   directo aunque el Worker esté repuntado y filtrando su propio dominio —
   exactamente el problema que el comentario AUD-09 del original documenta
   ("verified against production"). Mismo diseño que el original: falla
   **cerrado** (sin secreto configurado, nada lo satisface) y responde con
   el mismo 404 genérico que un QR inexistente — nunca un 403 distinto que
   revele que el gate existe (DEC-007 aplica también acá).

3. **Gap encontrado, documentado, no resuelto en esta fase — el link público
   que arma el frontend no pasa por el Worker.** `lib/publicUrl.ts` (Fase 3,
   ya mergeado, decisión 6 de esa fase) construye
   `${env.apiUrl}/qr/resolve/:qrId` — directo contra el backend, nunca
   contra el dominio del Worker. Repuntar el Worker es necesario pero no
   alcanza para que el rate limiting proteja el flujo real de un QR
   escaneado: mientras `publicUrl.ts` no cambie, ningún tráfico real pasa
   por él. **Actualización 2026-09-04: la condición que bloqueaba este ítem
   ya no existe.** Cuando se escribió esta decisión no había dominio propio
   (solo el `*.workers.dev` gratuito, no apto para imprimir en un sticker) y
   quedaba pendiente "para cuando Rocco compre el dominio". TF-001 se cerró
   con `nexoraqrs.com` (commit `cbeb286`, confirmado también en el primer PR
   de repunte del Worker), así que ya no es un ítem bloqueado — es un ítem
   pendiente sin excusa, y ahora sí bloquea la verificación end-to-end real
   de Fase 4 (ver "Estado" y el checklist de Cloudflare Worker más abajo).
   El gate del punto 2 lo sigue protegiendo mientras tanto (defensa en
   profundidad: aunque `publicUrl.ts` esquive al Worker, nadie pasa el gate
   sin el secreto) — pero con el efecto colateral de que, hoy, ningún link
   generado por el CRM resuelve: todos pegan al backend sin el header y
   reciben el 404 genérico.

   **Resuelto el mismo 2026-09-04** — ver "Qué se corrigió: publicUrl.ts
   apunta al Worker (2026-09-04)" al final del documento. Se deja el párrafo
   de arriba sin reescribir como registro de por qué existía el gap.

### Backend — gate de secreto compartido (`Plataforma CRM`)

1. **Env vars nuevas en `config/env.ts`** (opcionales, mismo criterio que
   `MERCADOPAGO_WEBHOOK_SECRET` — el server tiene que poder arrancar sin
   ellas): `QR_RESOLVE_PROXY_SECRET` y `QR_RESOLVE_PROXY_SECRET_PREVIOUS`
   (esta última para poder rotar el secreto actualizando primero un lado —
   Worker o backend, en cualquier orden — sin ventana de caída, mismo
   mecanismo que el original). Agregar a `.env.example` sin valor.

   **Importante para el orden de deploy, dejarlo bien visible en el PR:**
   una vez que este middleware esté activo, `/qr/resolve/*` devuelve 404 a
   **todo el mundo** hasta que `QR_RESOLVE_PROXY_SECRET` tenga un valor real
   configurado en el entorno de verdad — es el mismo "falla cerrado" del
   original, no un bug. Como hoy no hay tráfico real contra este endpoint
   (sin negocios reales), no rompe nada productivo, pero hay que configurar
   el secreto en el deploy real antes o junto con este cambio, no después.

2. **Middleware nuevo** — nombre sugerido `requireInternalProxySecret.ts`,
   junto a `requirePlatformAdmin.ts` en `src/middlewares/` (mismo criterio
   de reusabilidad/testabilidad, aunque este solo tenga un consumidor hoy).
   Lee el header `x-internal-proxy-secret` (case-insensitive, Express ya lo
   normaliza) y lo compara en tiempo constante contra
   `QR_RESOLVE_PROXY_SECRET`/`_PREVIOUS` — portar `hasValidInternalProxySecret`
   casi literal (acepta el actual o el anterior; sin ninguno configurado,
   nada satisface). Para la comparación en tiempo constante, revisar primero
   si `src/utils/mercadopagoSignature.ts` (Fase 2) ya expone un helper
   genérico de comparación tipo `timingSafeEqual` reusable acá antes de
   escribir uno nuevo — mismo motivo que esa función existe: Node
   `crypto.timingSafeEqual` tira si los buffers no tienen la misma
   longitud, así que un uso ingenuo filtra la longitud del secreto por
   excepción/timing; hay que igualar longitudes (o comparar hashes) antes
   de comparar, no invocarlo directo con strings de largo variable.

3. **En falla, la respuesta tiene que ser BYTE A BYTE la misma que ya arma
   el controller para un QR inexistente** — nunca un `AppError`/403/JSON
   nuevo, eso por sí solo revelaría que el gate existe a quien está
   probando la URL cruda. Antes de escribir el middleware, leer
   `qrPublic.controller.ts`/`qrPublic.service.ts`/`qrLanding.ts` reales
   (ya mergeados en Fase 2) para confirmar el shape exacto de esa respuesta
   (status, `Content-Type`, el HTML que arma `buildLandingHtml` o
   equivalente) y reusar esa misma función de render directamente desde el
   middleware — no reconstruirla a mano ni aproximarla.

4. **Dónde se monta:** en `qrPublic.routes.ts`, antes del handler de
   `GET`/`POST /qr/resolve/:qrId` — mismo criterio de orden que el original
   (secreto se chequea antes de parsear/validar el `qrId`). No tocar
   ninguna otra ruta pública (`/health`, etc.) — el gate es específico de
   este endpoint.

5. **Tests:** sin secreto configurado → todo 404 (incluida una request con
   header correcto, porque no hay nada configurado contra qué comparar);
   con secreto configurado, header ausente/incorrecto/de otro valor → mismo
   404 que un QR inexistente, byte a byte; header con el secreto actual →
   pasa; header con el secreto "previous" → también pasa (rotación); nunca
   un status distinto de 404 en ningún camino de falla.

### Cloudflare Worker — repunte (`Plataforma-QR`)

1. **`wrangler.toml`**: reemplazar la var `SUPABASE_FUNCTIONS_BASE_URL` por
   algo como `BACKEND_PUBLIC_BASE_URL` (el origen público del backend
   Express — no `/functions/v1`, no `/api`: `/qr/resolve/:qrId` está
   montado en la raíz, sin prefijo, igual que hoy). El comentario de
   `[[ratelimits]]` no cambia — la config de rate limiting es independiente
   del upstream.

2. **`src/index.ts`**: renombrar el campo de `Env` acorde
   (`BACKEND_PUBLIC_BASE_URL` en vez de `SUPABASE_FUNCTIONS_BASE_URL`), sin
   tocar nada de la lógica de bindings de rate limit ni el secreto — ese
   wiring no cambia.

3. **`src/handler.ts`**: cambiar la construcción de `upstreamUrl` de
   `` `${supabaseFunctionsBaseUrl}/resolve/${qrIdSegment}` `` a
   `` `${backendPublicBaseUrl}/qr/resolve/${qrIdSegment}` `` — el único
   cambio real de lógica. El resto (rate limiting primero, GET/POST,
   `redirect: "manual"`, relay de 30x, forzar `Content-Type: text/html`
   en las no-redirect) se mantiene igual. Sobre ese último punto: confirmar
   al implementar si Express ya devuelve `Content-Type: text/html` correcto
   en `qrPublic.controller.ts` (lo normal en Express con
   `res.type("html").send(...)`) — si es así, forzarlo en el Worker es
   redundante pero inofensivo (no hace falta sacarlo); el bug que este
   forzado corregía (TF-007) era específico de cómo Supabase Edge Functions
   servía HTML sin dominio propio, no necesariamente aplica acá.

4. **`src/handler.test.ts`**: actualizar los mocks/asserts que referencian
   `supabaseFunctionsBaseUrl`/la URL vieja al nuevo nombre y shape de
   upstream — mismos 10 casos, mismo criterio de cobertura (rate limit
   primero, método no permitido, path inválido, error de red → 502, relay
   de redirect, relay de body con Content-Type forzado, envío del header
   de secreto).

5. **`README.md`**: actualizar el paso 1 ("Fill in your real Supabase
   Functions URL") para reflejar `BACKEND_PUBLIC_BASE_URL` apuntando al
   backend del CRM. El resto de los pasos manuales (cuenta de Cloudflare,
   `wrangler login`, `wrangler deploy`, TF-001 el dominio) siguen siendo
   los mismos y siguen siendo pasos que solo Rocco puede hacer.

### Lo que Rocco tiene que hacer a mano, en su cuenta real (no en el PR)

- [x] `npx wrangler secret put INTERNAL_PROXY_SECRET` en el Worker — hecho,
  confirmado el 2026-09-04 (`npx wrangler secret list` desde
  `Plataforma-QR/cloudflare/worker` lo lista como `secret_text`; nunca en
  `wrangler.toml`, nunca commiteado).
- [x] Configurar `QR_RESOLVE_PROXY_SECRET` en el entorno real del backend
  (Render, servicio `PlataformaCRM` → Environment) con el **mismo valor
  exacto** que el paso anterior — hecho, confirmado el 2026-09-04 (la
  variable está en el dashboard de Render; los nombres de las variables no
  necesitan coincidir entre los dos lados, el valor sí, y eso solo lo
  confirma la prueba end-to-end de abajo, no la sola presencia de la var).
- [x] `npx wrangler deploy` desde `cloudflare/worker/` — ya deployado: el
  dashboard de Cloudflare muestra `BACKEND_PUBLIC_BASE_URL` e
  `INTERNAL_PROXY_SECRET` como runtime vars activas del Worker en
  producción. TF-001 ya no aplica como bloqueo: el Worker corre sobre la
  ruta `nexoraqrs.com/r/*`, no sobre el `*.workers.dev` gratuito.
- [x] **`lib/publicUrl.ts` actualizado (2026-09-04)** para que arme el link
  público contra `VITE_QR_PUBLIC_BASE_URL` (`https://nexoraqrs.com` en
  producción) en vez de `env.apiUrl` (ver el gap de 2026-09-04 en "Estado" y
  en la decisión 3 de arriba, y "Qué se corrigió: publicUrl.ts apunta al
  Worker (2026-09-04)" al final del documento). Falta desplegar este cambio
  a producción antes de que el punto de abajo tenga sentido.
- [ ] Verificar manualmente, recién después del deploy del punto anterior:
  abrir la URL pública de un QR digital real (creado desde el módulo QR del
  CRM) y confirmar el redirect a su `destinationUrl`; pegarle a
  `${BACKEND_PUBLIC_BASE_URL}/qr/resolve/:qrId` directo, sin el header, y
  confirmar el 404 genérico (nunca el redirect).

### Verificación

- Backend: los tests del punto 5 de arriba en verde; `npm run typecheck`,
  `npm run lint`, `npx prettier --check .`; `npm run verify:schema` sigue
  en verde (esta fase no toca el esquema).
- Worker: `deno test --allow-net handler.test.ts` (o el runner que use el
  repo `Plataforma-QR` — confirmar contra `package.json`/CI existente) en
  verde con los mocks actualizados.
- Manual, end-to-end, ya con el secreto real configurado en ambos lados:
  `GET` a la URL del Worker con un QR reclamado real → redirect correcto;
  `GET`/`POST` directo contra `${BACKEND_PUBLIC_BASE_URL}/qr/resolve/:qrId`
  sin el header → 404 genérico (nunca el redirect); con el header pero un
  valor incorrecto → mismo 404; con el secreto "previous" tras rotar →
  sigue funcionando.

### Pasos de aplicación

1. **Backend primero, en un worktree nuevo de `Plataforma CRM`** (mismo
   patrón que las fases anteriores):
   ```
   cd "U:/Proyectos/Plataforma CRM"
   git fetch origin
   git worktree add ../plataforma-crm-qr-integration-fase4-backend -b feat/qr-integration-fase4-backend origin/master
   cd ../plataforma-crm-qr-integration-fase4-backend
   git log --oneline -3
   git log --oneline origin/master..HEAD   # tiene que salir vacío
   ```
   (Si este documento ya se escribió en un worktree `-fase4` sin sufijo
   `-backend`, confirmar primero si ese worktree tiene código de más allá
   de la doc antes de reusarlo — si solo tiene el commit de esta guía,
   está bien seguir ahí en vez de crear uno nuevo.)
2. Implementar en el orden de la sección "Backend" de arriba: env vars →
   middleware (con su comparación en tiempo constante) → montarlo en
   `qrPublic.routes.ts` → tests.
3. `npm run typecheck`, `npm run lint`, `npx prettier --check .`, tests.
4. Actualizar este documento: tildar la parte de backend de Fase 4 en
   "Estado" (dejar Fase 4 completa recién cuando el Worker también esté
   repuntado y mergeado) y agregar la nota de desvíos si algo cambió.
5. `gh pr create` — nunca mergear. Verificación real del diff antes del
   merge, como siempre.
6. **Recién después de que el PR de backend esté mergeado**, worktree
   nuevo de `Plataforma-QR` para el Worker:
   ```
   cd "U:/Proyectos/Plataforma-QR"
   git fetch origin
   git worktree add ../plataforma-qr-worker-fase4 -b feat/worker-repoint-fase4 origin/master
   cd ../plataforma-qr-worker-fase4/cloudflare/worker
   git log --oneline -3
   git log --oneline origin/master..HEAD   # tiene que salir vacío
   ```
7. Implementar la sección "Cloudflare Worker" de arriba, tests, `gh pr
   create` — nunca mergear.
8. Una vez mergeado ese segundo PR: los pasos manuales de la sección de
   arriba (secretos reales, `wrangler deploy`, verificación manual) los
   hace Rocco. Recién ahí se tilda Fase 4 completa en "Estado", con una
   nota final describiendo el estado real (Worker deployado en la URL
   gratuita, dominio propio — TF-001 — seguía pendiente al cerrar la fase).

### Qué se desvió del plan al implementar el backend de Fase 4 (2026-09-03)

Mismo criterio que las notas de las fases anteriores: lo que cambió al
ejecutar, con el porqué. Solo la mitad de backend; la del Worker tendrá la
suya en el repo `Plataforma-QR`.

- **La comparación en tiempo constante NO reusa `timingSafeEqual` de
  `utils/mercadopagoSignature.ts`.** La guía pedía revisarlo primero; se
  revisó, y ese helper devuelve `false` de inmediato cuando los largos
  difieren. Para un HMAC hex está bien (el largo es público, siempre 64),
  pero acá el largo del secreto es parte del secreto: un `return false`
  temprano deja medir por timing cuántos bytes tiene. En vez de eso,
  `secretsMatch` en el propio middleware hashea los dos lados con SHA-256 y
  compara los dos digests de 32 bytes con `crypto.timingSafeEqual` — que así
  nunca tira ni corta antes por longitud. El helper de MercadoPago queda
  intacto, con su propio uso.
- **El 404 de falla sale de una función exportada por el controller,
  `sendQrNotFoundLanding(res)`**, que `renderPublicState` también usa para
  "no existe / malformado / borrado". La guía pedía "reusar esa misma
  función de render"; el controller no la tenía como función con nombre
  (era una línea inline `sendHtml(res, 404, buildLandingHtml())`), así que
  se extrajo. El integration test compara el cuerpo de la falla contra un
  404 real del controller, byte a byte, en GET y en POST, para un QR que
  SÍ está activo (sin el header, nunca redirige).
- **Los tests de integración existentes de `qrPublic` ahora mandan el
  header en todos los casos de negocio**, con el secreto configurado en
  `env` en el `before()` y restaurado en el `after()` — como lo haría el
  Worker. Sin eso, el gate (falla cerrado) los habría dejado todos en 404.
  `routes/index.test.ts` no cambió de aserción: en el entorno del job
  unitario no hay secreto, así que el 404 HTML de "está montado" ahora lo
  produce el gate en vez del handler, y para ese test da igual cuál de los
  dos contestó (los dos solo existen en la cadena de `qrPublicRouter`).
- **Un header con whitespace en los bordes no es un caso de "casi el
  secreto".** Un test lo intentó con `"<secreto> "` y pasó el gate: HTTP
  recorta el whitespace de los bordes de un valor de header antes de que
  llegue a Express, así que el middleware recibió el secreto exacto. No es
  un hueco (el valor que llega ES el correcto); el caso se cambió por un
  byte de más real.
- **`env` se lee por request, no al cargar el módulo**, para que los tests
  puedan cambiar el valor entre casos sin reiniciar el server. En
  producción no cambia nada: `env` se parsea una vez.
- **`prisma generate` hizo falta en el worktree nuevo** después de `npm ci`
  (mismo punto que la nota de Fase 3); sin cambios de código.

Lo que NO cambió y conviene tener presente al revisar:

- **Orden de deploy:** con este middleware activo, `/qr/resolve/*` responde
  404 a todo el mundo hasta que `QR_RESOLVE_PROXY_SECRET` tenga valor en el
  entorno real. Hoy no hay tráfico real contra ese endpoint, así que no
  rompe nada productivo, pero el secreto se configura antes o junto con el
  deploy, nunca después.
- El link público que arma el frontend (`lib/publicUrl.ts`) sigue apuntando
  directo al backend, no al Worker (decisión 3 de esta fase, actualizada
  2026-09-04 — TF-001 ya no bloquea este ítem, ver esa decisión): hoy
  escanear un QR generado desde el CRM pega contra el backend sin el header
  y ve el 404 genérico, para cualquier QR, real o no. Es el comportamiento
  esperado por diseño (defensa en profundidad — nadie pasa sin el secreto),
  pero con el efecto colateral de que nada resuelve todavía. Sigue siendo
  el próximo paso, ahora sin ninguna dependencia externa pendiente.
- `/health` y el resto de las rutas públicas no llevan el gate.

### Qué se desvió del plan al implementar el Worker de Fase 4 (2026-09-04)

Mismo criterio que las notas anteriores: lo que cambió al ejecutar, con el
porqué. Esta parte corresponde al repo `Plataforma-QR`, en dos PRs en vez
de uno.

- **Se dividió en dos PRs en vez de uno, por una razón real: el origen
  público del backend no estaba documentado en ningún lado del repo
  `Plataforma-QR` al momento de escribir el primer PR.** El primero
  (`fix(rateLimit)`-style, título "Fase 4 de `docs/qr-integration.md`
  (Plataforma CRM), mitad del Worker") hace todo el repunte de código
  (`wrangler.toml`, `src/index.ts`, `src/handler.ts`, `src/handler.test.ts`,
  `README.md`) con `BACKEND_PUBLIC_BASE_URL` como **placeholder
  deliberado** — deployar ese PR solo, sin más, proxea a un host inexistente
  y da 502. El segundo PR reemplaza el placeholder por el origen real
  (`https://plataformacrm.onrender.com`), verificado antes con `GET
  /health`, y renumera los pasos del `README.md`. Ninguno de los dos
  deploya nada por sí solo — eso lo sigue haciendo Rocco a mano
  (`wrangler login` / `wrangler secret put` / `wrangler deploy`), como ya
  documentaba esta guía.
- **TF-001 (dominio propio) ya estaba cerrado antes de estos PRs, y la guía
  original no lo reflejaba.** El primer PR lo corrige: el bloque `routes`
  de `wrangler.toml` estaba comentado/incompleto en el repo versionado
  aunque la ruta `nexoraqrs.com/r/*` ya existía de verdad en el dashboard de
  Cloudflare desde el cierre de TF-001 (commit `cbeb286`, creado a mano,
  fuera de este PR). El cambio es documental/de config versionada, no de
  infraestructura nueva. Esto es lo que reabre el gap de `publicUrl.ts`
  documentado arriba: la excusa original para no arreglarlo ("no hay
  dominio todavía") dejó de ser cierta antes incluso de que estos dos PRs
  existieran.
- **El forzado de `Content-Type: text/html` en `handler.ts` se mantuvo, pero
  quedó documentado como redundante.** TF-007 (el bug que ese forzado
  corregía) era específico de cómo Supabase Edge Functions servía HTML sin
  dominio propio; el backend Express de Fase 2 ya manda `text/html`
  correcto (`res.type("html")`), así que forzarlo en el Worker no hace
  nada hoy — se deja de todos modos porque sigue sirviendo para no dejar
  pasar headers inesperados del upstream, y sacarlo no aportaba nada a
  cambio del riesgo de tocar código que no hacía falta tocar.
- **Verificación de los dos PRs:** `deno test --allow-net handler.test.ts`
  (26/26, no 25 — se sumó un caso que fija el path exacto del repunte, sin
  `/functions/` ni `/api/`, en GET y POST) y `npx wrangler deploy --dry-run`
  sin login (compila y lista los bindings esperados: `RATE_LIMITER_IP`,
  `RATE_LIMITER_GLOBAL`, `BACKEND_PUBLIC_BASE_URL`); un `git grep` de
  `SUPABASE_FUNCTIONS_BASE_URL`/`supabaseFunctionsBaseUrl` en archivos
  versionados fuera de `state/` dio cero resultados.
- **Verificación manual, 2026-09-04, ya con el código deployado:**
  confirmado por captura de pantalla que `BACKEND_PUBLIC_BASE_URL` (Text) e
  `INTERNAL_PROXY_SECRET` (Secret) están cargadas como runtime vars del
  Worker en Cloudflare, que `QR_RESOLVE_PROXY_SECRET`/`QR_CLAIM_APP_URL`
  están cargadas en el Environment de Render, y que
  `npx wrangler secret list` (desde `Plataforma-QR/cloudflare/worker`, tras
  corregir estar parado en la carpeta equivocada — un worktree de
  `Plataforma CRM`, no de `Plataforma-QR`) lista `INTERNAL_PROXY_SECRET`.
  Ninguno de estos chequeos confirma que el *valor* de los dos secretos sea
  el mismo — por diseño, esa comparación nunca se hace a la vista (ver la
  nota de privacidad más arriba) — y **el flujo real todavía no se probó de
  punta a punta**, porque el gap de `publicUrl.ts` documentado arriba se lo
  impide: con el código actual, cualquier QR real que se abra hoy va a dar
  "no encontrado".

## Qué se elimina: QR físico y QR de un solo uso (2026-09-04)

**Contexto del pivot.** Rocco: *"Estuve pensando y el propósito del generador
de qr como tal es automatizar la fidelización, es un link automático
acompañado de un mensaje... no sería mejor simplemente hacer que se envíe el
link con un mensaje y listo? No es necesario que sea un qr como tal."* — y
después, explícito: *"el qr físico olvidate para esto... Quiero que se
elimine eso de qr físico y qr de un solo uso y tal."* La nueva dirección
("enlaces de fidelización": mandar el link de reseñas o un linktree propio,
con un mensaje por plantilla o por IA, automatizado según reglas del usuario,
apoyado en el motor de outbox que ya existe) es una feature aparte, todavía
sin planear ni construir — este cambio es solo el prerrequisito de limpieza
que Rocco pidió hacer primero: *"1) B- Vamos a fondo, 2) Vamos a limpiar
primero, luego seguimos con el restyle."* "A fondo" significa columnas y enum
eliminados de la base, no solo UI/endpoints ocultos.

**Alcance de lo eliminado:**

- El claim de un QR físico (INSERT con un id ya impreso en un sticker,
  `POST /qr/claim`, decisión 4 original) — ya no existe ningún camino de
  creación con id explícito. Todo QR nace digital, con id generado.
- El QR de un solo uso (`qrType SINGLE_USE`, consumo atómico en
  `POST /qr/resolve/:qrId`, las páginas de confirmación/"ya usado") — todo QR
  que queda es reusable por construcción, así que `qrType` deja de tener
  sentido y se elimina también para el `REUSABLE` que sobrevive.
- Las columnas `qr_type` (y el enum `QrType`), `used_at` y `claimed_at` de
  `qr_codes`, vía la migración
  `prisma/migrations/20260904120000_remove_qr_claim_and_single_use`.
  `branch_id`, `name` y `destination_url` pasan a `NOT NULL` en la misma
  migración: con `qrType`/claim fuera, el único estado válido de una fila es
  "reclamada" — no hace falta backfill porque QR Reviews sigue en piloto sin
  negocios reales (nunca existió una fila con `branch_id` null). La FK
  compuesta `qr_codes -> branches` pasa de `ON DELETE NO ACTION` (regla de
  `20260821140200` para columna referenciante nullable) a `ON DELETE
  RESTRICT` (misma regla, ahora que `branch_id` es `NOT NULL` — mismo
  criterio que `resources`/`service_types` en `20260828160000`).

**Backend (`Plataforma CRM`, checkout principal, sin PR propio todavía —
mismo mecanismo de Fase 0: los archivos quedan editados en tu carpeta, el
commit/PR lo hacés vos):**

- `qr.controller.ts`/`qr.routes.ts`/`qr.service.ts`: sin `claimQrHandler`,
  `claimQrSchema`, `qrTypeSchema`, `claimQrCode`, `ClaimQrCodeInput`,
  `QR_YA_RECLAMADO`, ni la ruta `POST /qr/claim`. `createDigitalQrSchema` y
  `CreateDigitalQrCodeInput` pierden `qrType`.
- `qrPublic.controller.ts`/`qrPublic.routes.ts`/`qrPublic.service.ts`: sin
  `consumeQrHandler`/`consumeSingleUseQr`, ni la ruta `POST
  /qr/resolve/:qrId` (el árbol de estados de `renderPublicState` se
  simplifica a "puede redirigir" / landing genérica — ya no hay
  `qrType`/`isUsed` que ramificar).
- `qrCode.repository.ts`: `CreateQrCodeData` sin `id?`/`qrType`;
  `QrPublicState` sin `qrType`/`isUsed`; sin `consumeSingleUseQrCode` (el
  `UPDATE` atómico de consumo).
- `qrLanding.ts`: sin `buildSingleUseConfirmHtml`/`buildSingleUseUsedHtml`;
  `buildLandingHtml` deja de aceptar `qrId`/`claimAppUrl` — sin QR físico, no
  hay a dónde mandar el link "¿Sos el dueño...?", así que esa landing deja de
  ofrecerlo (queda solo el mensaje genérico).
- `config/env.ts`: sin `QR_CLAIM_APP_URL` (nunca llegó a apuntar a nada — ver
  el ítem de Fase 3 de más arriba).
- Tests actualizados en el mismo sentido en los seis archivos de test del
  módulo (`qr.controller.test.ts`, `qr.integration-test.ts`,
  `qrPublic.controller.integration-test.ts`, `qrLanding.test.ts`,
  `routes/index.test.ts`); `qrBilling.*`, `qrWebhook.*`, `qrAdmin.*`,
  `tenant-isolation.integration-test.ts`,
  `soft-delete-restrict.integration-test.ts` y
  `schema-diagnostic.integration-test.ts` no referencian nada de esto y
  quedan intactos.

**Frontend, en el worktree `plataforma-crm-qr-integration-fase3` (por pedido
explícito de Rocco: la limpieza va ahí, antes de retomar el restyle en curso
en esa misma rama — no en el checkout principal):**

- `router.tsx`: sin la ruta `/claim/:qrId` ni el import de `ClaimPage`.
- `ClaimPage.tsx`/`ClaimPage.test.tsx` quedaron **vacíos, no borrados**: esta
  sesión no tiene forma de borrar archivos en tu carpeta (sin acceso a una
  terminal en tu máquina ni permiso de borrado en este momento) — correlo vos
  con `git rm frontend/src/features/qr/ClaimPage.tsx
  frontend/src/features/qr/ClaimPage.test.tsx` antes de commitear, o el PR va
  a traer dos archivos-comentario sueltos que no aportan nada.
- `types.ts`: `QrCode` sin `qrType`/`usedAt`/`claimedAt`, y `branchId`/`name`/
  `destinationUrl` pasan a no-nulables (reflejan el `NOT NULL` del schema).
  Sin `QrType`, `ClaimQrInput`, `QrCodeStatus`, `estadoDeQr`.
- `api.ts`/`mutations.ts`: sin `claimQrCode`/`useClaimQrCode`.
- `QrFormDialog.tsx`: sin el radio "Reusable / Un solo uso" al crear.
- `QrListPage.tsx`: la tabla pierde las columnas "Estado" (era
  `estadoDeQr`/`SIN_RECLAMAR`/`USADO`/`ACTIVO`, ya no aplica) y "Tipo"
  (Reusable/Un solo uso).
- Fixtures y tests (`qrFixtures.ts`, `branchFixtures.ts`, `api.test.ts`,
  `QrFormDialog.test.tsx`, `QrListPage.test.tsx`, `router.test.tsx`)
  actualizados en el mismo sentido.
- **`QrSendDialog.tsx`/`QrSendDialog.test.tsx` no se tocaron**: no referencian
  claim ni `qrType` en ningún lado — "enviar" ya era agnóstico del tipo de QR.
- El `docs/qr-integration.md` que vive DENTRO de ese worktree quedó
  desactualizado respecto de este archivo (no se tocó en esta limpieza,
  solo el código) — reconciliarlo es parte de mergear esa rama, no de esta
  tarea.

**Lo que NO se tocó y sigue pendiente, sin relación con esta limpieza:**

- El gap de `lib/publicUrl.ts` (ver el ítem de Fase 4 más arriba): sigue
  apuntando directo a Render en vez del Worker/`nexoraqrs.com`, para
  cualquier QR digital reusable — este pivot no lo resuelve ni lo empeora,
  solo saca "reclamado" del vocabulario del bug.
- **Orden de deploy:** el frontend que hoy corre en producción (el mergeado
  de Fase 3 original, no el worktree de restyle) todavía tiene la UI de
  claim/single-use — va a llamar a endpoints que este cambio borra
  (`POST /qr/claim`, `POST /qr/resolve/:qrId`) en cuanto el backend se
  despliegue con esta limpieza, antes de que el worktree de restyle (que ya
  incluye esta misma limpieza del lado frontend) se mergee y despliegue.
  Riesgo bajo en la práctica — QR Reviews sigue en piloto sin negocios
  reales — pero es la secuencia a tener en cuenta al mergear/deployar los
  dos lados.
- La feature nueva de "enlaces de fidelización" (link + mensaje por plantilla
  o IA, automatizado por reglas del usuario, apoyado en el motor de outbox)
  — confirmada en principio con Rocco, todavía sin planear ni empezar. El
  módulo de "Agentes de IA" (`docs/roadmap-implementacion.md` §2.2, WhatsApp
  Business Platform vía Meta/Twilio) queda explícitamente fuera de alcance
  por ahora: *"el tema de agentes de ia no lo vamos a tocar por ahora."*

## Qué se corrigió: publicUrl.ts apunta al Worker (2026-09-04)

**Contexto.** Después de mergear la limpieza de QR físico/single-use (PR
#154), Rocco preguntó si ya se podía borrar el proyecto `qr-reviews` de
Supabase. Repasando el checklist de Fase 4 para responder, el gap de
`lib/publicUrl.ts` documentado ahí (ver "Estado" y la decisión 3 de Fase 4)
seguía sin excusa desde que TF-001 se cerró: el Worker de Cloudflare estaba
deployado y apuntando al backend real, pero el frontend nunca armaba los
links contra él. Se decidió resolverlo en el momento, en vez de dejarlo para
después del restyle de Fase 3, porque era el único bloqueante real para
poder decomisar `qr-reviews`.

**El bug, concreto.** `buildPublicResolutionUrl` (`frontend/src/lib/publicUrl.ts`)
armaba `${env.apiUrl}/qr/resolve/${qrId}` — la URL del backend Express
directo, sin pasar por el Worker. El backend, desde el gate de secreto
compartido de Fase 4 (`requireInternalProxySecret`, falla cerrado), rechaza
con el 404 genérico cualquier request a `/qr/resolve/:qrId` que no traiga el
header `x-internal-proxy-secret` — y ese header solo lo agrega el Worker.
Resultado: **todo QR digital creado desde el CRM tenía un link roto**, sin
excepción — la imagen, "Copiar link", y lo que mandara `QrSendDialog` por
WhatsApp/email apuntaban todos a una URL que siempre devolvía 404, desde que
el gate de Fase 4 se deployó.

**El arreglo.**
- Nueva env var `VITE_QR_PUBLIC_BASE_URL`: el dominio público del Worker
  (`https://nexoraqrs.com` en producción — mismo valor en desarrollo local,
  porque el Worker ya apunta al backend de producción, no hay forma de que
  apunte a un backend local). Agregada a `frontend/.env`,
  `frontend/.env.example` y como var dummy (`https://qr.test.local`,
  deliberadamente sin overlap de substring con la de `VITE_API_URL` de los
  tests) en el bloque `test.env` de `frontend/vite.config.ts`.
- `frontend/src/config/env.ts`: nuevo campo `qrPublicBaseUrl`, mismo patrón
  (`requiredAbsoluteUrl` + `stripTrailingSlash`) que `apiUrl`.
- `frontend/src/lib/publicUrl.ts`: `buildPublicResolutionUrl` ahora arma
  `${env.qrPublicBaseUrl}/r/${qrId}` — recuperando el path `/r/:qrId` del
  `Plataforma-QR` original (la decisión 6 de Fase 3 lo había cambiado a
  `/qr/resolve/:qrId` sobre `env.apiUrl` porque en ese momento el Worker
  todavía no estaba repuntado; ese párrafo se deja sin reescribir como
  registro de esa decisión, ya obsoleta). Comentario del archivo actualizado
  para explicar el porqué completo.
- `frontend/src/lib/publicUrl.test.ts`: actualizado — afirma que el link sale
  sobre `env.qrPublicBaseUrl`, con `/r/`, y que NO contiene `/qr/resolve/`
  ni `env.apiUrl`.

**Qué NO se tocó, a propósito.**
- El backend (`qrPublic.controller.ts`, `requireInternalProxySecret`, el
  Worker mismo) — el gate ya estaba bien, el bug era enteramente del lado
  del frontend armando la URL equivocada.
- El worktree de restyle de Fase 3
  (`plataforma-crm-qr-integration-fase3`) — capítulo aparte, sin tocar acá;
  cuando se mergee va a traer su propia copia de `publicUrl.ts` que hay que
  reconciliar con este fix (mismo criterio que la nota de la limpieza de QR
  físico/single-use, más arriba).

**Lo que sigue pendiente, y por qué no se puede cerrar desde acá.**
- Desplegar este cambio a producción (Render/Vercel/lo que sirva el
  frontend) — build y deploy, fuera del alcance de esta sesión.
- La verificación end-to-end manual: abrir el link público de un QR digital
  real ya creado y confirmar que redirige a su `destinationUrl` a través del
  Worker. Recién con eso confirmado tiene sentido decomisar `qr-reviews`
  (deployment de Vercel del admin viejo + borrado del proyecto de Supabase
  desde el dashboard) — ver el checklist de Fase 4 en "Estado".
