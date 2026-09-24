#!/bin/bash
# Hook SessionStart: prepara el contenedor de las sesiones de Claude Code en la
# nube para que typecheck, lint y tests unitarios corran sin pasos manuales.
#
# Solo actúa cuando CLAUDE_CODE_REMOTE=true: en la máquina local de desarrollo
# las dependencias ya están y reinstalarlas en cada sesión sería puro costo.
#
# No toca ninguna base de datos: `prisma generate` solo lee schema.prisma.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `npm ci` y no `npm install`: con una versión de npm distinta a la que
# generó el lockfile, `npm install` lo reescribe (verificado: saca los campos
# `libc` de package-lock.json) y cada sesión arrancaría con el árbol sucio.
# `npm ci` respeta el lockfile tal cual, igual que .github/workflows/ci.yml.
npm ci --no-audit --no-fund
npm ci --no-audit --no-fund --prefix frontend

# El cliente de Prisma no está versionado; sin esto falla el typecheck.
npx prisma generate

# src/config/env.ts exige CORS_ORIGIN al importar cualquier service, así que
# sin ella `npm test` falla al importar. Mismo valor que usa ci.yml.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -z "${CORS_ORIGIN:-}" ]; then
  echo 'export CORS_ORIGIN=http://localhost:5173' >> "$CLAUDE_ENV_FILE"
fi
