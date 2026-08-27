# Reviews del Toolkit — Capa de ingesta (ítems 1 a 5)

**Fecha:** 2026-08-27
**Manifest ID:** `RM-2026-08-27-INGESTA-1-5`
**Alcance revisado:** estado de `master` en `677d5f8` — deliverable completo de
los ítems 1 a 5 del orden de construcción de `docs/ingestion-architecture.md` §6,
revisado desde cero, sin heredar resultados de ninguna ronda anterior.
**Reviews conducidos:** `RV-ENG`, `RV-SECURITY`, `RV-STANDARDS`.

> Este archivo es el registro completo de los tres reviews. Se escribe en el
> repo porque la convención propia del Toolkit
> (`reviews/archive/{engagement}/cycle-{N}/`) vive dentro de la instalación del
> Toolkit, que es otro repositorio, y porque `state/` no existe en este
> proyecto — M1 a M7 tampoco se archivaron.

**Commits del deliverable revisado:**

| Commit | Qué trajo |
|---|---|
| `1951b6a` | Modelos, migraciones y aislamiento (`Source`, `ApiKey`, `IngestionEvent`) |
| `c4cf2a4` | Gestión de API keys (`/api/sources`, `/api/api-keys`) |
| `c818bb1`, `26ff12a` | Webhook de landing page (`POST /api/ingest`) |
| `c76b47c`, `a02f142` | Importación de Excel/CSV (`/api/imports`) |

---

## 1. Activación del Toolkit

```
Claude-Toolkit-V1.1 — Active

Runtime      initialized
Systems      8 operational systems
Providers    2 knowledge provider(s) active
Project      no prior context

! el contenido del proveedor gstack está vencido — last-verified 2026-07-07, SLA mensual
! el contenido del proveedor ui-ux-pro-max está vencido — last-verified 2026-07-16, SLA mensual
```

Los 7 componentes requeridos y los 4 esperados verificados; las 8
especificaciones de Operational System presentes. `state/` no existe en el
proyecto — sin estado de engagement previo, coherente con que M1 a M7 se
reportaron en conversación y `reviews/archive/` está vacío.

Los dos warnings son de frescura de proveedores externos (Rank 6) y no
bloquean. Ninguno de los dos se usó como fuente de autoridad en estos reviews:
la autoridad aplicada fue Rank 1 a 4 (ROM, estándares del Toolkit,
`docs/ingestion-architecture.md`, el código real).

---

## 2. Project Brief y Routing Manifest (condensados)

| Campo | Valor |
|---|---|
| Engagement | New (sin estado previo) |
| Orientation Confidence | Complete |
| Manifest ID | `RM-2026-08-27-INGESTA-1-5` |
| Dominio | Software Engineering |
| Problem Type | Evaluation |
| Complejidad | Complex |
| Owner System | `OS-SW-ENG` |
| Specialist Perspectives | Security, Performance, **Data Privacy** |
| Estándares vinculados | STD-SW-001 SOLID (Mandatory por complejidad Complex) · STD-SW-002 OWASP (Mandatory) · STD-SW-003 Testing (Mandatory) · STD-SW-004 Code Review (Mandatory) · **STD-LEG-002 Data Privacy (Mandatory)** · STD-LEG-001 GDPR (Conditional — condición no verificable, ver Q-1) · STD-GEN-001/002 (Advisory) |
| Secuencia de reviews | RV-ENG → RV-SECURITY → RV-STANDARDS |

**Decisión de routing que conviene revisar:** se activó **Data Privacy** como
perspectiva. Toda la capa de ingesta existe para recibir datos personales de
leads (nombre, email, teléfono, puesto) y para guardar una **segunda copia
cruda** de esos datos en `IngestionEvent.rawPayload`. Eso hace Mandatory a
STD-LEG-002, de donde salen los hallazgos más sustantivos de RV-STANDARDS. Si
M1 a M7 no la activaron, es la primera vez que se aplica en el proyecto.

---

## 3. RV-ENG — Engineering Review

```
Report ID:  RR-ENG-2026-08-27-01     Manifest: RM-2026-08-27-INGESTA-1-5
Outcome:    CONDITIONAL PASS
```

### 3.1 Criterios de aceptación

