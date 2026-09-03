-- ---------------------------------------------------------------------------
-- Diagnóstico de la auditoría del 2026-08-21
--
-- SOLO LECTURA. No crea, no modifica y no borra nada. Se puede correr en
-- producción sin riesgo.
--
-- Cómo usarlo:
--   Supabase → SQL Editor → New query → pegar todo → Run.
--   Devuelve una sola tabla con una fila por chequeo.
--
-- Responde las verificaciones pendientes de la sección 8 de
-- docs/auditoria-2026-08-21.md:
--   V-1 → ¿C-1 es explotable hoy?
--   V-2 → ¿cuáles de los 36 objetos de DDL existen en la base real?
--   V-3 → ¿el rol de la app realmente bypassea RLS?
--
-- ---------------------------------------------------------------------------
-- MÉTODO: las 12 filas afirmadas comparan SEMÁNTICA, no existencia
--
-- Revisión del 2026-08-25. Hasta entonces la mayoría de los chequeos afirmados
-- preguntaban si un objeto EXISTÍA CON CIERTO NOMBRE, no si hacía lo que dice
-- que hace. Un índice recreado sin su predicado parcial, un CHECK reescrito
-- como `check (true)`, una política de RLS con `using (true)`, una FK apuntando
-- al padre equivocado: los cuatro pasaban.
--
-- Ahora cada afirmación compara contra la definición completa. Dos técnicas,
-- según lo que el catálogo ofrezca:
--
--   a) Valores de catálogo, sin texto renderizado (filas 11, 12, 14 y 16):
--      confupdtype, confdeltype, confmatchtype, conkey/confkey e indkey
--      resueltos a nombres de columna, y opcname para la clase de operadores.
--      No hay ambigüedad de formato posible.
--   b) La salida de pg_get_indexdef / pg_get_constraintdef / pg_get_triggerdef
--      —la normalización que hace el propio Postgres— comparada contra la
--      definición esperada, pasando LAS DOS por el mismo normalizador.
--
-- EL NORMALIZADOR, y por qué existe. Postgres reconstruye las expresiones desde
-- el árbol sintáctico, no desde el texto original: agrega paréntesis, califica
-- esquemas y hace explícitos los casts. `lower(email)` sobre una columna
-- varchar vuelve como `lower((email)::text)`. Comparar contra el texto que uno
-- escribió falla por eso, y aflojar la comparación hasta que pase es cómo se
-- llega a un chequeo que no verifica nada. La salida se normaliza sacando:
--
--   1. los casts explícitos (lista cerrada de tipos, incluidos los enums
--      entre comillas — nunca un patrón abierto, que se comería la expresión);
--   2. la calificación `public.`, que depende del search_path del momento;
--   3. espacios y paréntesis, y se pasa todo a minúsculas.
--
-- LÍMITE CONOCIDO: sacar los paréntesis pierde la asociatividad, así que
-- `a AND (b OR c)` y `(a AND b) OR c` normalizan igual. Ninguno de los
-- predicados de acá tiene esa forma —son conjunciones de comparaciones
-- simples— y se prefirió esta pérdida acotada antes que depender de acertarle
-- a la parentización exacta que elige Postgres, que es justamente la clase de
-- fragilidad que esta revisión vino a sacar. Si alguna vez se agrega un
-- predicado con OR mezclado, este chequeo deja de distinguirlo.
--
-- Cuando una afirmación falla, el resultado incluye la definición REAL además
-- del nombre del objeto: el mensaje tiene que alcanzar para arreglarlo sin
-- volver a la base.
--
-- EL NORMALIZADOR ESTÁ COPIADO 13 VECES, y las 13 tienen que ser IDÉNTICAS.
-- Postgres no deja declarar una función en una sentencia de solo lectura, y
-- este archivo tiene que seguir siendo una sola sentencia pegable en el SQL
-- Editor, así que la repetición es el precio. Una copia que diverja convierte
-- esa fila en un chequeo distinto del que dice ser — y en la primera versión de
-- este archivo eso ya pasó: la fila 15 tenía dos reemplazos en vez de tres.
--
-- src/lib/schema-diagnostic.integration-test.ts cuenta las apariciones, afirma
-- el número EXACTO, y afirma además que no queda en el archivo ninguna otra
-- secuencia de reemplazos anidados fuera de las dos calificaciones de regclass
-- de las filas 14 y 16. Agregar una copia, modificar una, o inventar una variante,
-- rompe ese test.
--
-- DEUDA OPCIONAL: reordenar el cuerpo como CTE para que el normalizador aparezca
-- una sola vez. Ese test ya cerró el riesgo, así que lo que queda es estética, y
-- la CTE tendría que abstraer sobre cuatro formas de comparación genuinamente
-- distintas — no se hace hasta que haya con qué probarla.
--
-- REGLA cuando una fila falla: la corrección es poner en `esperado` lo que la
-- base devolvió de verdad. Nunca aflojar el normalizador, nunca agregar un tipo
-- a la lista de casts para que pase, nunca tocar el esquema. Un `esperado` mal
-- transcrito es un bug de una línea; un normalizador aflojado es exactamente
-- cómo se llegó al `ilike` de una subcadena que esta revisión vino a sacar.
-- ---------------------------------------------------------------------------

