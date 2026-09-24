# CLAUDE.md

## Project Identity

- **Project:** Plataforma CRM
- **Description:** CRM SaaS multi-tenant — backend en Node.js + Express +
  TypeScript, Prisma ORM sobre PostgreSQL (Supabase), autenticación
  delegada a Supabase Auth.

---

## Project Context

> Edit this section per project. This is the only section meant to
> change regularly.

- **Stack:** Node.js + Express + TypeScript, Prisma ORM, PostgreSQL
  (Supabase), autenticación Supabase Auth (JWT verificado vía
  JWKS/ES256)
- **Status / Phase:** Infraestructura base y autenticación completas.
  Módulos de negocio (`Company`, `Contact`, `Pipeline`, `Stage`,
  `Opportunity`, `Activity`, `Invitation`) completos — CRUD, soft
  delete, paginación. Administración acotada de `User`. Sin endpoint
  de login propio (decisión de diseño estable, no pendiente).
  Capa de ingesta completa (`Source`, `ApiKey`, `IngestionEvent`):
  ítems 1 a 5 del orden de construcción de
  `docs/ingestion-architecture.md` §6 — CI con Postgres y tests de
  aislamiento, modelos y migraciones, gestión de API keys, webhook de
  landing page, e importación de Excel/CSV. El ítem 6 (bases de datos
  externas) está pospuesto por decisión explícita de §7 de ese
  documento, no es un pendiente sin decidir.
- **Key context:** Multi-tenant real — aislamiento por organización
  verificado end-to-end contra un proyecto real de Supabase. Diseño
  completo del producto y modelo de datos en
  `docs/project-overview.md`; diseño de autenticación/onboarding en
  `docs/authentication-architecture.md`; diseño de la capa de ingesta
  en `docs/ingestion-architecture.md`.

---

## Comandos del repo

Dos paquetes npm independientes (sin workspaces): el backend en la raíz y
`frontend/`. Node 22 (el mismo que `Dockerfile` y `ci.yml`).

**Instalar** (lo hace solo el hook `SessionStart` de
`.claude/settings.json` en las sesiones en la nube, ver más abajo):

```bash
npm ci && npx prisma generate      # backend — el cliente de Prisma no está versionado
npm ci --prefix frontend           # frontend
```

`npm ci` y no `npm install`: con otra versión de npm, `npm install`
reescribe `package-lock.json`.

**Backend** (raíz) — lo mismo que corre `ci.yml`:

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | `tsc` sobre src, scripts y tests (tres tsconfig). |
| `npm run build` | Compila a `dist/`. |
| `npm test` | Unitarios `src/**/*.test.ts` (node:test vía `tsx --test`), sin DB. Requiere `CORS_ORIGIN` en el entorno (cualquier valor; el hook la exporta). |
| `npx tsx --test src/ruta/archivo.test.ts` | Un solo archivo de tests. |
| `npm run lint` / `npm run lint:fix` | ESLint del backend. |
| `npm run format:check` / `npm run format` | Prettier de TODO el repo (un solo `.prettierrc`; los `*.md` están excluidos a propósito). |
| `npm run prisma:validate` | Valida `schema.prisma` sin conectarse a nada. |
| `npm run test:integration` | Suite `*.integration-test.ts`. Necesita el stack local de Supabase (`npm run supabase:start`, Docker) — en CI es el job `integration`. |

**Frontend** (`cd frontend`): `npm run typecheck`, `npm run lint`,
`npm test` (vitest), `npm run build`. Prettier se corre desde la raíz.

**Migraciones:**

- Nueva migración: editar `prisma/schema.prisma` y generar la carpeta en
  `prisma/migrations/` con `npx prisma migrate dev --name <nombre>` contra
  el Supabase LOCAL (`npm run supabase:start`), nunca contra un proyecto
  real.
- Aplicar: `npm run migrate:deploy` = `prisma migrate deploy` + reaplicar
  `prisma/sql/manual_constraints.sql` y `prisma/sql/rls_policies.sql`
  (idempotente). Usa `DIRECT_URL`.
- Verificar: `npm run verify:schema`; sembrar roles: `npm run prisma:seed`.
- Recordatorio: los PR con `prisma/migrations/` no se mergean por
  iniciativa propia (ver la sección de `gh` más abajo).

**Sesiones en la nube:** no hay `.env` ni credenciales, y no hay que
agregarlas: todo lo que no sea typecheck/lint/format/unitarios/build
(`dev`, `migrate:deploy`, `test:integration`, `seed:dev-data`, scripts
`purge:*`) necesita una base, y desde la nube no se conecta a ninguna
base real. El hook `.claude/hooks/session-start.sh` corre solo con
`CLAUDE_CODE_REMOTE=true`: instala los dos paquetes, genera el cliente
de Prisma y exporta `CORS_ORIGIN` para `npm test`.

---

## Toolkit Discovery

The responsibility of this section is to make the Toolkit locatable —
not to describe it.

The Toolkit is discovered at:

U:\Proyectos\Claude-Toolkit-V1.1

Today this is expressed as an absolute path. The discovery mechanism
may change in the future without changing what this section is for.

---

## Activation

When the user writes:

Activate Claude-Toolkit

this signals the Toolkit, at the location declared above, to begin
its own bootstrap. What happens next is defined entirely by the
Toolkit's own CLAUDE.md — nothing about it is described here.

---

## Boundaries

This file must never contain: Toolkit rules, Constitutional
Principles, internal Toolkit documentation, or Router logic. Any of
that belongs to the Toolkit's own CLAUDE.md, never to this one.

---

## GitHub CLI (`gh`)

`gh` está instalado y autenticado en esta máquina, y ve el repositorio
`roccocarlotto-source/PlataformaCRM`. Es la herramienta estándar para
todo lo que toque PRs y CI:

- **Crear PRs:** `gh pr create`, siempre con `--body-file` apuntando al
  `pr-body-*.md` de costumbre. Nunca `--body` con el texto inline.
- **Estado de CI:** `gh pr checks` o `gh run watch` en vez de pedirle a
  Rocco una captura de pantalla, siempre que `gh` alcance para
  confirmarlo.

**`gh pr merge` se corre solo con el CI REMOTO en verde** (decisión de
Rocco, 23/09/2026, que reemplaza la regla anterior de no mergear nunca por
iniciativa propia).

Qué cuenta como "verde" y qué no:

- **Verde = `gh pr checks` con todos los checks en `pass`**, sobre el PR
  abierto, después de que el CI corrió en GitHub. Los tests corridos en
  local NO alcanzan: el CI es el único control que no escribió quien hizo
  el cambio. Un PR sin checks todavía no es un PR verde — se espera
  (`gh pr checks --watch`).
- **Un solo check en rojo o pendiente = no se mergea**, sin importar qué
  tan seguro parezca el cambio.

Lo que NO se mergea por iniciativa propia aunque el CI esté verde, porque
el CI no puede juzgarlo:

- Migraciones de base, o cualquier cambio con `prisma/migrations/`.
- Cambios que alteran precios, cobros, o lo que se le muestra al cliente
  final como condición comercial.
- Borrado de datos o de columnas.
- Cambios de configuración de producción (variables de entorno, modelo del
  agente): esos ni siquiera se hacen, se recomiendan.
- Cualquier cambio donde el propio reporte diga que hay una decisión de
  producto abierta.

En esos casos el PR queda abierto y el reporte dice explícitamente por qué
no se mergeó.

**Al mergear se reporta**: qué PR, qué ítems cierra, y el resultado real de
`gh pr checks` que habilitó el merge. Después del merge se borra la rama.
