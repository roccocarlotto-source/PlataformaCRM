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
- [ ] **Fase 2 — Backend Express** (`resolve`, `claim`, `digital`, webhook de
  MercadoPago, endpoint de platform admin). La Fase 1 ya está migrada y el
  Prisma Client tipado ya incluye `QrCode`/`PaymentEvent`/etc. — no queda
  ningún prerrequisito de esquema.
- [ ] **Fase 3 — Frontend.** Fusionar `Plataforma-QR/admin/src/` como módulo
  de `frontend/`.
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
