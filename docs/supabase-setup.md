# Configuración del proyecto de Supabase

Runbook para levantar un entorno desde cero. Existe porque en agosto de 2026
el proyecto de Supabase original se perdió y **nada de esta configuración
estaba registrada** en el repositorio: hubo que reconstruirla de memoria.

Última reconstrucción verificada: **2026-08-21**.

---

## 1. Crear el proyecto

| Campo | Valor |
|---|---|
| Region | **South America (São Paulo)** — `sa-east-1` |
| Plan | Free |
| Database password | Generar y **guardar en un gestor de contraseñas antes de confirmar** |

Sobre la contraseña: evitar `@`, `#`, `/`, `:` y `?`. Van dentro de una URL de
conexión y hay que escaparlos (`@` → `%40`, etc.). Generar otra es más barato
que depurar un `P1000`.

> Los proyectos del plan free se **pausan tras una semana de inactividad** y
> eventualmente se eliminan. Si el proyecto desaparece, este documento es el
> camino de vuelta.

---

## 2. Variables de entorno

Los valores salen del panel: **Project Settings → API** (URL y claves) y el
botón **Connect → ORMs → Prisma** (las dos cadenas de conexión ya armadas).

### `.env` (raíz — backend)

```
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"

SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=debug
```

### `frontend/.env`

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<la misma anon key>
VITE_API_URL=http://localhost:4000
```

`<ref>` es el identificador del proyecto: aparece en la URL del panel
(`supabase.com/dashboard/project/<ref>`), en `SUPABASE_URL` y dentro del
usuario de las cadenas de conexión (`postgres.<ref>`). Los tres tienen que
coincidir.

### Reglas que no se negocian

- La **service role key va únicamente en el `.env` de la raíz**, nunca con
  prefijo `VITE_`. Vite expone al bundle del navegador toda variable con ese
  prefijo.
- Las dos cadenas apuntan al **mismo host** (`...pooler.supabase.com`) y se
  diferencian **solo por el puerto**: 6543 para `DATABASE_URL` (pooler en modo
  transacción, la que usa la app en runtime), 5432 para `DIRECT_URL` (la que
  usan las migraciones). No usar la cadena de "conexión directa"
  (`db.<ref>.supabase.co`): suele ser solo IPv6 y muchas redes no la alcanzan.

### Cuatro errores que ya nos costaron tiempo

1. **`[YOUR-PASSWORD]` sin reemplazar.** Los corchetes forman parte del
   marcador y también se borran. Síntoma: `P1000 Authentication failed`.
2. **`SUPABASE_URL` con `/rest/v1/` al final.** Es la URL de la Data API, no
   la del proyecto. `src/lib/jwt.ts` concatena
   `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, así que con la ruta de más
   **todos los tokens se rechazan con 401** y —por el hallazgo B-13— sin
   ningún log que lo explique.
3. **`&connection_limit=1` en `DATABASE_URL`.** Supabase a veces lo incluye;
   es para entornos serverless. En un servidor Express permanente hay que
   borrarlo.
4. **Confundir el usuario del pooler.** Contra `...pooler.supabase.com` el
   usuario es `postgres.<ref>`, no `postgres` a secas: el host es compartido y
   el usuario identifica el proyecto.

---

## 3. Autenticación (panel de Supabase)

**Authentication → URL Configuration**

| Campo | Valor |
|---|---|
| Site URL | `http://localhost:5173` |
| Redirect URLs | `http://localhost:5173/**` |

5173 es el puerto por defecto de Vite: `frontend/vite.config.ts` no define
`server.port`. El `3000` que Supabase precarga no corresponde. Sin esto, los
mails de invitación y de reseteo de contraseña apuntan a un puerto donde no
corre nada.

**Authentication → Providers → Email**

| Opción | Valor | Por qué |
|---|---|---|
| Enabled | ON | Registro con email y contraseña |
| **Confirm email** | **ON** | **Requisito de seguridad, no de conveniencia** |

`Confirm email` es un interruptor distinto de `Enabled`, dentro de la misma
sección. **Sigue recomendado, pero desde el 2026-08-28 la seguridad del flujo
de invitaciones ya no depende de él** (hallazgo `ALTO-3`, cerrado).

Antes sí: `verifyInvitationAcceptIdentity.ts` usaba el claim `email` del JWT
como credencial completa y nunca miraba `email_verified`, así que este toggle
era lo único que impedía que alguien aceptara una invitación ajena
registrándose con el email del invitado. Ahora ese middleware resuelve la
identidad con `admin.getUserById(payload.sub)` y **exige `email_confirmed_at`**,
rechazando con 401 si falta. La defensa vive en el código y se puede verificar
leyéndolo, que era el punto del hallazgo.