| Criterio | Evaluación | Evidencia |
|---|---|---|
| Código internamente consistente, produce lo declarado | **MET** | `typecheck` limpio (3 proyectos tsc); 115 tests unitarios en verde; la suite de integración cubre los cuatro contratos de punta a punta |
| Sin vulnerabilidades Critical/High introducidas | **MET** | Ver RV-SECURITY: ninguna Critical, ninguna High sin contexto |
| Cobertura de tests en caminos críticos | **MET** | 3.249 líneas en 9 archivos; caminos de rechazo, idempotencia, aislamiento, cascada, rate limit y redacción de log, todos con test |
| Estándares de ingeniería satisfechos | **MET** | Ver RV-STANDARDS (STD-SW-001/003/004) |
| Riesgos de performance documentados | **MET** | Cada índice justificado en el schema; granularidad de `lastUsedAt`, `FOR UPDATE SKIP LOCKED`, troceado a 500 filas por el techo de 65535 parámetros de Postgres |
| Sin complejidad innecesaria | **MET** | SQL crudo solo donde el DSL de Prisma no expresa el índice parcial, con la razón escrita en cada caso |

### 3.2 Hallazgos

#### E-1 · Medium · corrección

`src/services/promotion.service.ts` descarta el `count` que devuelven
`markEventProcessed` y `markEventFailed`. Los dos son `updateMany` con
`status: PENDING` en el `WHERE` — un compare-and-swap deliberado, documentado
en `src/repositories/ingestionEvent.repository.ts:227` como *"la clase de
redundancia que sobrevive a que alguien cambie el mecanismo de reclamo"*. Al
descartarse el `count`, esa redundancia no puede proteger nada: si el CAS no
matchea, la transacción **igual commitea** con el `Contact` ya escrito y el
evento sigue en `PENDING`.

**Escenario de falla.** En el camino sin email, `promoteContact` hace un
`INSERT` liso (sin `ON CONFLICT`, porque el índice es parcial). Un evento que
quedara en `PENDING` tras crear su contacto produciría **un contacto nuevo en
cada pasada del worker, indefinidamente**.

**Por qué no es Critical.** Hoy es inalcanzable: `claimNextPendingEvent` toma
`FOR UPDATE` sobre la fila dentro de la misma transacción y filtra
`status = 'PENDING'`, así que nadie puede cambiarla entremedio — que es
exactamente la condición cuya pérdida el CAS decía cubrir. El defecto es que la
red de seguridad escrita está inerte.

**Acción requerida.** Verificar `count === 0` y lanzar (la transacción se
revierte, el evento vuelve a `PENDING` sin contacto huérfano) o registrarlo
explícitamente.

#### E-2 · Low · exactitud de contrato

`src/services/ingest.service.ts` devuelve la constante `IngestionStatus.PENDING`
también cuando `duplicate: true`. Si el evento preexistente ya fue promovido
(`PROCESSED`) o falló (`FAILED`), la respuesta 202 informa un estado que no es
el de la fila. `insertPendingIngestionEvent` no trae `status` en su `SELECT` de
fallback, así que el dato ni siquiera está disponible.

Impacto acotado: no hay endpoint que exponga un `IngestionEvent` individual, así
que el emisor no puede contrastarlo.

**Acción sugerida.** Traer `status` en el `SELECT` y devolver el real, o
documentar en el tipo que el campo describe la intención del request y no el
estado de la fila.

#### E-3 · Low · comentario inexacto

`filasParaStaging` (`src/utils/spreadsheet.ts`) indexa el array **ya filtrado**
por `estaVacia`, pero su comentario afirma que el número es *"el que ve quien
mira el archivo en Excel menos la fila de encabezados"*. Con una fila en blanco
intercalada esa equivalencia se rompe. No afecta la idempotencia (el mismo
archivo produce el mismo filtrado y por tanto los mismos `externalId`) ni
ninguna garantía de §4.

**Acción sugerida.** Corregir el comentario, o numerar por posición real en el
archivo.

### 3.3 Lo que está bien hecho

STD-SW-004 exige señalarlo explícitamente: *"una review que solo lista problemas
es desalentadora e incompleta"*.

- El bug que la auditoría en conversación encontró — `importRouter` nunca
  montado — hoy tiene **test de regresión sobre la app real**
  (`src/routes/index.test.ts`), con control negativo incluido. Es la respuesta
  correcta: el test verifica el montaje, no el router aislado que ya pasaba.
- La separación `IngestContext` / `AuthContext` como **tipos disjuntos**
  convierte en error de compilación lo que en otros proyectos es una convención
  que alguien olvida.