select n, chequeo, resultado, esperado
from (

  -- V-1 ─ ¿PostgREST puede escribir? Este es el chequeo que decide C-1.
  --
  -- has_table_privilege, no information_schema.role_table_grants. La vista solo
  -- lista las ACL cuyo grantee es literalmente 'anon' o 'authenticated', así que
  -- un `GRANT INSERT ... TO PUBLIC` —que les da el privilegio a los dos igual—
  -- era INVISIBLE para el chequeo anterior: decía "ninguno" con PostgREST
  -- abierto de par en par. has_table_privilege responde la pregunta semántica
  -- ("¿puede este rol escribir en esta tabla?") e incluye PUBLIC, la herencia
  -- por membresía de rol y el WITH GRANT OPTION.
  --
  -- La vista tenía además un límite propio: solo muestra privilegios donde el
  -- rol de la conexión es grantor, grantee o miembro de alguno. Con el rol de
  -- DATABASE_URL en producción eso no está garantizado, y lo que no se ve pasa
  -- como "ninguno".
  select 1 as n,
    'V-1 · Escritura de anon/authenticated sobre public' as chequeo,
    coalesce(string_agg(distinct r.rol || ':' || t.relname || ':' || p.priv, ', '), 'ninguno') as resultado,
    'ninguno — si aparece INSERT/UPDATE/DELETE, C-1 es explotable hoy' as esperado
  from pg_class t
  join pg_namespace ns on ns.oid = t.relnamespace
  cross join (select rolname as rol from pg_roles where rolname in ('anon', 'authenticated')) r
  cross join (values ('INSERT'::text), ('UPDATE'), ('DELETE')) as p(priv)
  where ns.nspname = 'public'
    and t.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege(r.rol, t.oid, p.priv)

  union all

  -- V-1b ─ Lectura. Aunque la escritura esté cerrada, la lectura directa
  -- expone filas soft-deleted y emails de invitaciones a cualquier USER.
  select 2,
    'V-1b · Lectura de anon/authenticated sobre public',
    coalesce(string_agg(distinct r.rol || ':' || t.relname, ', '), 'ninguno'),
    'ninguno si se aplica la opción A de C-1'
  from pg_class t
  join pg_namespace ns on ns.oid = t.relnamespace
  cross join (select rolname as rol from pg_roles where rolname in ('anon', 'authenticated')) r
  where ns.nspname = 'public'
    and t.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege(r.rol, t.oid, 'SELECT')

  union all

  -- V-3 ─ Premisa de toda la sección 5 de authentication-architecture.md.
  select 3,
    'V-3 · Roles con BYPASSRLS',
    coalesce(string_agg(rolname, ', '), 'ninguno'),
    'el rol de DATABASE_URL debería estar acá'
  from pg_roles
  where rolbypassrls and rolname not like 'pg\_%'

  union all

  -- V-2 ─ RLS habilitada.
  select 4,
    'V-2 · Tablas de public SIN row level security',
    coalesce(string_agg(c.relname, ', '), 'ninguna'),
    'a lo sumo _prisma_migrations'
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all

  -- V-2 ─ Las políticas de RLS, comparadas por DEFINICIÓN.
  --
  -- Antes esto era `count(*) = 12`. Un conteo no dice nada sobre aislamiento:
  -- borrar contacts_isolation y agregar una política `using (true)` deja el
  -- conteo en 12 y el chequeo en verde con la base abierta. Peor todavía,
  -- cambiar `using (organization_id = current_organization_id())` por
  -- `using (true)` ni siquiera mueve el conteo.
  --
  -- El FULL OUTER JOIN atrapa las dos direcciones: una política esperada que
  -- falta o cambió (a.firma is null) y una política que existe sin estar en la
  -- lista (e.firma is null). Es lo que el conteo pretendía cubrir, hecho de
  -- verdad.
  --
  -- La firma incluye permissive y roles a propósito: una política RESTRICTIVE,
  -- o una acotada con `TO authenticated`, cambian su semántica sin tocar la
  -- expresión.
  select 5,
    'V-2 · Políticas RLS que faltan, sobran o cambiaron de definición',
    coalesce(
      string_agg(coalesce('SOBRA/CAMBIÓ: ' || a.firma, 'FALTA/CAMBIÓ: ' || e.firma), ' ;; '),
      'ninguna'
    ),
    'ninguna'
  from (
    select tabla || '.' || tabla || '_isolation/ALL/PERMISSIVE/{public}'
        || '/(organization_id = current_organization_id())'
        || '/(organization_id = current_organization_id())' as firma
    from (values
      ('users'), ('companies'), ('contacts'), ('opportunities'), ('pipelines'),
      ('activities'), ('stages'), ('invitations'), ('sources'), ('ingestion_events'),
      -- M-5 (auditoría 2026-08-29), migración 20260901120000: las seis tablas
      -- del outbox y del módulo de agenda con política de aislamiento.
      -- google_calendar_connections NO está acá a propósito, igual que
      -- api_keys: RLS habilitada y cero políticas (deny-all, guarda secretos).
      ('outbox_events'), ('branches'), ('resources'), ('service_types'),
      ('working_hours'), ('bookings'),
      -- Fase 1 de docs/qr-integration.md, migración 20260903120000: la única
      -- tabla del módulo QR con política de aislamiento. Las otras cuatro
      -- (qr_payment_events, qr_subscription_status_changes,
      -- qr_billing_exemption_changes, platform_admins) tienen RLS habilitada y
      -- cero políticas a propósito — deny-all, como api_keys.
      ('qr_codes')
    ) as t(tabla)
    union all
    select 'organizations.organizations_isolation/SELECT/PERMISSIVE/{public}/(id = current_organization_id())/-'
    union all
    select 'roles.roles_read_all/SELECT/PERMISSIVE/{public}/(auth.role() = ''authenticated'')/-'
  ) as e(firma)
  full outer join (
    select p.tablename || '.' || p.policyname || '/' || p.cmd || '/' || p.permissive
        || '/' || p.roles::text || '/' || coalesce(p.qual, '-')
        || '/' || coalesce(p.with_check, '-') as firma
    from pg_policies p
    where p.schemaname = 'public'
  ) as a
    on lower(regexp_replace(regexp_replace(regexp_replace(a.firma, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
     = lower(regexp_replace(regexp_replace(regexp_replace(e.firma, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
  where a.firma is null or e.firma is null

  union all

  -- V-2 ─ Políticas que permiten escritura: la causa raíz de C-1.
  select 6,
    'C-1 · Políticas con permiso de escritura (cmd = ALL)',
    coalesce(string_agg(policyname, ', '), 'ninguna'),
    'ninguna si se aplica la opción B de C-1'
  from pg_policies
  where schemaname = 'public' and cmd = 'ALL'

  union all

  -- V-2 ─ Los 9 índices únicos parciales, comparados por DEFINICIÓN COMPLETA.
  --
  -- Antes esto buscaba el NOMBRE en pg_indexes y nada más. Los tres agujeros que
  -- eso dejaba, todos con historia en este proyecto:
  --   - recrear el índice sin `where deleted_at is null` (el bug que
  --     pipelines_org_default_unique ya tuvo una vez, y que dejaría a una
  --     organización sin poder volver a tener un pipeline default);
  --   - recrearlo como índice NO único (adiós idempotencia de la ingesta);
  --   - recrearlo sobre otras columnas.
  -- Los tres pasaban el chequeo por nombre.
  --
  -- pg_get_indexdef cubre método, unicidad, columnas, expresiones y predicado
  -- de una sola vez. Comparar la definición entera es más estricto que
  -- enumerar propiedades y no deja huecos por olvido.
  select 7,
    'V-2 · Índices únicos parciales que faltan o cambiaron de definición',
    coalesce(string_agg(e.nombre || ' → ' || coalesce(a.def, 'FALTA'), ' ;; ' order by e.nombre), 'ninguno'),
    'ninguno'
  from (values
    ('contacts_org_email_unique',
     'CREATE UNIQUE INDEX contacts_org_email_unique ON public.contacts USING btree (organization_id, lower(email)) WHERE (email IS NOT NULL AND deleted_at IS NULL)'),
    ('pipelines_org_default_unique',
     'CREATE UNIQUE INDEX pipelines_org_default_unique ON public.pipelines USING btree (organization_id) WHERE (is_default = true AND deleted_at IS NULL)'),
    ('stages_pipeline_order_unique',
     'CREATE UNIQUE INDEX stages_pipeline_order_unique ON public.stages USING btree (pipeline_id, "order") WHERE (deleted_at IS NULL)'),
    ('stages_pipeline_name_unique',
     'CREATE UNIQUE INDEX stages_pipeline_name_unique ON public.stages USING btree (pipeline_id, name) WHERE (deleted_at IS NULL)'),
    ('stages_pipeline_won_unique',
     'CREATE UNIQUE INDEX stages_pipeline_won_unique ON public.stages USING btree (pipeline_id) WHERE (is_won = true AND deleted_at IS NULL)'),
    ('stages_pipeline_lost_unique',
     'CREATE UNIQUE INDEX stages_pipeline_lost_unique ON public.stages USING btree (pipeline_id) WHERE (is_lost = true AND deleted_at IS NULL)'),
    ('invitations_org_email_pending_unique',
     'CREATE UNIQUE INDEX invitations_org_email_pending_unique ON public.invitations USING btree (organization_id, email) WHERE (status = ''PENDING'')'),
    ('ingestion_events_source_external_unique',
     'CREATE UNIQUE INDEX ingestion_events_source_external_unique ON public.ingestion_events USING btree (source_id, external_id) WHERE (external_id IS NOT NULL)'),
    -- V-4 (docs/auditoria-2026-08-29.md): nació en la fila 17 como índice NO
    -- único (M-7) y la migración 20260902140000 lo reemplazó por este UNIQUE.
    -- Sin UNIQUE, findFirst + markBookingCancelled podrían cancelar la reserva
    -- equivocada si dos calendarios de la misma organización repitieran un id.
    ('bookings_org_google_event_unique',
     'CREATE UNIQUE INDEX bookings_org_google_event_unique ON public.bookings USING btree (organization_id, google_event_id) WHERE (google_event_id IS NOT NULL)')
  ) as e(nombre, esperado)
  left join lateral (
    select pg_get_indexdef(i.oid) as def
    from pg_class i
    join pg_namespace ins on ins.oid = i.relnamespace
    where ins.nspname = 'public' and i.relname = e.nombre and i.relkind = 'i'
  ) as a on true
  where a.def is null
     or lower(regexp_replace(regexp_replace(regexp_replace(a.def, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
      <> lower(regexp_replace(regexp_replace(regexp_replace(e.esperado, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))

  union all

  -- V-2 ─ Los 14 CHECK constraints, comparados por DEFINICIÓN.
  --
  -- Antes se buscaba `conname = x and contype = 'c'`. Reescribir
  -- opportunities_amount_non_negative_check como `check (true)` pasaba, y la
  -- base aceptaba montos negativos con el chequeo en verde. La firma incluye la
  -- tabla porque conname no es único por base: un CHECK con el mismo nombre en
  -- otra tabla contaba como presente.
  --
  -- Los 6 del módulo de Booking / Google Calendar se agregaron por M-6 de
  -- docs/auditoria-2026-08-29.md: hasta entonces esta fila afirmaba 5 de 11,
  -- y perder en un rebase la sección de CHECKs de 20260830120000 pasaba
  -- migrate deploy, verify:schema y la suite (Zod frena todo en el borde de
  -- la API) sin que nada lo dijera.
  --
  -- ATENCIÓN con google_calendar_connections_channel_all_or_none_check: es el
  -- PRIMER CHECK afirmado con la forma (A AND B AND C) OR (D AND E AND F), o
  -- sea con OR y AND mezclados. Es exactamente el límite conocido del
  -- normalizador que documenta el encabezado (líneas 49-55): al sacar los
  -- paréntesis se pierde la asociatividad, así que esta fila ya no distingue
  -- esa parentización de otra que reparta los mismos operandos de otra
  -- manera. Se acepta a sabiendas —la alternativa era depender de acertarle a
  -- la parentización exacta que elige Postgres— y NO se toca el normalizador.
  select 8,
    'V-2 · CHECK constraints que faltan o cambiaron de definición',
    coalesce(string_agg(e.nombre || ' → ' || coalesce(a.def, 'FALTA'), ' ;; ' order by e.nombre), 'ninguno'),
    'ninguno'
  from (values
    ('opportunities_company_or_contact_check', 'opportunities',
     'CHECK (company_id IS NOT NULL OR contact_id IS NOT NULL)'),
    ('opportunities_amount_non_negative_check', 'opportunities',
     'CHECK (amount >= 0)'),
    ('stages_won_lost_exclusive_check', 'stages',
     'CHECK (NOT (is_won AND is_lost))'),
    ('activities_related_entity_check', 'activities',
     'CHECK (company_id IS NOT NULL OR contact_id IS NOT NULL OR opportunity_id IS NOT NULL)'),
    ('contacts_email_trimmed_check', 'contacts',
     'CHECK (email IS NULL OR email = btrim(email))'),
    ('service_types_duration_positive_check', 'service_types',
     'CHECK (duration_min > 0)'),
    ('service_types_capacity_positive_check', 'service_types',
     'CHECK (capacity >= 1)'),
    ('google_calendar_connections_active_requires_token_check', 'google_calendar_connections',
     'CHECK (status <> ''ACTIVE'' OR refresh_token IS NOT NULL)'),
    ('working_hours_minute_range_check', 'working_hours',
     'CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute)'),
    ('bookings_time_range_check', 'bookings',
     'CHECK (starts_at < ends_at)'),
    ('google_calendar_connections_channel_all_or_none_check', 'google_calendar_connections',
     'CHECK (channel_id IS NULL AND channel_resource_id IS NULL AND channel_expiration IS NULL OR channel_id IS NOT NULL AND channel_resource_id IS NOT NULL AND channel_expiration IS NOT NULL)'),
    -- Módulo QR (docs/qr-integration.md, migración 20260903120000): los tres
    -- CHECK portados de QR Reviews. El normalizador quita el cast al enum
    -- (::"QrType", ::"QrSubscriptionChangeSource") que pg_get_constraintdef
    -- agrega a los literales.
    ('qr_codes_name_destination_iff_claimed', 'qr_codes',
     'CHECK (branch_id IS NULL AND name IS NULL AND destination_url IS NULL OR branch_id IS NOT NULL AND name IS NOT NULL AND destination_url IS NOT NULL)'),
    ('qr_codes_used_at_only_single_use', 'qr_codes',
     'CHECK (used_at IS NULL OR qr_type = ''SINGLE_USE'')'),
    ('qr_subscription_status_changes_changed_by_only_for_admin', 'qr_subscription_status_changes',
     'CHECK (source = ''PLATFORM_ADMIN'' AND changed_by_platform_admin_id IS NOT NULL OR source = ''MERCADOPAGO_WEBHOOK'' AND changed_by_platform_admin_id IS NULL)')
  ) as e(nombre, tabla, esperado)
  left join lateral (
    select pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_namespace cns on cns.oid = c.connamespace
    where cns.nspname = 'public'
      and c.contype = 'c'
      and c.conname = e.nombre
      and c.conrelid = ('public.' || e.tabla)::regclass
  ) as a on true
  where a.def is null
     or lower(regexp_replace(regexp_replace(regexp_replace(a.def, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
      <> lower(regexp_replace(regexp_replace(regexp_replace(e.esperado, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))

  union all

  -- V-2 ─ Los 2 triggers de sincronización de email, por DEFINICIÓN.
  --
  -- Antes se buscaba tgname en pg_trigger, SIN filtrar por tabla: un trigger con
  -- ese nombre en cualquier relación de cualquier esquema contaba como presente.
  -- Y no se miraba ni el momento (BEFORE/AFTER), ni el evento, ni la función
  -- invocada, ni la cláusula WHEN — cambiar el BEFORE por un AFTER rompe la
  -- sincronización de email y pasaba igual.
  select 9,
    'V-2 · Triggers de email que faltan o cambiaron de definición',
    coalesce(string_agg(e.nombre || ' → ' || coalesce(a.def, 'FALTA'), ' ;; ' order by e.nombre), 'ninguno'),
    'ninguno'
  from (values
    ('trg_set_user_email_from_auth', 'public.users',
     'CREATE TRIGGER trg_set_user_email_from_auth BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_user_email_from_auth()'),
    ('trg_propagate_auth_email_change', 'auth.users',
     'CREATE TRIGGER trg_propagate_auth_email_change AFTER UPDATE OF email ON auth.users FOR EACH ROW WHEN (old.email IS DISTINCT FROM new.email) EXECUTE FUNCTION propagate_auth_email_change()')
  ) as e(nombre, tabla, esperado)
  left join lateral (
    select pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    where not t.tgisinternal
      and t.tgname = e.nombre
      and t.tgrelid = e.tabla::regclass
  ) as a on true
  where a.def is null
     or lower(regexp_replace(regexp_replace(regexp_replace(a.def, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
      <> lower(regexp_replace(regexp_replace(regexp_replace(e.esperado, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))

  union all

  -- V-2 ─ current_organization_id(), por PROPIEDADES y por CUERPO.
  --
  -- Antes alcanzaba con que existiera una función con ese nombre. Las tres
  -- propiedades que la hacen funcionar no se miraban, y sin cualquiera de ellas
  -- la función existe y el aislamiento por RLS se cae:
  --   - security definer: sin esto, leer public.users para resolver la
  --     organización vuelve a evaluar RLS sobre public.users — la recursión que
  --     esta función existe para cortar;
  --   - search_path fijado: sin esto es un vector de secuestro clásico, porque
  --     el caller elige qué tabla `users` se lee;
  --   - el cuerpo: reescribirla como `select null` deja toda política de
  --     aislamiento devolviendo cero filas, o peor, según cómo se combine.
  select 10,
    'V-2 · Función current_organization_id() (propiedades + cuerpo)',
    coalesce(
      (select case
         when lower(regexp_replace(regexp_replace(regexp_replace(
                'secdef=' || p.prosecdef::text || '/vol=' || p.provolatile::text
                  || '/ret=' || pg_catalog.format_type(p.prorettype, null)
                  || '/cfg=' || coalesce(array_to_string(p.proconfig, ','), '-')
                  || '/body=' || p.prosrc,
                '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
            = lower(regexp_replace(regexp_replace(regexp_replace(
                'secdef=true/vol=s/ret=uuid/cfg=search_path=public/body=select organization_id from public.users where id = auth.uid();',
                '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
         then 'conforme'
         else 'CAMBIÓ: secdef=' || p.prosecdef::text || ' vol=' || p.provolatile::text
              || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '-')
              || ' body=' || p.prosrc
       end
       from pg_proc p
       join pg_namespace pns on pns.oid = p.pronamespace
       where pns.nspname = 'public' and p.proname = 'current_organization_id'),
      'FALTA'),
    'conforme'

  union all

  -- ALTO-6 ─ El índice que sirve al patrón de listado real.
  --
  -- DEJÓ DE SER INFORMATIVA (2026-08-28, P0 del roadmap). Hasta acá esta fila
  -- se imprimía sin afirmarse porque el hallazgo estaba abierto y fallaba a
  -- propósito.
  --
  -- Toda query de listado de las 6 entidades de negocio tiene la misma forma:
  --   WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC
  -- y ninguna de las 6 tenía un índice que la sirviera: ni uno solo incluía
  -- deleted_at, y ninguno empezaba por (organization_id, created_at). El plan
  -- era index scan sobre (organization_id), heap fetch de todo el tenant,
  -- filtrado de deleted_at y sort completo para devolver 20 filas — dos veces
  -- por request, porque findMany y count corren en paralelo con el mismo where.
  --
  -- ÍNDICE NO PARCIAL, y la decisión tiene motivo. Un parcial
  -- (organization_id, created_at) WHERE deleted_at IS NULL sería más chico
  -- porque no indexa las filas borradas, pero el DSL de Prisma no expresa
  -- predicados parciales: viviría solo en la migración, invisible para
  -- schema.prisma, que es exactamente el estado que C-2 vino a eliminar. Éste
  -- se declara con @@index y viaja por una migración normal.
  --
  -- SE COMPARA CONTRA EL CATÁLOGO POR COLUMNAS, no contra el texto de
  -- pg_indexes.indexdef como hacía la versión informativa. Un `like
  -- '%(organization_id, created_at%'` depende del formato exacto que renderiza
  -- Postgres y no distingue la posición de las columnas clave, que es
  -- justamente lo único que decide si el índice sirve para este plan.
  select 11,
    'ALTO-6 · Los 6 índices (organization_id, deleted_at, created_at) de las entidades listables',
    coalesce(string_agg('FALTA sobre ' || e.tabla, ' ;; ' order by e.tabla), 'ninguno'),
    'ninguno'
  from (values
    ('contacts'),
    ('companies'),
    ('opportunities'),
    ('activities'),
    ('pipelines'),
    ('stages')
  ) as e(tabla)
  where not exists (
    select 1
    from pg_index i
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace tns on tns.oid = tc.relnamespace
    where tns.nspname = 'public'
      and tc.relname = e.tabla
      and i.indisvalid
      -- Sin predicado: un índice parcial serviría igual para este plan, pero
      -- sería un objeto que schema.prisma no declara — la situación que la
      -- decisión de arriba descartó, y que este chequeo no debe dar por buena.
      and i.indpred is null
      and (select a.attname from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'organization_id'
      and (select a.attname from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = i.indkey[1]) = 'deleted_at'
      and (select a.attname from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = i.indkey[2]) = 'created_at'
  )

  union all

  -- ALTO-7 ─ pg_trgm y los 9 índices GIN que sirven a los search.
  --
  -- DEJÓ DE SER INFORMATIVA (2026-08-28, P0 del roadmap), igual que la fila 11,
  -- y por el mismo motivo: el hallazgo se cerró. Además dejó de preguntar solo
  -- si la extensión existe — una extensión instalada sin un solo índice GIN no
  -- acelera nada, así que "instalada" nunca fue la propiedad que importaba.
  --
  -- Los seis repositorios con search generan ILIKE '%x%' (el `contains` de
  -- Prisma con mode: insensitive). Un comodín inicial no puede usar un btree,
  -- ni siquiera sobre lower(col): sin pg_trgm es seq scan garantizado, y se
  -- paga dos veces por request porque findMany y count corren en paralelo con
  -- el mismo where.
  --
  -- Las 9 columnas son las que los buildWhere consultan de verdad, leídas del
  -- código y no supuestas: contacts (first_name, last_name, email), companies
  -- (name), opportunities (title), activities (subject, body), stages (name) y
  -- pipelines (name).
  --
  -- SE COMPARA CONTRA EL CATÁLOGO, no contra pg_get_indexdef. En Supabase las
  -- extensiones viven en el esquema extensions, así que el texto renderizado
  -- del índice trae la clase de operadores calificada como
  -- extensions.gin_trgm_ops — y el normalizador de este archivo saca la
  -- calificación public., no otras. Preguntarle a pg_opclass por el NOMBRE de
  -- la clase evita por completo esa dependencia de dónde quedó instalada la
  -- extensión. Es la técnica (a) del encabezado.
  select 12,
    'ALTO-7 · pg_trgm y los 9 índices GIN gin_trgm_ops de las columnas de búsqueda',
    coalesce(string_agg(falta, ' ;; ' order by falta), 'ninguno'),
    'ninguno'
  from (
    select 'FALTA la extensión pg_trgm' as falta
    where not exists (select 1 from pg_extension where extname = 'pg_trgm')

    union all

    select 'FALTA el índice GIN gin_trgm_ops sobre ' || e.tabla || '.' || e.columna
    from (values
      ('contacts', 'first_name'),
      ('contacts', 'last_name'),
      ('contacts', 'email'),
      ('companies', 'name'),
      ('opportunities', 'title'),
      ('activities', 'subject'),
      ('activities', 'body'),
      ('stages', 'name'),
      ('pipelines', 'name')
    ) as e(tabla, columna)
    where not exists (
      select 1
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_class tc on tc.oid = i.indrelid
      join pg_namespace tns on tns.oid = tc.relnamespace
      join pg_am am on am.oid = ic.relam
      join pg_opclass oc on oc.oid = i.indclass[0]
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where tns.nspname = 'public'
        and tc.relname = e.tabla
        and a.attname = e.columna
        and am.amname = 'gin'
        and oc.opcname = 'gin_trgm_ops'
        and i.indnkeyatts = 1
        and i.indisvalid
    )
  ) as faltantes

  union all

  -- B-9 ─ Filas cuyo UPDATE pondría email = NULL y violaría el NOT NULL.
  select 13,
    'B-9 · Filas de public.users sin fila en auth.users',
    count(*)::text,
    '0 — si es > 0, esos usuarios no se pueden actualizar ni remover'
  from public.users u
  where not exists (select 1 from auth.users a where a.id = u.id)

  union all

  -- C-3 ─ Toda FK entre dos tablas con organization_id es compuesta.
  --
  -- Es la garantía de aislamiento central del proyecto: Postgres rechazando a
  -- nivel de motor cualquier fila cuya organización no coincida con la de la
  -- fila referenciada.
  --
  -- ESTA FILA DEJÓ DE SER UNA LISTA (2026-08-28, P0 del roadmap). Antes
  -- enumeraba las 18 FKs conocidas y las comparaba una por una con un FULL
  -- OUTER JOIN. Eso afirmaba mucho sobre lo que YA existía y nada sobre lo que
  -- viniera después: una tabla nueva con organization_id —Resource,
  -- ServiceType, Booking, Agent, Conversation, Message, todas en el P2 del
  -- roadmap— podía nacer con una FK simple y el chequeo seguía diciendo
  -- "ninguna" hasta que alguien se acordara de editar la lista a mano. La
  -- garantía era de una lista mantenida, no del esquema.
  --
  -- Ahora la pregunta se hace al revés y sin lista: PARA TODA FK del esquema
  -- public cuyas dos tablas —la hija y la padre— tengan columna
  -- organization_id, esa FK tiene que ser
  -- (organization_id, x_id) -> padre(organization_id, id). Una tabla nueva
  -- queda cubierta por existir, no por acordarse.
  --
  -- El recorte deja afuera exactamente lo que tiene que dejar afuera, y se
  -- verificó contra el esquema real en vez de suponerse: las FKs
  -- x.organization_id -> organizations.id no entran (organizations no tiene
  -- columna organization_id, tiene id), y users.role_id / invitations.role_id
  -- tampoco (roles es un catálogo global, sin organización). Las 28 restantes
  -- son las que se afirman.
  --
  -- LAS ACCIONES REFERENCIALES SE SIGUEN AFIRMANDO, y también sin lista. La
  -- migración 20260821140200 no eligió el ON DELETE de cada FK por separado:
  -- fijó una regla —columna referenciante nullable -> NO ACTION, NOT NULL ->
  -- RESTRICT— y ON UPDATE CASCADE + MATCH SIMPLE para todas. Esa regla es
  -- derivable de pg_attribute.attnotnull, así que el chequeo la deriva en vez
  -- de transcribirla. Sin esto, generalizar habría cambiado un chequeo que
  -- atrapa un ON DELETE CASCADE colado por otro que no lo ve.
  --
  -- LA ÚNICA EXCEPCIÓN A ESA REGLA ESTÁ DECLARADA ABAJO, en un `values` con su
  -- motivo al lado, y no es una exención: el chequeo exige que
  -- stages -> pipelines sea CASCADE, y falla igual si dejara de serlo. Una
  -- excepción declarada para una FK que ya no existe también falla, con
  -- "EXCEPCIÓN HUÉRFANA" — por eso el FULL OUTER JOIN, que es lo único que
  -- quedó de la forma anterior.
  --
  -- LO QUE ESTA FILA NO PUEDE VER, y por eso existe la fila 16: a qué tabla
  -- padre debe apuntar cada FK. Una FK compuesta bien formada hacia el padre
  -- equivocado —ingestion_events(organization_id, promoted_contact_id) ->
  -- users en vez de contacts— es estructuralmente indistinguible de una
  -- correcta. Eso solo lo sabe un mapa, y ese mapa es la fila 16.
  select 14,
    'C-3 · Toda FK entre tablas con organization_id es compuesta, con las acciones de la regla',
    coalesce(string_agg(problema, ' ;; ' order by problema), 'ninguna'),
    'ninguna'
  from (
    select
      case
        when fk.conname is null then
          'EXCEPCIÓN HUÉRFANA: ' || exc.conname || ' está declarada como excepción y ya no es '
            || 'una FK entre dos tablas con organization_id — sacarla del `values`'
        when fk.n_cols = 1 then
          fk.hijo || '(' || fk.cols_hijo || ') -> ' || fk.padre || '(' || fk.cols_padre
            || '): FK SIMPLE, debería ser (organization_id, ' || fk.cols_hijo || ') -> '
            || fk.padre || '(organization_id, id)'
        when fk.cols_hijo not like 'organization_id,%' then
          fk.hijo || '(' || fk.cols_hijo || ') -> ' || fk.padre || '(' || fk.cols_padre
            || '): la primera columna referenciante debería ser organization_id'
        when fk.cols_padre <> 'organization_id,id' then
          fk.hijo || '(' || fk.cols_hijo || ') -> ' || fk.padre || '(' || fk.cols_padre
            || '): debería referenciar ' || fk.padre || '(organization_id, id)'
        when fk.upd <> 'c' then
          fk.hijo || '(' || fk.cols_hijo || '): ON UPDATE es ' || fk.upd
            || ' y debería ser CASCADE (c)'
        when fk.match_type <> 's' then
          fk.hijo || '(' || fk.cols_hijo || '): MATCH es ' || fk.match_type
            || ' y debería ser SIMPLE (s)'
        when fk.del <> coalesce(exc.del, case when fk.hija_not_null then 'r' else 'a' end) then
          fk.hijo || '(' || fk.cols_hijo || '): ON DELETE es ' || fk.del || ' y debería ser '
            || coalesce(exc.del, case when fk.hija_not_null then 'r' else 'a' end) || ' — '
            || coalesce(exc.motivo, case when fk.hija_not_null
                 then 'columna referenciante NOT NULL -> RESTRICT (r), regla de 20260821140200'
                 else 'columna referenciante nullable -> NO ACTION (a), regla de 20260821140200' end)
      end as problema
    from (values
      ('stages_organization_id_pipeline_id_fkey', 'c',
       'un Stage es una composición estricta de su Pipeline, no una referencia — única excepción declarada a la regla de 20260821140200')
    ) as exc(conname, del, motivo)
    full outer join (
      select
        c.conname as conname,
        regexp_replace(c.conrelid::regclass::text, '^public\.', '') as hijo,
        regexp_replace(c.confrelid::regclass::text, '^public\.', '') as padre,
        array_length(c.conkey, 1) as n_cols,
        (select string_agg(a.attname, ',' order by k.ord)
           from unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols_hijo,
        (select string_agg(a.attname, ',' order by k.ord)
           from unnest(c.confkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as cols_padre,
        -- La regla de ON DELETE mira la columna referenciante que NO es
        -- organization_id — esa es la que puede ser nullable. organization_id
        -- es NOT NULL en las 6 tablas y agregarla al bool_and no cambiaría
        -- nada, pero dejaría el chequeo dependiendo de que siga siéndolo.
        (select bool_and(a.attnotnull)
           from unnest(c.conkey) as k(attnum)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
           where a.attname <> 'organization_id') as hija_not_null,
        c.confupdtype::text as upd,
        c.confdeltype::text as del,
        c.confmatchtype::text as match_type
      from pg_constraint c
      join pg_namespace cns on cns.oid = c.connamespace
      where cns.nspname = 'public'
        and c.contype = 'f'
        and exists (select 1 from pg_attribute a
                      where a.attrelid = c.conrelid and a.attname = 'organization_id'
                        and a.attnum > 0 and not a.attisdropped)
        and exists (select 1 from pg_attribute a
                      where a.attrelid = c.confrelid and a.attname = 'organization_id'
                        and a.attnum > 0 and not a.attisdropped)
    ) as fk on fk.conname = exc.conname
  ) as hallazgos
  where problema is not null

  union all

  -- M-13 ─ La segunda columna clave del índice de email es lower(email).
  --
  -- Deliberadamente redundante con la fila 7, que ya compara la definición
  -- completa: esto es un guardarraíl con nombre propio para un hallazgo
  -- concreto, y falla con un mensaje que dice M-13 en vez de un diff de índice.
  --
  -- La versión anterior de esta fila era `indexdef ilike '%lower%'`, y es el
  -- ejemplo de manual de un chequeo vacío: pasa con CUALQUIER definición que
  -- mencione "lower" en cualquier parte —incluido un lower(first_name) en otra
  -- columna, o un lower() dentro del predicado— sin verificar que sea el email
  -- el que se compara sin distinguir mayúsculas. Pasaba, sí, pero no por la
  -- razón que decía.
  --
  -- pg_get_indexdef con número de columna devuelve la expresión de ESA columna
  -- clave y de ninguna otra.
  select 15,
    'M-13 · contacts_org_email_unique evalúa lower(email) en su 2.ª columna',
    coalesce(
      (select case
         when lower(regexp_replace(regexp_replace(regexp_replace(pg_get_indexdef(i.oid, 2, true), '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
            = 'loweremail'
         then 'sobre lower(email)'
         else 'CAMBIÓ: ' || pg_get_indexdef(i.oid, 2, true)
       end
       from pg_class i
       join pg_namespace ins on ins.oid = i.relnamespace
       where ins.nspname = 'public' and i.relname = 'contacts_org_email_unique' and i.relkind = 'i'),
      'FALTA el índice'),
    'sobre lower(email)'
  union all

  -- C-3 (bis) ─ El MAPA hijo -> padre de las 29 FKs conocidas.
  --
  -- Lo único que la fila 14 no puede saber. Ese chequeo es estructural, y una
  -- FK compuesta bien formada que apunte a la tabla equivocada
  -- —ingestion_events(organization_id, promoted_contact_id) -> users en vez de
  -- contacts— es indistinguible de una correcta: dos columnas, la primera
  -- organization_id de los dos lados, acciones referenciales conformes. Pasa la
  -- fila 14 entera, y la constraint queda comparando la organización contra la
  -- tabla que no es. Es un caso real y documentado, no hipotético: es el que
  -- motivó que este chequeo dejara de contar filas en la revisión del
  -- 2026-08-25.
  --
  -- NO EXHAUSTIVA A PROPÓSITO, y es la diferencia con la versión anterior. El
  -- FULL OUTER JOIN de antes fallaba también cuando SOBRABA una FK, así que
  -- cada tabla nueva con organization_id obligaba a editar esta lista a mano —
  -- exactamente la fricción que el P0 del roadmap vino a sacar. Acá el
  -- `where not exists` va en una sola dirección: una FK de la lista que falte o
  -- haya cambiado de padre FALLA; una FK nueva que no esté en la lista NO
  -- falla, porque de esa ya se ocupa la fila 14 por existir.
  --
  -- Por eso la firma no incluye upd/del/match: esas las afirma la fila 14 para
  -- todas, y repetirlas acá sería un segundo lugar donde mantener el mismo
  -- dato. Esta fila responde una sola pregunta, y es a quién apunta cada una.
  select 16,
    'C-3 · Las 29 FKs conocidas siguen apuntando a la tabla padre de su diseño',
    coalesce(string_agg('FALTA/CAMBIÓ DE PADRE: ' || e.firma, ' ;; ' order by e.firma), 'ninguna'),
    'ninguna'
  from (values
    ('activities_organization_id_assignee_id_fkey|activities(organization_id,assignee_id)->users(organization_id,id)'),
    ('activities_organization_id_author_id_fkey|activities(organization_id,author_id)->users(organization_id,id)'),
    ('activities_organization_id_company_id_fkey|activities(organization_id,company_id)->companies(organization_id,id)'),
    ('activities_organization_id_contact_id_fkey|activities(organization_id,contact_id)->contacts(organization_id,id)'),
    ('activities_organization_id_opportunity_id_fkey|activities(organization_id,opportunity_id)->opportunities(organization_id,id)'),
    ('api_keys_organization_id_source_id_fkey|api_keys(organization_id,source_id)->sources(organization_id,id)'),
    ('bookings_organization_id_branch_id_fkey|bookings(organization_id,branch_id)->branches(organization_id,id)'),
    ('bookings_organization_id_contact_id_fkey|bookings(organization_id,contact_id)->contacts(organization_id,id)'),
    ('bookings_organization_id_opportunity_id_fkey|bookings(organization_id,opportunity_id)->opportunities(organization_id,id)'),
    ('bookings_organization_id_resource_id_fkey|bookings(organization_id,resource_id)->resources(organization_id,id)'),
    ('bookings_organization_id_service_type_id_fkey|bookings(organization_id,service_type_id)->service_types(organization_id,id)'),
    ('companies_organization_id_owner_id_fkey|companies(organization_id,owner_id)->users(organization_id,id)'),
    ('contacts_organization_id_company_id_fkey|contacts(organization_id,company_id)->companies(organization_id,id)'),
    ('contacts_organization_id_owner_id_fkey|contacts(organization_id,owner_id)->users(organization_id,id)'),
    ('google_calendar_connections_organization_id_branch_id_fkey|google_calendar_connections(organization_id,branch_id)->branches(organization_id,id)'),
    ('ingestion_events_organization_id_promoted_contact_id_fkey|ingestion_events(organization_id,promoted_contact_id)->contacts(organization_id,id)'),
    ('ingestion_events_organization_id_source_id_fkey|ingestion_events(organization_id,source_id)->sources(organization_id,id)'),
    ('invitations_organization_id_invited_by_id_fkey|invitations(organization_id,invited_by_id)->users(organization_id,id)'),
    ('opportunities_organization_id_company_id_fkey|opportunities(organization_id,company_id)->companies(organization_id,id)'),
    ('opportunities_organization_id_contact_id_fkey|opportunities(organization_id,contact_id)->contacts(organization_id,id)'),
    ('opportunities_organization_id_owner_id_fkey|opportunities(organization_id,owner_id)->users(organization_id,id)'),
    ('opportunities_organization_id_pipeline_id_fkey|opportunities(organization_id,pipeline_id)->pipelines(organization_id,id)'),
    ('opportunities_organization_id_stage_id_fkey|opportunities(organization_id,stage_id)->stages(organization_id,id)'),
    ('qr_codes_organization_id_branch_id_fkey|qr_codes(organization_id,branch_id)->branches(organization_id,id)'),
    ('resources_organization_id_branch_id_fkey|resources(organization_id,branch_id)->branches(organization_id,id)'),
    ('service_types_organization_id_branch_id_fkey|service_types(organization_id,branch_id)->branches(organization_id,id)'),
    ('service_types_organization_id_resource_id_fkey|service_types(organization_id,resource_id)->resources(organization_id,id)'),
    ('stages_organization_id_pipeline_id_fkey|stages(organization_id,pipeline_id)->pipelines(organization_id,id)'),
    ('working_hours_organization_id_resource_id_fkey|working_hours(organization_id,resource_id)->resources(organization_id,id)')
  ) as e(firma)
  where not exists (
    select 1
    from pg_constraint c
    join pg_namespace cns on cns.oid = c.connamespace
    where cns.nspname = 'public'
      and c.contype = 'f'
      and c.conname || '|'
          || regexp_replace(c.conrelid::regclass::text, '^public\.', '') || '('
          || (select string_agg(a.attname, ',' order by k.ord)
                from unnest(c.conkey) with ordinality as k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          || ')->'
          || regexp_replace(c.confrelid::regclass::text, '^public\.', '') || '('
          || (select string_agg(a.attname, ',' order by k.ord)
                from unnest(c.confkey) with ordinality as k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
          || ')' = e.firma
  )

  union all

  -- V-2 ─ Los índices parciales NO únicos, comparados por DEFINICIÓN COMPLETA.
  --
  -- La fila 7 afirma solo los índices únicos parciales; hasta M-7 de
  -- docs/auditoria-2026-08-29.md ningún índice parcial no único estaba
  -- afirmado en ninguna fila. Un índice de rendimiento perdido en un rebase no
  -- rompe ningún test —la consulta sigue devolviendo lo mismo, solo que con un
  -- scan— y es exactamente la clase de regresión que solo un chequeo de esquema
  -- puede ver. Misma técnica que la fila 7: pg_get_indexdef entero contra la
  -- definición esperada, pasando los dos lados por el normalizador.
  --
  -- NACIÓ CON EL ÍNDICE DE bookings.google_event_id (M-7), que ya no está acá:
  -- V-4 lo volvió UNIQUE (migración 20260902140000) y pasó a la fila 7, que es
  -- la que afirma los únicos parciales. Hoy la fila contiene los tres de B-14;
  -- cualquier índice parcial no único nuevo va en ESTA MISMA fila, no en una
  -- nueva.
  select 17,
    'V-2 · Índices parciales no únicos que faltan o cambiaron de definición',
    coalesce(string_agg(e.nombre || ' → ' || coalesce(a.def, 'FALTA'), ' ;; ' order by e.nombre), 'ninguno'),
    'ninguno'
  from (values
    -- B-14 (docs/auditoria-2026-08-29.md): los índices de las COLAS. Si se
    -- pierden, los reclamos degradan a seq scan sin ningún error — la clase de
    -- regresión que solo este chequeo ve. El de ingestion_events es además el
    -- caso que motivó el hallazgo: cambió de forma con B-30 (migración
    -- 20260902130000, de (created_at) a la expresión con coalesce) y hasta
    -- esta fila nadie afirmaba ni la forma vieja ni la nueva.
    ('ingestion_events_pending_created_at_idx',
     'CREATE INDEX ingestion_events_pending_created_at_idx ON public.ingestion_events USING btree (COALESCE(next_attempt_at, created_at)) WHERE (status = ''PENDING''::"IngestionStatus")'),
    ('outbox_events_claimable_idx',
     'CREATE INDEX outbox_events_claimable_idx ON public.outbox_events USING btree (COALESCE(next_attempt_at, created_at)) WHERE (status = ''PENDING''::"OutboxStatus")'),
    ('sources_org_created_at_idx',
     'CREATE INDEX sources_org_created_at_idx ON public.sources USING btree (organization_id, created_at) WHERE (deleted_at IS NULL)')
  ) as e(nombre, esperado)
  left join lateral (
    select pg_get_indexdef(i.oid) as def
    from pg_class i
    join pg_namespace ins on ins.oid = i.relnamespace
    where ins.nspname = 'public' and i.relname = e.nombre and i.relkind = 'i'
  ) as a on true
  where a.def is null
     or lower(regexp_replace(regexp_replace(regexp_replace(a.def, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))
      <> lower(regexp_replace(regexp_replace(regexp_replace(e.esperado, '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), 'public\.', '', 'gi'), '[\s()]', '', 'g'))

  union all

  -- V-3 (docs/auditoria-2026-08-29.md) ─ Privilegios POR DEFECTO sobre las
  -- tablas NUEVAS de public.
  --
  -- Las filas 1 y 2 preguntan por las tablas que EXISTEN. Ésta pregunta por
  -- las que todavía no: pg_default_acl es lo que Postgres consulta al crear
  -- una tabla para decidir con qué ACL nace, y es donde 20260821140100 (sin
  -- FOR ROLE) y 20260902150000 (FOR ROLE postgres) registraron el REVOKE a
  -- anon/authenticated. Ninguna otra fila lo miraba: un rebase que perdiera
  -- esas migraciones, o una migración futura que volviera a otorgar, dejaría
  -- que la próxima tabla naciera abierta —y sin RLS hasta que M-5 se la
  -- agregue— sin que ningún test funcional lo note.
  --
  -- Valores de catálogo (técnica a): aclexplode sobre defaclacl, sin texto
  -- renderizado ni normalizador. Se mira PUBLIC además de anon/authenticated,
  -- por lo mismo que las filas 1 y 2: un GRANT ... TO PUBLIC se los da a los
  -- dos igual. Y no solo el rol `postgres`: cualquier rol que HOY sea dueño de
  -- tablas en public es un rol que crea tablas, y sus defaults también tienen
  -- que estar cerrados — es lo que hace estructural al chequeo. Los defaults
  -- de supabase_admin sobre public (que sí otorgan a anon/authenticated)
  -- quedan afuera mientras supabase_admin no sea dueño de ninguna tabla de
  -- public; el día que lo sea, esta fila lo dice.
  --
  -- SOLO TABLAS (defaclobjtype 'r'), como las migraciones que afirma. Los
  -- defaults sobre secuencias y funciones siguen siendo los de Supabase.
  select 18,
    'V-3 · Grants por defecto a anon/authenticated/PUBLIC sobre tablas nuevas de public',
    coalesce(string_agg(r.rolname || '→' || coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type, ', '
                        order by r.rolname, coalesce(g.rolname, 'PUBLIC'), a.privilege_type), 'ninguno'),
    'ninguno'
  from pg_default_acl d
  join pg_roles r on r.oid = d.defaclrole
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  left join pg_roles g on g.oid = a.grantee
  where n.nspname = 'public'
    and coalesce(g.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC')
    and (r.rolname = 'postgres'
         or exists (select 1 from pg_class c
                    where c.relkind in ('r', 'p') and c.relnamespace = n.oid and c.relowner = r.oid))
    and d.defaclobjtype = 'r'


) as diagnostico
order by n;


-- ---------------------------------------------------------------------------
-- Prueba definitiva de C-1 (opcional, fuera de SQL — solo si el chequeo 1
-- devuelve algo distinto de "ninguno").
--
-- Con la sesión de un usuario de rol USER abierta en la app, en la consola
-- del navegador:
--
--   const { data, error } = await window.supabase
--     .from('roles').select('id,name');
--   console.log(data, error);
--
-- Si `data` trae los roles, PostgREST está abierto. NO ejecutar el PATCH de
-- escalada contra una base con datos reales: alcanza con confirmar la
-- lectura.
-- ---------------------------------------------------------------------------