**Por qué sigue siendo ON y no es opcional.** Con el toggle APAGADO, GoTrue
autoconfirma en el alta, así que `POST /api/onboarding/otp` deja una identidad
**ya confirmada** para cualquier email que alguien tipee — el *squatting* de
`ALTO-2` a nivel `auth.users` vuelve a ser alcanzable. Dos precisiones para no
sobredimensionarlo:

- con el toggle apagado, el `POST /auth/v1/signup` público de Supabase **ya**
  permite exactamente eso, así que el endpoint del CRM no agrega una capacidad
  nueva; lo que hace es no protegerte de una plataforma configurada abierta;
- **lo que sí vale siempre, con el toggle en cualquier estado**, es que
  `POST /api/onboarding` no crea `Organization` ni `User` sin un código válido.
  Esa garantía vive en el código y tiene test propio.

Verificado empíricamente, no supuesto: el stack local del CI tiene
`enable_confirmations = false` y ahí la identidad nace confirmada — fue el CI el
que lo mostró, contra una primera versión del test que afirmaba lo contrario.

### Plantilla de email "Magic Link" — requisito del registro

**Authentication → Email Templates → Magic Link.** La plantilla tiene que
incluir `{{ .Token }}`, no solo `{{ .ConfirmationURL }}`.

`POST /api/onboarding` exige un OTP de 6 dígitos que se envía por esta
plantilla (hallazgo `ALTO-2`). Magic links y OTPs comparten implementación en
Supabase: con la plantilla por defecto el mail llega igual, pero con un enlace
en vez de un código, y **nadie puede completar el registro**. Falla cerrado y
para todos — es un fallo funcional visible, no un agujero silencioso.

**SMTP** — pendiente. Con el servidor por defecto de Supabase el límite es de
~2 emails por hora; con SMTP propio, ~30. Suficiente para desarrollo,
bloqueante para producción (ya figuraba como pendiente en
`docs/project-overview.md`, sección 8).

---

## 4. Aplicar el esquema

```bash
npm run migrate:deploy   # NO `prisma migrate deploy` a secas — ver abajo
npm run prisma:seed      # catálogo Role (ADMIN, USER), idempotente
```

Desde la migración `20260821140000` los 36 objetos de DDL manual
(índices únicos parciales, CHECK, triggers, RLS y políticas) **forman parte
del historial de migraciones**, así que `prisma migrate deploy` por sí solo ya
reconstruye una base completa. `npm run migrate:deploy` sigue siendo el
comando recomendado porque además reaplica los dos `.sql` de referencia de
forma idempotente, como red de seguridad.

### Verificar que la base nació completa

```bash
# 1. Conexión
echo "select 1;" | npx prisma db execute --stdin --schema prisma/schema.prisma

# 2. La app conecta
npm run dev     # y abrir http://localhost:4000/health -> "database":"ok"
```

**3.** Correr `docs/auditoria-2026-08-21-diagnostico.sql` en el SQL Editor.
Es de solo lectura. Resultado esperado de una base recién creada:

| Fila | Chequeo | Esperado |
|---|---|---|
| 1, 2 | Permisos de `anon`/`authenticated` | `ninguno` (PostgREST cerrado) |
| 3 | Roles con `BYPASSRLS` | incluye `postgres` — el rol de la app |
| 4 | Tablas sin RLS | `ninguna` |
| 5 | Políticas RLS | `10` |
| 7, 8, 9 | Índices parciales / CHECK / triggers faltantes | `ninguno` en las tres |
| 10 | `current_organization_id()` | `presente` |
| 13 | Usuarios sin fila en `auth.users` | `0` |

Las filas 11 y 12 (`(organization_id, created_at)` y `pg_trgm`) van a decir
que faltan: son los hallazgos A-6 y A-7, todavía abiertos.

**4.** Confirmar las 15 FKs compuestas por organización:

```sql
select con.conrelid::regclass::text as tabla, con.conname,
       pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
where con.contype = 'f' and a.attname = 'organization_id'
  and array_length(con.conkey, 1) = 2
order by 1, 2;
```

Deben salir **15 filas**. Las 9 con columna nullable aparecen **sin cláusula
`ON DELETE`**: es `NO ACTION`, el default, y Postgres lo omite al mostrar la
definición. Correcto, no un error.

---

## 5. Lo que NO está automatizado

Todo lo de las secciones 1 y 3 se configura a mano en el panel. Si algún día
se quiere reproducible, el camino es la CLI de Supabase y `config.toml`, pero
hoy no está adoptada en este proyecto.

Después de recrear un proyecto hay que actualizar, además de los dos `.env`:
la variable `CORS_ORIGIN` si el frontend cambia de puerto, y cualquier
credencial guardada fuera del repo (CI, deploy) — que hoy no existen.