- El orden de middlewares de `/api/ingest` y el montaje antes del
  `express.json()` global están razonados desde el mecanismo real de
  `body-parser` (`req._body`), no desde la intuición — y con test que lo fija.
- El encabezado de `src/utils/apiKey.ts` argumenta por qué SHA-256 sin sal es
  correcto acá y **dónde vive realmente la seguridad** (la entropía del CSPRNG).
  Es la clase de decisión que normalmente se toma mal por analogía con
  contraseñas.

### 3.4 Gate

Liberado condicionalmente. Condición: E-1 resuelto o waived explícitamente.
E-2 y E-3 son sugerencias sin obligación de acción.

---

## 4. RV-SECURITY — Security Review

```
Report ID:  RR-SEC-2026-08-27-01     Manifest: RM-2026-08-27-INGESTA-1-5
Outcome:    CONDITIONAL PASS
```

Ejecutado directamente contra el procedimiento nativo del Toolkit. **No** se
delegó en la skill `security-review` de Claude Code ni en `/cso` de gstack.

### 4.1 Modelo de amenaza (STRIDE)

| Cruce de frontera | Amenaza principal | Mitigación | Riesgo residual |
|---|---|---|---|
| Internet → `POST /api/ingest` | **S** — presentar clave ajena | SHA-256 sobre 256 bits de CSPRNG; un solo mensaje y un solo status para todos los rechazos (no hay oráculo de enumeración) | Ninguno significativo |
| Internet → `POST /api/ingest` | **E** — escribir en otra organización | `IngestContext` derivado de la clave + **FK compuesta** `(organization_id, source_id)` → el rechazo lo hace la base, no código nuestro | Ninguno; con test que verifica el rechazo de la base |
| Internet → `POST /api/ingest` | **D** — flood | Límite por `apiKeyId`; cuerpo tope 64 KB | **S-4** |
| Internet → `POST /api/ingest` | **I** — clave en logs | `redact` de pino sobre `x-api-key`; clave prohibida en URL/query/params, con control negativo en la suite | Ninguno |
| ADMIN → `POST /api/imports` | **D** — agotar memoria | Tope de 10 MB y 10.000 filas | **S-5** |
| Worker → `contacts` | **T** — sobrescribir datos cargados a mano | `COALESCE` (gana el CRM) + `promotionNotes` | Ninguno |
| Cualquiera → respuestas de error | **I** — filtrar internals | `errorHandler` manda a 500 genérico todo lo que no sea `AppError`; stack solo en desarrollo | Ninguno |

### 4.2 OWASP Top 10 (STD-SW-002)

| | Categoría | Estado |
|---|---|---|
| A01 | Broken Access Control | **Addressed** — ADMIN-only en toda la administración; ingesta sin rol por construcción; `organizationId` en el `WHERE` de toda lectura y escritura; FK compuesta como garantía en los datos |
| A02 | Cryptographic Failures | **Addressed** — `randomBytes(32)`; el hash nunca sale por la API (`API_KEY_PUBLIC_SELECT`); clave en claro una sola vez y nunca persistida |
| A03 | Injection | **Addressed** — todo el SQL crudo usa `$queryRaw` con template etiquetado y `Prisma.sql`/`Prisma.join`; ningún fragmento se concatena |
| A04 | Insecure Design | **Addressed** — staging y promoción separados; `type` inmutable; cascada de revocación en la misma transacción |
| A05 | Security Misconfiguration | **Addressed** — helmet; CORS restrictivo heredado, con la decisión pendiente documentada; stack traces solo en desarrollo |
| A06 | Vulnerable and Outdated Components | **Partially Addressed** — S-1, S-2, S-3 |
| A07 | Identification and Authentication Failures | **Addressed** — rechazo uniforme; sin normalización de la clave presentada; `lastUsedAt` como telemetría no fatal |
| A08 | Software and Data Integrity Failures | **Addressed** — idempotencia en índice único parcial; `ON CONFLICT` con predicado que replica el índice palabra por palabra (falla ruidoso si divergen) |
| A09 | Security Logging and Monitoring Failures | **Addressed** — motivo real y `apiKeyId` al log, nunca a la respuesta; asimetría deliberada |
| A10 | SSRF | **Not Applicable** — la capa de ingesta no hace ninguna petición saliente |

### 4.3 Hallazgos

#### S-1 · Medium · dependencia

