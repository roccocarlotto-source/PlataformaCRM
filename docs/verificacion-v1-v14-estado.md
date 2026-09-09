# Estado del sweep V-1..V-14 (auditoría 2026-08-29)

Tablero complementario, no toca el loop de investigación → prompt → Claude
Code implementa → verificación → merge que ya corre en la otra sesión. Cruza
`docs/auditoria-2026-08-29.md` §6 contra el historial real de PRs
(`gh pr list --state all --limit 200 --json number,title,headRefName,state,mergedAt,url`).

**Snapshot al 2026-09-02, ~23:35 UTC**, con un solo dato refrescado a mano el
2026-09-04 vía `gh pr view 133 --json state,mergeable,statusCheckRollup`: V-1
ya está `MERGED` (CI en verde en las 4 checks, completada 2026-09-03 ~00:00
UTC), no `OPEN` como decía la foto original. El resto de la tabla sigue
siendo la foto del 2026-09-02 — para refrescarla del todo hay que volver a
correr el export completo (`gh pr list --state all --limit 200 --json
number,title,headRefName,state,mergedAt,url`) y pasármelo.

## Etapa anterior (BAJO + MEDIO)

Confirmado contra los PRs, no solo contra lo dicho: **35 hallazgos `(B-N)` y
15 `(M-N)`** tienen su PR con ese tag en el título, y **los 50 están
`MERGED`** — cero abiertos, cero cerrados sin mergear (fuera de las ramas
`scratch/*-mutation`, que se cierran sin merge por diseño: son verificación
de que el fix real hace fallar la mutación, no un cambio a integrar).

## V-1..V-14

