# ALTO-11 (docs/auditoria-2026-08-21.md, sección 4) — la mitad del hallazgo que
# faltaba. ESLint, Prettier y su gate bloqueante en CI ya estaban; lo que no
# había era ninguna forma reproducible de desplegar este backend: ni Dockerfile,
# ni docker-compose, ni Procfile, ni fly.toml, ni render.yaml. El CI corría
# `build` y descartaba el artefacto.
#
# La consecuencia concreta que anota el hallazgo: los comentarios de
# rateLimit.ts asumen "proceso Node único, sin proxy", una suposición que no se
# podía validar porque no había topología de deploy contra la cual validarla.
# Este archivo la vuelve verificable — un contenedor es un proceso.
#
# ---------------------------------------------------------------------------
# NODE 22 — leído de .github/workflows/ci.yml, no elegido
# ---------------------------------------------------------------------------
#
# Los cuatro jobs del CI declaran `node-version: 22`. La imagen tiene que correr
# lo mismo que valida el pipeline: un runtime distinto del que se testea
# convierte el CI verde en una afirmación sobre otra cosa.
#
# bookworm-slim y no alpine, y la diferencia no es de gusto: Prisma resuelve su
# motor de query por binaryTarget, y Alpine (musl) exige
# linux-musl-openssl-3.0.x, un target que schema.prisma no declara. Debian slim
# usa debian-openssl-3.0.x, que es el default. Se instala `openssl` explícito
# porque las imágenes slim no lo traen y el motor de Prisma lo necesita.

# =============================================================================
# Etapa 1 — build: compila con TODAS las dependencias, incluidas las de dev
# =============================================================================
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# package.json + lockfile primero, en su propia capa: mientras las dependencias
# no cambien, esta capa se reusa y `npm ci` no vuelve a correr aunque cambie
# todo el código.
COPY package.json package-lock.json ./
RUN npm ci

# El cliente de Prisma se genera ACÁ, con el CLI de Prisma disponible (es una
# devDependency). En la etapa de runtime no está, así que el resultado se copia
# en vez de regenerarse — ver la nota de la etapa 2.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# =============================================================================
# Etapa 2 — runtime: solo `dependencies`, sin el CLI de Prisma ni el compilador
# =============================================================================
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# --omit=dev: typescript, tsx, prisma (el CLI), eslint y prettier no tienen nada
# que hacer en una imagen de producción.
RUN npm ci --omit=dev && npm cache clean --force

# EL CLIENTE GENERADO SE COPIA, NO SE REGENERA. `@prisma/client` es una
# dependency y `npm ci --omit=dev` lo instala, pero generar requiere el CLI
# `prisma`, que es devDependency y acá no está. Sin este COPY el contenedor
# arranca y falla en la primera query con "@prisma/client did not initialize
# yet" — un error de runtime, no de build, que es la peor forma de enterarse.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# schema.prisma acompaña al cliente: Prisma lo resuelve para armar los mensajes
# de error, y tenerlo evita diagnósticos degradados. Las MIGRACIONES no corren
# desde este contenedor —`npm run migrate:deploy` necesita tsx y el CLI de
# Prisma, los dos ausentes a propósito— y eso es deliberado: aplicar migraciones
# es un paso de despliegue con su propio momento, no algo que cada réplica que
# arranca deba intentar a la vez.
COPY --from=build /app/prisma/schema.prisma ./prisma/schema.prisma

COPY --from=build /app/dist ./dist

# Usuario sin privilegios. Las imágenes oficiales de Node ya traen el usuario
# `node` (uid 1000); no hace falta crearlo.
USER node

# El default de PORT en src/config/env.ts. EXPOSE es documentación del contrato,
# no una publicación de puerto: si se cambia la variable PORT, hay que mapear el
# puerto real al correrlo.
EXPOSE 4000

# /health va SIN prefijo /api (convención de health checks, ver
# src/routes/index.ts). Se consulta con el propio node en vez de curl o wget:
# ninguno de los dos viene en la imagen slim, e instalarlos solo para esto
# agregaría superficie a una imagen de producción.
#
# Se afirma únicamente que el proceso RESPONDE, sin exigir un status concreto:
# getHealth consulta la base y devuelve 503 cuando no la alcanza — un
# comportamiento correcto que no debe marcar al contenedor como muerto, porque
# el problema está afuera. Mismo criterio que ya documenta
# src/routes/index.test.ts sobre por qué ese test no afirma el status.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(()=>process.exit(0)).catch(()=>process.exit(1))"]

# Forma exec, no shell: así el proceso de node es el PID 1 y recibe SIGTERM
# directo. src/server.ts lo maneja —detiene el worker de ingesta, cierra el
# servidor y desconecta Prisma— y con la forma shell ese manejador nunca se
# ejecutaría, porque el PID 1 sería /bin/sh.
CMD ["node", "dist/server.js"]