`exceljs@4.4.0` (introducida por el ítem 5) arrastra `uuid@8.3.2` —
GHSA-w5hq-g745-h8pq, severidad *moderate*.

**Verificado no alcanzable por este camino:** el aviso afecta a v3/v5/v6 cuando
se pasa `buf`, y exceljs usa exclusivamente `v4` sin `buf`, en
`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`.

Sin arreglo no disruptivo: `npm audit fix --force` degradaría exceljs a 3.4.0.

#### S-2 · Medium (aviso HIGH, severidad contextual menor) · dependencia

`ip-address@10.2.0` vía `express-rate-limit@8.5.2` — tres avisos *high* de
bypass de SSRF y de frontera de confianza.

**No la introdujo esta capa** (viene de M1), pero esta capa suma un consumidor.
Impacto real acá: `express-rate-limit` usa `ip-address` solo para normalizar
IPv6 en subredes en su keyGenerator por defecto. `ingestRateLimiter` y
`businessWriteRateLimiter` usan keyGenerator propio (`apiKeyId` / `userId`) y no
lo tocan; `onboardingRateLimiter` y `acceptPreAuthRateLimiter` sí. El peor caso
ahí es **evasión de cupo de rate limit, no SSRF** — la app no hace peticiones
salientes guiadas por esas direcciones.

Arreglable sin ruptura con `npm audit fix`.

#### S-3 · Medium · brecha de proceso

**No hay ningún control de vulnerabilidades de dependencias en CI.**
`.github/workflows/ci.yml` corre typecheck, build, unit, lint, prettier,
migraciones, `verify:schema` e integración — nada que hiciera aparecer S-1 o
S-2. Los dos se encontraron corriendo `npm audit` a mano durante este review.
Sin un gate, un CVE crítico futuro entra sin que nada lo diga.

#### S-4 · Medium · defensa en profundidad

`/api/ingest` **no tiene ningún límite antes de la autenticación**.
`ingestRateLimiter` corre después de `authenticateApiKey` por necesidad
estructural (necesita `apiKeyId`), y eso está documentado.

Pero el costo declarado en `rateLimit.ts` — *"muere sin tocar ninguna tabla de
negocio ni escribir nada"* — **subestima el real**: un request con clave
inválida paga el parseo de hasta 64 KB, un SHA-256 y **un SELECT indexado contra
`api_keys` a través del pool de Prisma**. Sostenido, agota el pool, y el impacto
es multi-tenant desde una superficie no autenticada.

**Acción sugerida.** Un limiter por IP o global delante, o el corte en el borde
de infraestructura el día que exista.

#### S-5 · Medium con mitigación aceptada y documentada

Expansión de XLSX en memoria (zip bomb). `IMPORT_MAX_FILE_BYTES` acota lo que se
**sube**, no lo que ocupa al expandirse; `load()` materializa el libro entero.

Está documentado en `src/utils/spreadsheet.ts` con la razón verificada de por
qué el lector en streaming de exceljs no se pudo usar (falla en
`workbook-reader.js:303`, reproducido). Aceptado para esta etapa porque quien
sube es un ADMIN autenticado, no internet entero.

Se registra porque un review de seguridad no puede dar por cerrado un riesgo
solo porque esté bien escrito el comentario.

### 4.4 Gate

**Ninguna Critical. Ninguna High sin contexto.** El `FAIL absoluto` de
RV-SECURITY no aplica.

Liberado condicionalmente. Condiciones: S-2 resuelta con `npm audit fix` (no
disruptivo) o waived; S-3 con un gate en CI; S-1, S-4 y S-5 con mitigación
aceptada registrada.

---

## 5. RV-STANDARDS — Standards Review

```
Report ID:  RR-STD-2026-08-27-01     Manifest: RM-2026-08-27-INGESTA-1-5
Outcome:    CONDITIONAL PASS
```

### 5.1 Verificación por estándar bindeado

