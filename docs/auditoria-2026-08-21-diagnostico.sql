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
-- MÉTODO: las 9 filas afirmadas comparan SEMÁNTICA, no existencia
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
--   a) Valores de catálogo, sin texto renderizado (fila 14): confupdtype,
--      confdeltype, confmatchtype, conkey/confkey resueltos a nombres de
--      columna. No hay ambigüedad de formato posible.
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
      ('activities'), ('stages'), ('invitations'), ('sources'), ('ingestion_events')
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

  -- V-2 ─ Los 8 índices únicos parciales, comparados por DEFINICIÓN COMPLETA.
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
     'CREATE UNIQUE INDEX ingestion_events_source_external_unique ON public.ingestion_events USING btree (source_id, external_id) WHERE (external_id IS NOT NULL)')
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

  -- V-2 ─ Los 5 CHECK constraints, comparados por DEFINICIÓN.
  --
  -- Antes se buscaba `conname = x and contype = 'c'`. Reescribir
  -- opportunities_amount_non_negative_check como `check (true)` pasaba, y la
  -- base aceptaba montos negativos con el chequeo en verde. La firma incluye la
  -- tabla porque conname no es único por base: un CHECK con el mismo nombre en
  -- otra tabla contaba como presente.
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
     'CHECK (email IS NULL OR email = btrim(email))')
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

  -- A-6 ─ Índices que sirven al orden por defecto de los listados.
  select 11,
    'A-6 · Índices que empiezan por (organization_id, created_at)',
    coalesce(string_agg(indexname, ', '), 'ninguno'),
    '6, uno por entidad listable (A-6 sigue abierto para las 6 viejas) —
     sources ya lo tiene, parcial, desde la capa de ingesta'
  from pg_indexes
  where schemaname = 'public'
    and indexdef like '%(organization_id, created_at%'

  union all

  -- A-7 ─ Búsqueda de texto.
  select 12,
    'A-7 · Extensión pg_trgm',
    case when exists (select 1 from pg_extension where extname = 'pg_trgm')
      then 'instalada' else 'no instalada' end,
    'instalada solo si se implementa la opción A de A-7'

  union all

  -- B-9 ─ Filas cuyo UPDATE pondría email = NULL y violaría el NOT NULL.
  select 13,
    'B-9 · Filas de public.users sin fila en auth.users',
    count(*)::text,
    '0 — si es > 0, esos usuarios no se pueden actualizar ni remover'
  from public.users u
  where not exists (select 1 from auth.users a where a.id = u.id)

  union all

  -- C-3 ─ Las 18 FKs compuestas por organización, UNA POR UNA.
  --
  -- Es la garantía de aislamiento central del proyecto: Postgres rechazando a
  -- nivel de motor cualquier fila cuya organización no coincida con la de la
  -- fila referenciada.
  --
  -- Antes esto contaba filas de pg_constraint y comparaba el total con 18. Un
  -- conteo no distingue CUÁLES: borrar activities → contacts y agregar
  -- cualquier otra FK de dos columnas que empiece por organization_id deja el
  -- total en 18. Peor: una FK que apunte al PADRE EQUIVOCADO —
  -- ingestion_events(organization_id, promoted_contact_id) → users en vez de
  -- contacts— también contaba, y la constraint quedaba comparando la
  -- organización contra la tabla que no era.
  --
  -- Este chequeo no renderiza texto: compara valores de catálogo. conkey y
  -- confkey resueltos a nombres de columna, y confupdtype/confdeltype/
  -- confmatchtype como los códigos de una letra que guarda Postgres
  -- (a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, s=MATCH SIMPLE). No hay
  -- ambigüedad de formato posible, y las acciones referenciales —que son una
  -- decisión de diseño discutida y documentada en la migración 20260821140200—
  -- quedan afirmadas junto con el resto.
  --
  -- El FULL OUTER JOIN atrapa las dos direcciones: la que falta o cambió, y la
  -- que aparece sin estar en la lista. Agregar una FK compuesta nueva obliga a
  -- actualizar esta lista, que es exactamente lo que se quiere.
  select 14,
    'C-3 · FKs compuestas (organization_id, x_id) -> padre(organization_id, id)',
    coalesce(
      string_agg(coalesce('SOBRA/CAMBIÓ: ' || a.firma, 'FALTA/CAMBIÓ: ' || e.firma), ' ;; '),
      'ninguna'
    ),
    'ninguna'
  from (values
    ('activities_organization_id_assignee_id_fkey|activities(organization_id,assignee_id)->users(organization_id,id) upd=c del=a match=s'),
    ('activities_organization_id_author_id_fkey|activities(organization_id,author_id)->users(organization_id,id) upd=c del=r match=s'),
    ('activities_organization_id_company_id_fkey|activities(organization_id,company_id)->companies(organization_id,id) upd=c del=a match=s'),
    ('activities_organization_id_contact_id_fkey|activities(organization_id,contact_id)->contacts(organization_id,id) upd=c del=a match=s'),
    ('activities_organization_id_opportunity_id_fkey|activities(organization_id,opportunity_id)->opportunities(organization_id,id) upd=c del=a match=s'),
    ('api_keys_organization_id_source_id_fkey|api_keys(organization_id,source_id)->sources(organization_id,id) upd=c del=r match=s'),
    ('companies_organization_id_owner_id_fkey|companies(organization_id,owner_id)->users(organization_id,id) upd=c del=a match=s'),
    ('contacts_organization_id_company_id_fkey|contacts(organization_id,company_id)->companies(organization_id,id) upd=c del=a match=s'),
    ('contacts_organization_id_owner_id_fkey|contacts(organization_id,owner_id)->users(organization_id,id) upd=c del=a match=s'),
    ('ingestion_events_organization_id_promoted_contact_id_fkey|ingestion_events(organization_id,promoted_contact_id)->contacts(organization_id,id) upd=c del=a match=s'),
    ('ingestion_events_organization_id_source_id_fkey|ingestion_events(organization_id,source_id)->sources(organization_id,id) upd=c del=r match=s'),
    ('invitations_organization_id_invited_by_id_fkey|invitations(organization_id,invited_by_id)->users(organization_id,id) upd=c del=r match=s'),
    ('opportunities_organization_id_company_id_fkey|opportunities(organization_id,company_id)->companies(organization_id,id) upd=c del=a match=s'),
    ('opportunities_organization_id_contact_id_fkey|opportunities(organization_id,contact_id)->contacts(organization_id,id) upd=c del=a match=s'),
    ('opportunities_organization_id_owner_id_fkey|opportunities(organization_id,owner_id)->users(organization_id,id) upd=c del=r match=s'),
    ('opportunities_organization_id_pipeline_id_fkey|opportunities(organization_id,pipeline_id)->pipelines(organization_id,id) upd=c del=r match=s'),
    ('opportunities_organization_id_stage_id_fkey|opportunities(organization_id,stage_id)->stages(organization_id,id) upd=c del=r match=s'),
    ('stages_organization_id_pipeline_id_fkey|stages(organization_id,pipeline_id)->pipelines(organization_id,id) upd=c del=c match=s')
  ) as e(firma)
  full outer join (
    select c.conname || '|'
        || regexp_replace(c.conrelid::regclass::text, '^public\.', '') || '('
        || (select string_agg(a.attname, ',' order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
        || ')->'
        || regexp_replace(c.confrelid::regclass::text, '^public\.', '') || '('
        || (select string_agg(a.attname, ',' order by k.ord)
              from unnest(c.confkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
        || ') upd=' || c.confupdtype::text || ' del=' || c.confdeltype::text
        || ' match=' || c.confmatchtype::text as firma
    from pg_constraint c
    join pg_namespace cns on cns.oid = c.connamespace
    where cns.nspname = 'public'
      and c.contype = 'f'
      and array_length(c.conkey, 1) = 2
      and (select a.attname from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'organization_id'
      and (select a.attname from pg_attribute a
             where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) = 'organization_id'
  ) as a on a.firma = e.firma
  where a.firma is null or e.firma is null

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
         when lower(regexp_replace(regexp_replace(pg_get_indexdef(i.oid, 2, true), '::(character varying|text|numeric|bpchar|uuid|integer|bigint|boolean|date|jsonb|"[^"]+")', '', 'g'), '[\s()]', '', 'g'))
            = 'loweremail'
         then 'sobre lower(email)'
         else 'CAMBIÓ: ' || pg_get_indexdef(i.oid, 2, true)
       end
       from pg_class i
       join pg_namespace ins on ins.oid = i.relnamespace
       where ins.nspname = 'public' and i.relname = 'contacts_org_email_unique' and i.relkind = 'i'),
      'FALTA el índice'),
    'sobre lower(email)'

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