| # | Qué (resumen de §6) | Estado | PR | Merged |
|---|---|---|---|---|
| V-1 | Callback OAuth responde 400 ante `state` inválido, webhook responde 403 ante token inválido — inconsistencia entre endpoints hermanos | ✅ Cerrado | [#133](https://github.com/roccocarlotto-source/PlataformaCRM/pull/133) — terminó siendo fix de documentación, no de código (verificado leyendo oauthState.ts/webhookToken.ts post-merge: cero cambio de comportamiento, solo comentarios explicando la decisión por tipo de llamador) | 2026-09-03 ~00:00 UTC |
| V-2 | `createBooking` acepta `startsAt` en el pasado y fuera de la grilla | ✅ Cerrado | [#131](https://github.com/roccocarlotto-source/PlataformaCRM/pull/131) (+ verificación por mutación [#132](https://github.com/roccocarlotto-source/PlataformaCRM/pull/132), no mergeada por diseño) | 2026-09-02 23:30 |
| V-3 | `ALTER DEFAULT PRIVILEGES` sin `FOR ROLE` — afecta al rol que corrió la migración | ✅ Cerrado | [#129](https://github.com/roccocarlotto-source/PlataformaCRM/pull/129) | 2026-09-02 14:09 |
| V-4 | `google_event_id` no es único — `findFirst`/`markBookingCancelled` podrían tomar la fila equivocada | ✅ Cerrado | [#128](https://github.com/roccocarlotto-source/PlataformaCRM/pull/128) | 2026-09-02 13:45 |
| V-5 | Rate limits por IP de Supabase Auth (`/otp`, `/verify`) ven la IP del backend, no la del cliente final | 🟡 Parcial — ver nota abajo | [#151](https://github.com/roccocarlotto-source/PlataformaCRM/pull/151) — fix acotado, no la raíz | — (OPEN, CI verde, mergeable — decisión de Rocco) |
| V-6 | `$transaction` con timeout default (5s) bajo locks — una operación lenta puede tumbar la siguiente con P2028 | ✅ Cerrado — sin tocar ningún lock, ver nota abajo | M-11 (c), `prismaErrors.ts` (el propio archivo dice explícitamente "ESTA TRADUCCIÓN TAMBIÉN CIERRA V-6") | ya mergeado, previo a este sweep |
| V-7 | `jwtVerify` sin `audience: "authenticated"` | ✅ Cerrado | [#124](https://github.com/roccocarlotto-source/PlataformaCRM/pull/124) | 2026-09-02 12:51 |
| V-8 | Limiter de aceptación identificada corre después de la Admin API, no antes | ✅ Cerrado | [#130](https://github.com/roccocarlotto-source/PlataformaCRM/pull/130) | 2026-09-02 23:02 |
| V-9 | Worker de ingesta promueve eventos de fuentes pausadas/retiradas | ✅ Cerrado | [#125](https://github.com/roccocarlotto-source/PlataformaCRM/pull/125) (+ verificación por mutación [#126](https://github.com/roccocarlotto-source/PlataformaCRM/pull/126)/[#127](https://github.com/roccocarlotto-source/PlataformaCRM/pull/127), no mergeadas por diseño) | 2026-09-02 13:15 |
| V-10 | Handler de outbox ausente → DEAD_LETTER inmediato sin distinguir causa, riesgo en deploy escalonado | ⏸️ Diferido en bloque (V-10..V-13) — ver nota abajo | — | — |
| V-11 | Handlers de outbox no reciben `tx` — una escritura del handler queda fuera de la transacción del evento | ⏸️ Diferido en bloque (V-10..V-13) | — | — |
| V-12 | Con `X-External-Id` fijo, un payload corregido se descarta en silencio (`DO NOTHING`) | ⏸️ Diferido en bloque (V-10..V-13) | — | — |
| V-13 | `nextAttemptAt` calculado con el reloj de Node, comparado contra `now()` de Postgres | ⏸️ Diferido en bloque (V-10..V-13) | — | — |
| V-14 | La fila 16 del diagnóstico (18 FKs conocidas) no incluye las 10 FKs de Booking | ✅ Cerrado — ver nota abajo | — (ya resuelto por una revisión anterior de `verify-schema.ts`, no por este sweep) | previo a este sweep |

**Resumen:** 9 de 14 cerrados (V-1, V-2, V-3, V-4, V-6, V-7, V-8, V-9, V-14), 1
parcial (V-5), 4 diferidos en bloque (V-10, V-11, V-12, V-13), 0 sin empezar,
0 en curso.

**El sweep de V-1..V-14 queda así agotado**: de los 14, 9 cerrados, 1 parcial
con causa de raíz diferida por decisión (V-5), 4 diferidos en bloque hasta
que exista el primer consumidor de outbox (V-10..V-13). No queda ningún ítem
"sin empezar".

**Nota sobre V-6 (cerrado, 2026-09-04):** no hizo falta ningún prompt ni PR
nuevo. Investigando el hallazgo (services con locks, `$queryRaw ... FOR
UPDATE`) apareció `src/utils/prismaErrors.ts`, que centraliza la traducción de
P2028/P2034/P2003 en `errorHandler` — trabajo de M-11 (c), ya mergeado antes de
empezar este sweep de V-1..V-14. El propio archivo lo dice de manera
explícita: el timeout default de 5s en `$transaction` sigue igual a propósito
(ajustarlo por sitio sigue siendo posible "si el volumen algún día lo pide;
hoy no hay motivo"), pero P2028 ya no llega como 500 crudo — sale como 409
"Hubo un conflicto temporal al procesar la operación. Reintentá.", con
`isOperational: true`, verificado contra Prisma 5.22.0 y cubierto por
`errorHandler.test.ts` ("(c) un P2028 de Prisma responde 409..."). Es
exactamente el daño que V-6 señalaba (P2028 → 500 sin mensaje), ya resuelto
por otro motivo. Verificado leyendo `prismaErrors.ts`, `errorHandler.ts` y
`errorHandler.test.ts` reales, no solo el comentario.

**Nota sobre V-5 (parcial, 2026-09-04):** se separó el hallazgo en dos partes,
a propósito, en vez de tratarlo como una sola decisión.

Resuelto ahora, sin dependencias externas: `onboardOrganization` aplastaba
TODO error de `verifyOtp` en un 401 genérico, incluido el 429 real de
`over_request_rate_limit` (el límite por IP de `/verify`, confirmado contra la
documentación oficial de error codes de Supabase Auth). El PR #151 agrega la
rama que distingue ese caso y responde 429 con mensaje de backoff — espejo
exacto de B-22, que ya había hecho lo mismo del lado de `signInWithOtp`
(`over_email_send_rate_limit`). Verificado leyendo `onboarding.service.ts`
(líneas 166-184) y su test de integración post-PR, no solo contra el reporte.

Deliberadamente diferido, no por descuido: la causa de raíz (que Supabase vea
la IP real del cliente y no la del backend) requiere tres cosas que no son
código —

1. Activar "IP Address Forwarding" en el dashboard de Supabase
   (Authentication → Rate Limits) — acción de Rocco.
2. Generar una API key nueva tipo `secret` (el header `Sb-Forwarded-For` no
   funciona con las keys legacy `anon`/`service_role` que usa hoy el proyecto,
   confirmado contra la documentación oficial) — acción de Rocco, es aditiva,
   no reemplaza las keys existentes.
3. Definir `trust proxy` de Express para la topología real de despliegue —
   decisión de deploy todavía no tomada, ya señalada como pendiente en el
   propio `rateLimit.ts`.

Recién con esas tres resueltas tiene sentido escribir el código que arma el
header por request (probablemente bypaseando el cliente singleton de
`supabaseAnon.ts`, ver la discusión completa más arriba en este hilo). Hasta
entonces, V-5 queda en parcial, no en cerrado.

**Nota sobre V-10..V-13 (diferidos en bloque, 2026-09-04):** los cuatro son
del motor de outbox (`src/services/outbox.service.ts`,
`src/services/outboxHandlers.ts`, `src/repositories/outboxEvent.repository.ts`)
y comparten la misma causa para diferirlos, no cuatro decisiones
independientes.

Verificado, no asumido: `emitOutboxEvent` — la única función que escribe un
evento saliente — no se llama desde ningún lado del código de producción; el
único uso fuera de su propia definición es un test de aislamiento de
tenants (`tenant-isolation.integration-test.ts`). Y `outboxHandlers.ts` lo dice
explícito en su propio comentario: "Hoy NO EXISTE NINGUNA [handler] — el motor
se construye antes que sus tres consumidores (aviso a Resea, recordatorio de
WhatsApp, 'Oportunidad → Ganada')".

Es decir: hoy nadie emite eventos y nadie los procesa. El motor es andamiaje
construido por adelantado, sin un solo caller real. Los cuatro caminos que
V-10/V-11/V-12/V-13 señalan (DEAD_LETTER sin handler, handlers sin `tx`,
descarte silencioso por `X-External-Id`, reloj de Node vs `now()` de Postgres)
son código que hoy nunca se ejecuta en producción — no hay ningún evento real
que los alcance. El propio audit ya los anota así: V-10 dice "Nota para cuando
haya consumidores" y V-11 "Decisión a fijar antes del primer consumidor".

Decisión: no escribir código contra consumidores hipotéticos — arriesgaría
adivinar mal qué necesita el primer handler real. Los cuatro quedan diferidos
como bloque hasta que se construya el primer consumidor de outbox; en ese
momento hay que releer los cuatro antes de escribir ese handler, no después.

**Nota sobre V-14 (cerrado, 2026-09-04):** mismo patrón que V-6 — no hizo
falta ningún prompt ni PR, el hallazgo ya estaba resuelto por trabajo anterior
que el tracker no tenía cruzado.

M-6 decía que `verify-schema.ts` afirmaba "5 de 11 CHECK" y "18 de 28 FKs
compuestas", con el módulo de Booking afuera de la fila 16. Verificado contra
el archivo real (`scripts/verify-schema.ts`, línea 135 y línea 201): hoy dice
"Los 14 CHECK constraints" y "las 29 FKs conocidas". La fila 16 (línea 737 de
`docs/auditoria-2026-08-21-diagnostico.sql`) incluye las cinco FKs de
`bookings` (branch_id, contact_id, opportunity_id, resource_id,
service_type_id) más las de `resources`, `service_types` y `working_hours` —
todo el módulo de Booking está adentro.

Además, la pregunta que V-14 dejaba abierta ("¿conviene generalizarla o
extenderla?") ya tiene respuesta escrita en el propio archivo: se generalizó.
Desde una revisión del 2026-08-25 (P0 del roadmap), la fila 14 dejó de ser una
lista enumerada — pasó a un chequeo estructural que no necesita editarse cada
vez que aparece una tabla nueva con `organization_id`. La fila 16 sigue siendo
una lista explícita (es la única que puede decir A QUÉ tabla padre apunta cada
FK), pero deliberadamente no exhaustiva: una FK nueva que falte de la lista no
hace fallar el chequeo, así que agregar una tabla no obliga a tocar este
archivo — solo una FK YA LISTADA que cambie de padre o desaparezca lo hace
fallar. Verificado leyendo el archivo real, no solo el título de la fila.