| Estándar | Criterio | Evaluación |
|---|---|---|
| **STD-SW-001** SOLID (Mandatory) | SRP / DIP / ISP | **MET** — separación repositorio/servicio/controlador/middleware consistente; `Db` inyectable en cada función de repositorio; `IngestContext` disjunto de `AuthContext` |
| **STD-SW-002** OWASP (Mandatory) | 10 categorías evaluadas | **PARTIALLY MET** — A06 por S-1/S-2/S-3; las otras nueve Addressed o Not Applicable |
| **STD-SW-003** Testing (Mandatory) | Pirámide, caminos críticos, modos de falla | **MET** — unitarios para lógica pura, integración contra Postgres real para los bordes; ramas de error cubiertas (401/403/404/409/413/415/429) |
| **STD-SW-004** Code Review (Mandatory) | RV-ENG conducido con clasificación de severidad | **MET** |
| **STD-LEG-002** Data Privacy (Mandatory) | Clasificación de datos | **NOT MET** — D-1 |
| | Minimización | **PARTIALLY MET** — D-2 |
| | Retención y borrado | **NOT MET** — D-3 |
| | Control de acceso (rol) | **MET** — ADMIN-only + aislamiento por organización |
| | Control de acceso (log de acceso a datos Sensibles) | **PARTIALLY MET** — se loguea el request, no el acceso por registro |
| | Derechos del titular — borrado | **PARTIALLY MET** — D-4 |
| **STD-LEG-001** GDPR (Conditional) | — | **Not Applicable / hueco abierto** — Q-1 |
| **STD-GEN-001/002** (Advisory) | — | Notados, no gatean. La documentación inline está muy por encima del estándar |

### 5.2 Hallazgos

#### D-1 · Medium · STD-LEG-002, Clasificación de datos

El estándar exige clasificar cada elemento de datos **antes** de empezar. No
existe ningún documento que clasifique los campos que maneja la capa de ingesta.
Por la tabla del estándar, `firstName`/`lastName`/`email`/`phone`/`jobTitle` de
un lead son **Sensitive** — lo que arrastra requisitos de cifrado en reposo, log
de acceso y control estricto.

Hoy eso se cumple implícitamente en parte (Supabase cifra en reposo; el acceso
es ADMIN-only) pero no está declarado, así que nadie puede verificarlo contra
nada.

#### D-2 · Low · STD-LEG-002, Minimización

El webhook guarda el payload **entero**, incluidas las claves desconocidas que
`ingestContactSchema` ignora. Es deliberado y bien argumentado (§1: sin el crudo
intacto no hay reproceso), pero está en tensión directa con *"cada campo debe
tener un propósito definido; 'podría servir después' no es un propósito"*.

No se propone cambiarlo — la decisión de §1 es sólida. Se propone que quede
registrado como excepción consciente y no como algo que nadie miró.

#### D-3 · Medium · STD-LEG-002, Retención y borrado

**El hallazgo más sustantivo de este ciclo.**

`IngestionEvent.rawPayload` guarda una **segunda copia de datos personales**,
indefinidamente. El estándar exige, para cada categoría, un período máximo de
retención, un disparador de borrado y un método de borrado. **No existe ninguno
de los tres.**

La §9.1 del documento esboza la consulta
(`DELETE FROM ingestion_events WHERE created_at < ? AND status IN ('PROCESSED','DUPLICATE')`)
pero **nadie la corre**: no hay job, ni script, ni entrada en CI. Peor:
`src/repositories/ingestionEvent.repository.ts:52` la referencia como si
existiera — *"entre el INSERT que no insertó y el SELECT podría correr la purga
por retención de la nota 9.1"* — y esa purga es hoy solo una frase en un
documento.

#### D-4 · Medium · STD-LEG-002, Derechos del titular (borrado)

Borrar un `Contact` es soft delete y **no toca la copia de `rawPayload`**. Un
pedido de borrado de datos no podría honrarse de punta a punta hoy.

Alcance honesto: la parte de `ingestion_events` la introdujo este deliverable; la
ausencia de un mecanismo de derechos del titular es **anterior y de todo el
proyecto**, no de estos cinco ítems.

### 5.3 Por qué CONDITIONAL PASS y no FAIL

El protocolo dice FAIL ante *"cualquier criterio Mandatory Not Met sin razón
aceptable"*. D-1 y D-3 son Not Met.

Se asienta como CONDITIONAL PASS porque hay camino de remediación claro y
trazable (§9.1 ya especifica el `DELETE` exacto) y porque **el sistema no está en
producción**: no hay pipeline de CD hacia ningún hosting, así que todavía no hay
titulares de datos reales.

**Esta es la parte del veredicto que conviene revisar:** si esta capa recibiera
leads reales en producción, D-3 sería un FAIL, no una condición. La diferencia la
hace un hecho operativo, no el código.

---

## 6. Hallazgos consolidados

| ID | Sev. | Review | Qué es | Bloquea |
|---|---|---|---|---|
| E-1 | Medium | ENG | El CAS de transición de estado descarta su `count` — red de seguridad inerte | No |
| E-2 | Low | ENG | El 202 de duplicado informa `PENDING` sin leer el estado real | No |
| E-3 | Low | ENG | Comentario inexacto sobre el número de fila del `externalId` | No |
| S-1 | Medium | SEC | `uuid@8.3.2` vía exceljs — verificado no alcanzable | No |
| S-2 | Medium | SEC | `ip-address@10.2.0` vía express-rate-limit — arreglo no disruptivo disponible | No |
| S-3 | Medium | SEC | CI sin control de vulnerabilidades de dependencias | No |
| S-4 | Medium | SEC | `/api/ingest` sin límite antes de autenticar — el costo real toca Postgres | No |
| S-5 | Medium | SEC | Expansión de XLSX en memoria — documentado y aceptado | No |
| D-1 | Medium | STD | Sin clasificación declarada de datos personales | No |
| D-2 | Low | STD | Payload crudo completo vs. minimización — excepción consciente sin registrar | No |
| D-3 | Medium | STD | **Sin política de retención implementada para `ingestion_events`** | No |
| D-4 | Medium | STD | Borrar un Contact no borra su copia en `rawPayload` | No |

**Ninguna Critical. Ninguna High. Ningún FAIL.** No se corrigió ningún hallazgo:
los tres reviews se conducen y se reportan, la remediación es una decisión
aparte.

---

## 7. Comandos ejecutados

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpio (3 proyectos tsc) |
| `npm test` | **115 pass, 0 fail** — exit code 0 |
| `npm audit --omit=dev` | 3 vulnerabilidades (1 high, 2 moderate) — S-1, S-2 |
| `npm ls ip-address` / `npm ls uuid` / `npm ls exceljs` | Trazado el origen de cada una |
| `grep` en `node_modules/exceljs` | Confirmado uso de `uuid.v4` sin `buf` — no alcanzable |

`npm run test:integration` **no se corrió**: necesita el stack de Supabase local
que levanta el job `integration` de CI. Se verificó que CI lo corre completo
(`ci.yml:249`) después de reconstruir la base con `migrate:deploy` y auditarla
con `verify:schema`.

---

## 8. Fuera de alcance

- No se tocó `docs/project-overview.md`.
- No se corrigió ningún hallazgo.
- No se creó `state/` ni se archivaron los reports dentro de la instalación del
  Toolkit: nunca se hizo para M1 a M7 y hacerlo ahora sería ampliar el alcance
  sin pedirlo.

---

## 9. Dudas abiertas

### Q-1 · STD-LEG-001 (GDPR) — hueco no crítico, sin resolver

El estándar es Mandatory si hay datos personales de residentes de la UE en
alcance. Nadie declaró la jurisdicción de los leads en ningún lado, y una landing
page es alcanzable desde la UE por definición. Se deja como hueco declarado en
vez de asumir que no aplica.

**Si la respuesta es que sí hay leads de la UE, D-3 pasa de condición a
bloqueante**, porque el borrado y la retención dejan de ser buenas prácticas y
pasan a ser obligación legal.

### Q-2 · Cómo seguir con los 12 hallazgos

Lectura propuesta:

- **Ciclo corto:** E-1, S-2 y S-3 son correcciones chicas y acotadas (verificar
  un `count`, un `npm audit fix`, un paso de CI).
- **Ciclo propio de privacidad de datos:** D-1, D-3 y D-4, con alcance de
  proyecto y no solo de ingesta.
- **Anotaciones:** E-2, E-3, D-2, S-1, S-4, S-5.

### Q-3 · Brecha procedimental del Toolkit ya conocida

El procedimiento de RV-ENG (pasos 3 a 6) no tiene paso de Performance ni de
SOLID, pero sus criterios de aceptación sí los exigen. Se evaluaron igual, contra
los criterios. Ya está registrado como pendiente del Toolkit para un ciclo
dedicado; no se reporta como nuevo.

### Q-4 · Observación fuera del alcance de estos reviews

`docs/project-overview.md` §9 sigue diciendo *"Sigue sin existir configuración de
linter/formatter (ESLint, Prettier)"*, pero `ci.yml` tiene un job `lint` que
corre `npm run lint` y `npm run format:check` sobre backend y frontend. Es una
contradicción de documentación, no un hallazgo de la capa de ingesta — se anota
acá para que no se pierda.
