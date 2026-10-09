# Rubros: AUTOMOTORA y CLINICA

> Documento de diseño. Estado: **borrador para revisión, sin código**. Fecha:
> 2026-10-09.
> Las decisiones que Rocco ya tomó están en §0.2 y no se reabren. Lo que queda
> por decidir está en §14 como preguntas (P1–P15), cada una con opciones y una
> recomendada. Los choques con `docs/ediciones.md` están marcados con **⚠
> ediciones** y también van a §14.
> Nada de lo descrito acá existe todavía. Las referencias `archivo:línea` son al
> código de `master` en el merge de #452 (`9876b16`) y sirven para ubicar dónde
> se tocaría. `src/config/ediciones.ts` todavía no existe: es el PR 3 de
> ediciones.
> Todos los nombres de personas, clínicas y prestaciones de este documento son
> inventados.

## 0. Por qué

### 0.1 El pedido

La plataforma nació para automotoras. Los primeros clientes de un segundo rubro
van a ser **clínicas de estética y dermatología**. Una clínica no tiene stock de
vehículos, permutas ni test drive. Su núcleo es la **agenda**: turnos con
profesionales, recordatorios, confirmaciones y el control después del turno.
Además maneja un dato que una automotora no maneja: la **salud** de las
personas.

### 0.2 Decisiones ya tomadas (Rocco, 2026-10-09)

| # | Decisión |
|---|---|
| R1 | **Misma plataforma**, no un proyecto aparte. |
| R2 | **Un rubro por organización** (`AUTOMOTORA` \| `CLINICA`), **independiente de la edición** (`COMPLETA` \| `ESENCIAL`). El rubro cambia el vocabulario y los módulos propios del rubro; la edición cambia cuánto del sistema hay y cuánta IA. |
| R3 | Primeros clientes: **clínicas de estética / dermatología**. |
| R4 | Las clínicas **arrancan en ESENCIAL**. El diseño tiene que funcionar con cualquier edición. |
| R5 | La **agenda vive en la plataforma** (recursos, servicios, turnos, Google Calendar). Sin integrar sistemas externos en la v1. |
| R6 | **Varios profesionales**, cada uno con sus horarios y prestaciones. La duración es por prestación. **Sobreturnos opcionales y desactivados por defecto.** Sin consultorios ni equipos como recurso aparte en la v1. |
| R7 | **Pagos:** el agente solo informa. No cobra ni pide señas. Cobertura de mutualistas: solo la informa si la clínica la cargó. |
| R8 | **Recordatorio 24 h antes**, con plantilla. El paciente confirma o cancela respondiendo. Si no responde, el turno **no se cancela solo**: se crea una tarea y un aviso a recepción. |
| R9 | **Después del turno:** reseña con QR y recordatorio de control o de próximo turno, con el intervalo que la clínica define por prestación. |
| R10 | **Vocabulario:** "paciente" o "cliente", configurable por organización. Por defecto, "paciente" en clínicas. |
| R11 | **Datos de salud:** el agente nunca da historia clínica, diagnósticos ni consejos médicos. Ante síntomas o consultas clínicas deriva con un mensaje fijo. Ante una urgencia indica llamar a emergencias y deriva. **Validado en el backend, no solo en el prompt.** Datos mínimos: nombre, teléfono, prestación y turno. Sin motivo clínico detallado por defecto. |

### 0.3 Rubro y edición, en una frase

- La **edición** dice **cuánto** sistema tiene la organización y cuánta IA
  (`docs/ediciones.md`).
- El **rubro** dice **de qué negocio** es: qué módulos son propios de ese
  negocio, qué palabras usa la pantalla y el agente, y qué reglas extra valen
  (las de salud, en CLINICA).

Las dos se combinan siempre por **intersección**: un módulo está disponible si
lo permiten la edición **y** el rubro. El rubro nunca agrega lo que la edición
quita.

---

## 1. Modelo

### 1.1 Rubro de la organización

```prisma
enum OrganizationIndustry {
  AUTOMOTORA
  CLINICA
}

enum ContactTerm {
  CLIENTE
  PACIENTE
}

model Organization {
  // ...
  industry    OrganizationIndustry @default(AUTOMOTORA)
  contactTerm ContactTerm          @default(CLIENTE) // ver §3
}
```

- **Nombre: `industry`.** No se reusa `Company.industry`
  (`schema.prisma:918`): ese es un texto libre que describe a una empresa
  cliente, no un enum que cambia el comportamiento del sistema.
- **Existentes:** la migración agrega la columna con `DEFAULT 'AUTOMOTORA'`.
  Todas las organizaciones actuales son automotoras: **no hace falta backfill**.
  Igual que `edition`, ningún código lee la columna hasta el PR del gate.
- **Quién lo elige:** el platform admin, en **Plataforma → Nueva
  organización**, **junto a la edición** y con el mismo criterio
  (`docs/ediciones.md` §1.1): obligatorio en el formulario y sin valor
  preseleccionado, para que sea una decisión consciente. En la API es opcional,
  con default `AUTOMOTORA`, por compatibilidad.
- **Quién lo cambia:** solo el platform admin. Ver P1 (§14). La recomendación es
  permitirlo **solo mientras la organización no tenga datos de negocio**
  (contactos, turnos, conversaciones) y responder 409 en cualquier otro caso.
  Cambiar de rubro con datos cargados deja cosas sin sentido: vehículos en una
  clínica, o turnos con recordatorios de salud en una automotora.
- **Caché de autenticación:** igual que la edición, el rubro viaja en
  `AuthContext`. Un cambio llama a `vaciar()` (`authContextCache.ts:33`).
- El ADMIN de la organización ve el rubro como dato de **solo lectura** en
  `/organization`, junto a la edición.

### 1.2 Cómo se combinan rubro y edición: un solo catálogo

**No se duplica el gate.** `docs/ediciones.md` §5 define un catálogo
(`src/config/ediciones.ts`) y un único middleware (`gateDeEdicion`). El rubro se
suma **al mismo archivo y al mismo middleware**:

```ts
// src/config/ediciones.ts (se extiende; no hay un rubros.ts aparte para el gate)

export type Modulo =
  | /* ...los de ediciones §5.1... */
  // nuevos, propios de un rubro:
  | "stock"                  // ya existe en ediciones; pasa a depender también del rubro
  | "recordatorios_de_turno" // §6
  | "post_turno";            // §7

export const MODULOS_POR_EDICION: Record<OrganizationEdition, ReadonlySet<Modulo>>;
export const MODULOS_POR_RUBRO:   Record<OrganizationIndustry, ReadonlySet<Modulo>>;

/** La única función que decide. Todo el resto (gate, /me, tools, automatizaciones) la usa. */
export function modulosDe(edition: OrganizationEdition, industry: OrganizationIndustry): ReadonlySet<Modulo> {
  // intersección: un módulo existe si lo permiten las dos tablas
}

export const RUTAS_POR_MODULO: ReadonlyArray<{ metodo: string; ruta: string; modulo: Modulo }>;
```

- `MODULOS_POR_RUBRO[AUTOMOTORA]` = **todos** los módulos de hoy más los
  nuevos que apliquen a las dos (ver §2). Así una automotora en COMPLETA sigue
  comportándose **exactamente igual que hoy**, que es la garantía de
  ediciones §5.3.
- `gateDeEdicion` pasa a llamar a `modulosDe(req.auth.edition,
  req.auth.industry)` en vez de leer `MODULOS_POR_EDICION` directo. Es un
  cambio de una línea en el middleware. `findUserForAuth` suma `o.industry` y
  `o.contact_term` al mismo `SELECT` que ya suma `o.edition`.
- **Bloqueos por campo** (ediciones §5.3, refinaciones zod): se suma una lista
  de campos por rubro en el mismo archivo. En CLINICA, por ejemplo,
  `vehicleOfInterestId` en `/api/contacts` da 400.
- **Respuesta:** la misma, 403 `MODULO_NO_INCLUIDO` (D10). ⚠ ediciones: el
  frontend de ediciones muestra "Disponible en la edición completa", y en
  CLINICA eso sería falso para el stock (subir de edición no lo habilita). Se
  propone un campo aditivo `motivo: "EDICION" | "RUBRO"` en el cuerpo del 403.
  Ver P12.
- **Caminos que no pasan por HTTP** (tabla de ediciones §5.2): tools del
  agente, automatizaciones e importación usan la misma `modulosDe`. No hay una
  segunda tabla.
- **Test "toda ruta clasificada"** (ediciones §5.4 punto 1): no cambia. Una ruta
  sigue teniendo un solo módulo; lo que cambia es qué conjunto de módulos ve
  cada organización.
- **Suite de integración:** la de ediciones se generaliza a las combinaciones
  edición × rubro. Se generan los casos desde `modulosDe`, no a mano (§12).

---

## 2. Qué entra en cada rubro

La tabla describe CLINICA. **AUTOMOTORA = todo lo que existe hoy, sin
cambios**, más los módulos nuevos de agenda que sirven para los dos rubros
(reprogramar, bloqueos, "Atendido / No vino"). La columna "Con ESENCIAL" dice
qué pasa al combinarla con la tabla de ediciones §2.

| Módulo | CLINICA | Con ESENCIAL | Notas |
|---|---|---|---|
| Agentes de IA (+ probador, embed, guardrails) | ✅ | ✅ | Con los guardrails de salud obligatorios (§5). |
| Canales: WhatsApp, web, Messenger, Instagram | ✅ | ✅ | |
| Base de conocimiento | ✅ | ✅ | **Sin `sync-vehicles`** (`POST /api/knowledge-base/sync-vehicles`, `knowledgeBaseEntry.routes.ts:95`). |
| Conversaciones | ✅ | ✅ | |
| Contactos ("Pacientes" / "Consultas sin identificar") | ✅ | ✅ | Sin "Vehículo de interés" (`ContactFormPage.tsx:409-411`). |
| Usuarios, invitaciones | ✅ | ✅ | |
| Sucursales ("sedes"), horarios | ✅ | ✅ | |
| **Agenda** (profesionales, prestaciones, turnos, Google Calendar) | ✅ **núcleo** | ✅ | Con los cambios de §4. |
| **Recordatorios de turno con confirmación** | ✅ | ✅ | Nuevo, §6. También disponible para AUTOMOTORA (test drive), ver P13. |
| **Post-turno: QR de reseña y recordatorio de control** | ✅ | ✅ | Nuevo, §7. |
| Tareas (actividades) | ✅ | ✅ | |
| Seguimiento de consultas (#446) | ✅ con ajustes | ✅ | §9. |
| Cupones y QR de reseñas | ✅ | ✅ | El disparador en CLINICA es "turno atendido", no "venta registrada" (§7). |
| Dashboard | ✅ atención | ✅ simple | El de atención de ediciones §6.4, más una tarjeta "turnos de hoy" (ver §11). |
| Campos personalizados | ✅ con aviso | ✅ (D5) | Con aviso de no cargar datos de salud (§8.2). |
| Agente interno | ✅ opt-in | ✅ (D6) | `get_agenda` es lo más útil para una clínica. |
| Fuentes / API keys / ingesta | ✅ | ✅ (D8) | |
| Importación de datos | ✅ | ✅ | Sin la entidad "vehículos". |
| **Stock de vehículos** | ❌ | — | Rutas `/api/vehicles*` (`vehicle.routes.ts`) → 403. |
| **Vehículo de interés** | ❌ (campo) | — | `vehicleOfInterestId` en `/api/contacts` → 400. |
| **Test drive** | ❌ | — | No es una entidad: era un `ServiceType` con ese nombre. Solo cambian textos y ejemplos (§5.6). |
| **Permutas** | ❌ | ❌ | Ya excluidas en ESENCIAL. En COMPLETA + CLINICA también se excluyen (`tradeInOpportunityId` → 400). |
| `reserve_vehicle`, `search_vehicles` | ❌ | — | Tools del agente, ver §5.1. |
| **Oportunidades** | ❌ recomendado | (mínima) | Ver §2.1 y P3. |
| Procesos de venta, cotizaciones, pagos, entregas, empresas | ❌ | ❌ | En COMPLETA + CLINICA también quedan afuera en la v1 (ver §2.1). |
| `get_payment_info` | ❌ recomendado | ✅ (D11) | Ver §5.1: R7 dice que el agente informa, no cobra. |

### 2.1 Las oportunidades en una clínica

**El problema.** En ESENCIAL hay una lista mínima de oportunidades con un
proceso fijo "Ventas" (ediciones §2.1). En una clínica:

- el agente no tiene iniciativas para crearlas: `INICIATIVAS_DEL_CLIENTE`
  (`utils/iniciativaDelCliente.ts:19-26`) es 100% automotor (test drive, seña,
  financiación, ver la unidad, permuta);
- lo que una clínica "vende" es un turno, y el turno ya es una entidad
  (`Booking`);
- QR y cupón cuelgan hoy de `opportunity.won` (ediciones §3), y en una clínica
  el momento natural es "turno atendido" (§7).

**Opciones (P3):**

| Opción | Qué implica | A favor | En contra |
|---|---|---|---|
| **A. Ocultarlas en CLINICA (recomendada)** | `oportunidades` fuera de `MODULOS_POR_RUBRO[CLINICA]`. Fuera `create_opportunity` y `update_opportunity`. El pipeline fijo de ESENCIAL se sigue creando en el alta (ediciones §2.1), sin bifurcar esa transacción, y queda invisible. | Una pantalla menos. El agente no necesita un concepto que no le sirve. El post-turno sale del turno. | Un "tratamiento de 6 sesiones" con un presupuesto no tiene dónde registrarse en la v1. |
| B. Lista mínima, como en ESENCIAL | Iniciativas por rubro ("pidió presupuesto de tratamiento"). | Sirve para presupuestos. | Duplica el turno. Dos disparadores de post-venta. |

Con **A**, el seguimiento de consultas (#446), que mira "¿tiene una oportunidad
OPEN?", ve siempre "no tiene" y sigue funcionando (ediciones §6.3 ya lo
anticipa). Ahí hace falta un filtro nuevo por turnos: ver §9.

**COMPLETA + CLINICA:** con A, también se ocultan procesos de venta,
cotizaciones, pagos y entregas, porque cuelgan de oportunidades. Una clínica
en COMPLETA tendría la IA en AUTONOMA sin restricciones de edición, pero no los
módulos de venta de autos. Que COMPLETA aporte algo propio a una clínica
(presupuestos de tratamiento, paquetes de sesiones) queda para un diseño
posterior, cuando un cliente lo pida.

---

## 3. Vocabulario

Hay dos capas distintas:

| Capa | Ejemplo | Dónde vive | Quién lo cambia |
|---|---|---|---|
| **Término del contacto** (R10) | "paciente" / "cliente" | `Organization.contactTerm` | El ADMIN de la organización, en `/organization` |
| **Vocabulario del rubro** | "Profesionales" en vez de "Recursos", "Prestaciones" en vez de "Tipos de servicio", "Turnos" en vez de "Reservas", "Responsable" en vez de "Vendedor" | `src/config/rubros.ts`, constante `VOCABULARIO_POR_RUBRO` | Nadie: es fijo por rubro |

- **Default de `contactTerm`:** la columna tiene `DEFAULT 'CLIENTE'` (así no
  hay backfill). El alta de una organización CLINICA guarda `PACIENTE`
  explícito, en la misma transacción. Una automotora también lo puede cambiar,
  aunque no tenga motivo.
- **`/me`** devuelve `industry`, `contactTerm` y un objeto `vocabulario` ya
  armado por el backend (singular, plural, con y sin mayúscula). Mismo
  criterio que `modulos` en ediciones §7: el frontend no tiene su propia tabla.

### 3.1 Frontend

No hay biblioteca de i18n: todos los textos están escritos en el JSX, con
`labels.ts` por feature (`contact/labels.ts:23-29`). Hay unas 127 apariciones de
"cliente" fuera de los tests, en 59 archivos de `features/`. **No se
reemplazan todas.** Un hook `useVocabulario()` cubre las pantallas que ve una
clínica:

| Pantalla | Textos |
|---|---|
| Menú (`AppLayout.tsx`) | "Reservas" → "Turnos", "Calendario" → "Agenda", "Recursos" → "Profesionales", "Tipos de servicio" → "Prestaciones". "Stock" desaparece por módulo. |
| Contactos (`ContactListPage.tsx:38-41`) | Pestaña "Clientes" → "Pacientes". |
| Etapa del ciclo de vida | `CUSTOMER` = "Cliente" → "Paciente" (`contact/labels.ts`). |
| Agenda (`features/booking/`, `resource/`, `serviceType/`) | Títulos, columnas y el panel de crear turno. |
| Sucursales | "Vendedor por defecto" (`Branch.defaultOwnerId`) → "Responsable por defecto". |
| Conversaciones y tareas | Los asuntos de tarea que arma el backend (§3.2). |
| Automatizaciones (`features/automation/catalog.ts`) | Rótulos de triggers y textos por defecto (el de #446 menciona "test drive", `catalog.ts:384`). |

Una prueba de vitest recorre esas pantallas con `contactTerm = PACIENTE` y
falla si aparece la palabra "cliente" en lo visible. Es la red para que no se
cuele una pantalla nueva.

### 3.2 Backend y prompt del agente

Textos del agente que hoy están escritos para una automotora
(`agentOrchestration.service.ts`):

| Constante | Línea | Qué tiene de automotor |
|---|---|---|
| `INSTRUCCION_SIN_AUTORIDAD_COMERCIAL` | 409 | "permuta, financiación" |
| `INSTRUCCION_SOLO_LO_QUE_TE_CONSTA` | 435 | "si un auto acepta permuta o tiene financiación… búsqueda de stock" |
| `INSTRUCCION_OPORTUNIDAD_CON_INICIATIVA` | 453 | Ya no va en CLINICA: la tool no está (§2.1). |
| `MENSAJE_DE_FUGA_BLOQUEADA` | 505 | "sobre los vehículos, precios o para coordinar una visita" |
| `INSTRUCCION_DE_CIERRE_POR_TOPE` | 148 | "la unidad" |
| Descripciones de `get_availability` / `create_booking` | `agentTools.service.ts:1435`, `1597`, `1680` | Ejemplo de servicio: "Test drive" |

**Propuesta:** `textosDelRubro(industry, contactTerm)` en `src/config/rubros.ts`
devuelve esas piezas. `armarSystemPrompt` sigue siendo **pura** y las recibe por
parámetro, como ya recibe la base de conocimiento. El prompt usa el término del
contacto ("el paciente") donde hoy dice "el cliente".

**Lo que no se hace:** decirle al modelo "sos el agente de una clínica" como
única defensa. Sí se le dice de qué negocio es, porque cambia cómo habla. Pero
las reglas de salud las hace cumplir el backend (§5.3), igual que ediciones §6.2
no le cuenta la edición al modelo.

Los textos fijos que manda el backend (avisos de derivación, asunto de las
tareas, mensajes de error de las tools) pasan por la misma función.

---

## 4. Agenda para clínicas

### 4.1 Qué existe hoy

| Pieza | Estado | Dónde |
|---|---|---|
| `Resource` (`PERSON`, `ROOM`, `CLASS`) por sucursal | ✅ | `schema.prisma:1931-1959`, enum `:153-157` |
| `ServiceType` con `durationMin` y `capacity` | ✅, **con un solo recurso** (`resourceId` NOT NULL) | `schema.prisma:1981-2016` |
| `WorkingHours` por recurso, en franjas, horario partido | ✅ | `schema.prisma:2173-2213` |
| `Booking` (`CONFIRMED`, `CANCELLED`, `COMPLETED`, `NO_SHOW`) | ✅ | `schema.prisma:2277-2344` |
| Disponibilidad: horario − Google − reservas, contra la capacidad | ✅ | `availability.service.ts:156-221` |
| Crear con lock de recurso y de servicio | ✅ | `booking.service.ts:269-316` |
| `force` (solo ADMIN): saltea horario y grilla, **no** la capacidad | ✅ | `booking.service.ts:92-97`, `157-164` |
| Cancelar | ✅ | `PATCH /api/bookings/:id/cancel`, `booking.service.ts:415-454` |
| Google Calendar: conexión por sucursal, evento por turno, cancelación inversa | ✅ | `docs/booking-architecture.md` §4 |
| **Reprogramar** | ❌ fuera de alcance a propósito | `booking.service.ts:33-37` |
| **Pasar a `COMPLETED` / `NO_SHOW`** | ❌ ningún código lo hace | Solo filtro y badges (`booking/format.ts:5-15`) |
| **Eventos de turno** (outbox) | ❌ | `booking.service.ts:39-42` |
| **Bloqueos puntuales y feriados** | ❌ | booking-architecture §3, nota del 30/08 |
| **Una prestación con varios profesionales** | ❌ | `ServiceType.resourceId` |
| **Sobreturnos** | ❌ | `force` no es un sobreturno: no saltea la capacidad |

### 4.2 Profesionales

**Un profesional es un `Resource` con `type = PERSON`.** No hace falta una
entidad nueva: ya tiene sucursal, horario partido por día y nombre. `ROOM` y
`CLASS` no se ofrecen en la pantalla de CLINICA en la v1 (R6).

- Un profesional **no es un `User`**. Muchos profesionales no van a entrar
  nunca al CRM. Si algún día hace falta ("mi agenda" para el profesional), se
  suma un `Resource.userId` opcional.
- El nombre que se muestra al paciente (en el recordatorio y en el chat) es
  `Resource.name` ("Dra. Lucía Ejemplo"). La pantalla lo aclara.

### 4.3 Prestaciones con varios profesionales

**El problema.** `ServiceType.resourceId` es NOT NULL y apunta a **un** recurso.
En una clínica, "Limpieza facial" la hacen dos cosmetólogas, y el paciente
quiere "el primer turno libre con cualquiera". Hoy habría que crear dos
prestaciones con el mismo nombre, y entonces `resolverServicio`
(`agentTools.service.ts:1455-1510`) falla por ambigüedad.

**Propuesta:** una tabla puente.

```prisma
model ServiceTypeResource {
  organizationId String
  serviceTypeId  String
  resourceId     String
  createdAt      DateTime @default(now())
  @@id([serviceTypeId, resourceId])
  // FKs compuestas (organizationId, x) como el resto del módulo
}
```

- **Migración:** crea la tabla y la **rellena** con una fila por cada
  `ServiceType` existente (`serviceTypeId`, `resourceId`). `ServiceType.resourceId`
  queda en el schema, sin uso nuevo, y se borra en un PR posterior (borrar una
  columna no se mergea por iniciativa propia). Mientras tanto, el service
  escribe las dos cosas.
- **Duración por prestación (R6):** sigue en `ServiceType.durationMin`. No hay
  duración por profesional en la v1.
- **Capacidad:** sigue en `ServiceType.capacity`, por profesional. En una
  clínica siempre es 1.
- **Disponibilidad:** `GET /api/availability` acepta `serviceTypeId` sin
  `resourceId` y devuelve los turnos de **todos** los profesionales de la
  prestación, cada uno con su `resourceId` y su nombre. Con `resourceId`,
  igual que hoy.
- **Crear un turno sin profesional elegido:** el service elige al profesional
  libre en ese horario. Si hay varios, el de **menos turnos ese día** (reparte
  la carga). Con el lock del recurso elegido, como hoy.
- `get_service_types` devuelve, por prestación, la lista de profesionales
  (`id`, `name`). Hoy devuelve un `resourceId` sin nombre.

### 4.4 Sobreturnos (R6)

**Qué es un sobreturno:** un turno que se superpone con otro del **mismo
profesional** aunque la capacidad ya esté completa. No es `force`: `force`
saltea el horario y la grilla, pero nunca la capacidad.

```prisma
model Resource {
  // ...
  allowsOverbooking Boolean @default(false)
}

model Booking {
  // ...
  isOverbooking Boolean @default(false)
}
```

- **Desactivado por defecto**, por profesional.
- Lo crea **solo una persona del equipo** desde el panel, con un
  `overbooking: true` en `POST /api/bookings`. El agente **nunca** ofrece ni
  crea sobreturnos (ver P9): no entran en `get_availability` y la tool no
  acepta el campo.
- Valida todo lo demás igual: horario de trabajo (salvo `force`), "no en el
  pasado" y aislamiento. Lo único que saltea es la capacidad.
- Un sobreturno no cuenta para la capacidad de los turnos normales: no le quita
  lugar a nadie.
- El calendario lo muestra con una marca. El recordatorio sale igual.

### 4.5 Bloqueos puntuales

"La Dra. no atiende el 24 de diciembre" o "esta tarde tiene un congreso" no se
pueden expresar hoy (booking-architecture §3, nota del 30/08). En una clínica
pasa todas las semanas.

```prisma
model ResourceTimeOff {
  id             String   @id
  organizationId String
  resourceId     String
  startsAt       DateTime // instante, no hora local: un bloqueo es un período real
  endsAt         DateTime
  reason         String?  @db.VarChar(200) // interno: "congreso", nunca se le muestra al paciente
  createdAt      DateTime @default(now())
}
```

- `calcularTurnos` y `estaDentroDelHorario` restan los bloqueos. Tiene que ser
  **la misma** función para ofrecer y para aceptar (es el criterio de
  booking-architecture §5).
- Crear un bloqueo encima de turnos ya dados **no los cancela**: responde con
  la lista de turnos afectados y la pantalla ofrece reprogramarlos o
  cancelarlos uno por uno.

### 4.6 Google Calendar con varios profesionales (hallazgo)

**Hoy, con Google conectado, un turno de un profesional bloquea a todos los
demás de la sucursal.** `obtenerDisponibilidad` consulta el `freebusy` del
calendario **de la sucursal** y resta esos intervalos de **cualquier** recurso
(`availability.service.ts:178-191`). El evento de cada turno se crea en ese
mismo calendario. En una sucursal con un solo recurso no se nota. En una
clínica con tres profesionales, cada turno vuelve "ocupado" ese horario para
los tres.

**Opciones (P4):**

| Opción | Qué implica | A favor | En contra |
|---|---|---|---|
| **A. Google como espejo en CLINICA (recomendada para la v1)** | La agenda de la plataforma es la fuente de verdad (R5). Google recibe los eventos (con el nombre del profesional en el título) y la cancelación inversa sigue andando. **No se resta el `freebusy`** en las sucursales con más de un profesional. Los bloqueos se cargan en la plataforma (§4.5). | Sin migración ni scopes nuevos. Coherente con R5. | Lo que un profesional anote solo en Google no bloquea su agenda. |
| B. Un calendario por profesional | `Resource.googleCalendarId` (estaba en el diseño original y nunca se construyó). `freebusy` y `events.insert` por calendario. Un canal de `events.watch` por calendario: el estado del canal sale de `GoogleCalendarConnection` a una tabla nueva. | Cada profesional maneja su Google. | Migración y cambio del worker de renovación. Hay que verificar los scopes de nuevo: elegir un calendario de una lista necesita leer la lista de calendarios, y sumar un scope obliga a reconectar todas las sucursales (booking-architecture §4). |

Con A, "no restar el `freebusy`" se decide por sucursal y por rubro en un solo
lugar. Una automotora con un solo recurso sigue igual que hoy.

### 4.7 Reprogramar

Una clínica reprograma todo el tiempo. Hoy el camino es cancelar y crear, y eso
pierde la historia del turno y (cuando existan) sus recordatorios.

- `PATCH /api/bookings/:id/reschedule` `{ startsAt, resourceId? }`.
- **Mismo `id`.** Los recordatorios pendientes se recalculan sobre el horario
  nuevo (§6).
- En una transacción: lock del recurso viejo y del nuevo (**en orden por
  `id`**, para no generar un deadlock con otra reprogramación cruzada),
  revalidación con `resolverContexto` (la misma función que crear),
  capacidad sin contar el propio turno, y `UPDATE`.
- Después del commit: `events.patch` en Google (`calendar.events` alcanza),
  best-effort como crear.
- Solo desde `CONFIRMED` y hacia el futuro.
- Se guarda `rescheduledFrom` (el `startsAt` anterior) en una `Activity` NOTE
  del contacto. No hace falta una columna.
- Con esto se puede cambiar también la decisión de booking-architecture §4
  sobre un evento **movido** en Google: hoy solo se registra. Sigue igual en la
  v1; aplicarlo con la misma función queda para después.

### 4.8 "Atendido" y "No vino"

`COMPLETED` y `NO_SHOW` existen en el enum y nadie los escribe. El post-turno
(§7) los necesita.

- `PATCH /api/bookings/:id/attended` y `/no-show`: transiciones de estado, con
  el verbo en el path, como `cancel`. Solo desde `CONFIRMED`, y solo después de
  `startsAt`.
- **Cierre automático (P6):** un worker pasa a `COMPLETED` los turnos
  `CONFIRMED` cuyo `endsAt` pasó hace más de `HORAS_PARA_CERRAR_TURNO`
  (propuesta: 3 h). En una clínica chica nadie va a tocar "Atendido" en cada
  turno, y sin eso el post-turno no corre nunca. Hasta ese momento, recepción
  puede marcar "No vino".
- Columna nueva `Booking.completedAt` y `completedBy` (`USER` \| `AUTO`), para
  que la automatización sepa cómo se cerró.
- **Eventos al outbox:** `booking.created`, `booking.cancelled`,
  `booking.rescheduled` y `booking.completed`. Hoy no se emiten porque no había
  handlers (`booking.service.ts:39-42`); ahora los consumen §6 y §7.

---

## 5. El agente en una clínica

### 5.1 Tools por rubro

Filtro efectivo (extiende ediciones §6.1):

**`enabledTools ∩ toolsDeLaEdicion ∩ toolsDelRubro ∩ toolsDelNivel`**

Se aplica en los mismos dos lugares, `toolsHabilitadas`
(`agentTools.service.ts:2913`) y `puedeEjecutarTool`
(`agentPermissions.service.ts:84-149`). El segundo es la garantía.

| Tool | AUTOMOTORA | CLINICA | Notas |
|---|---|---|---|
| `get_service_types` | ✅ | ✅ | Con los profesionales de cada prestación (§4.3). |
| `get_availability` | ✅ | ✅ | Sin profesional: todos los que hacen la prestación. |
| `create_booking` | ✅ | ✅ | `resourceId` opcional; si falta, lo elige el service. |
| **`get_contact_bookings`** (nueva) | ✅ | ✅ | Los turnos futuros `CONFIRMED` del contacto de la conversación. Sin argumentos de contacto: sale de la conversación. |
| **`reschedule_booking`** (nueva) | ✅ | ✅ | Sobre §4.7. Solo turnos del contacto de la conversación. |
| **`cancel_booking`** (nueva) | ✅ | ✅ | Sobre `cancelBooking`. Ídem. |
| `get_contact_info`, `get_contact_activities` | ✅ | ✅ | |
| `create_lead`, `update_lead` | ✅ | ✅ **acotadas** | En CLINICA sin `notes` ni `aiData` (texto libre): ver §8.2. |
| `update_contact_custom_fields` | ✅ | ✅ | |
| `mark_no_interest` | ✅ | ✅ | |
| `get_payment_info` | ✅ | ❌ recomendado | Devuelve un link de pago (`Branch.paymentLinkUrl`). R7 dice "solo informa, sin cobrar". Precios, medios de pago y mutualistas van a la base de conocimiento. |
| `create_opportunity`, `update_opportunity` | ✅ | ❌ | §2.1, opción A. |
| `search_vehicles`, `reserve_vehicle` | ✅ | ❌ | |
| `request_human_handoff` | siempre | siempre | |

Reglas de las tres tools nuevas, en el backend:

- El turno tiene que ser del **contacto de la conversación**. Un `bookingId` de
  otro contacto devuelve el mismo error que uno que no existe (sin oráculo).
- Pasan por el **candado de identidad** (`bloqueoPorIdentidad`,
  `agentTools.service.ts:175-184`), igual que `create_booking`.
- **Anticipación mínima (P10):** `Branch.minHoursToChangeBooking` (nullable).
  Si el turno empieza antes de ese plazo, la tool no cancela ni reprograma:
  devuelve `{ ok: false }` y el agente deriva. La política de cancelación es
  de la clínica; el agente no la negocia.
- El tope `MAX_RESERVAS_FUTURAS_POR_CONTACTO = 2` (`agentTools.service.ts:192`)
  sigue igual. Reprogramar no lo consume.

Las tres tools nuevas sirven también para una automotora (un test drive se
reprograma igual). No hay motivo para limitarlas a CLINICA.

### 5.2 Agendar con los niveles de IA (⚠ ediciones)

**El choque.** En ediciones §4.2 (c), PRIMER_CONTACTO **prohíbe**
`create_booking`, porque "compromete algo" (reserva un turno). Para una clínica,
agendar es el núcleo. Además PRIMER_CONTACTO tiene un tope de **2 respuestas**
(D12), y agendar un turno lleva entre 3 y 5 (prestación, día, horario, nombre,
confirmación). Aunque se permitiera la tool, el tope la dejaría sin efecto.

**Este documento no cambia ediciones.** Las opciones son para Rocco (P2):

| Opción | Qué implica | Toca ediciones | Riesgo |
|---|---|---|---|
| **A. AUTONOMA con el catálogo del rubro (recomendada para la v1)** | La clínica usa AUTONOMA. El rubro ya le saca las tools que no aplican (§5.1), y los guardrails de salud (§5.3) valen en **todos** los niveles. PRIMER_CONTACTO queda como está: en una clínica significa "toma los datos y recepción agenda". | No | Bajo. Es la configuración de hoy más filtros. |
| B. Nivel nuevo `AGENDA` | Un cuarto valor del enum: el agente solo hace turnos (tools de agenda, contacto, derivar) y deriva todo lo demás. Sin tope de 2. | **Sí**: un valor nuevo de `AgentParticipation` y su fila en las tablas de §4.3 y §6.1. Migración (agregar un valor al enum). | Medio. Es el más claro para el cliente que "quiere poca IA, pero que agende". |
| C. Excepción por rubro en PRIMER_CONTACTO | En CLINICA, PRIMER_CONTACTO permite las tools de turnos y no tiene tope. | **Sí**: rompe la garantía de §4.3 ("acciones que comprometen: No") y hace que un mismo nivel signifique cosas distintas según el rubro. | Alto para el modelo mental. **No recomendada.** |

Con A, la elección del nivel sigue siendo del ADMIN y obligatoria en ESENCIAL
(D3). Lo que se agrega es la ayuda del formulario: en CLINICA, la línea de
PRIMER_CONTACTO dice "no agenda turnos: toma los datos y pasa a recepción".

**SOLO_SEGUIMIENTO** en una clínica: el agente no conversa. Los recordatorios
y la confirmación por botón **siguen funcionando**, porque no usan el modelo
(§6). Esa es una configuración razonable para una clínica que no quiere IA.

### 5.3 Guardrails de salud, en el backend

**Regla:** en CLINICA, en **todos** los niveles y **todos** los canales
(incluido el widget web), el agente no da historia clínica, diagnósticos ni
consejos médicos. Lo hace cumplir el backend en tres capas. **Ninguna es
configurable por el ADMIN**: es una propiedad del rubro, como la restricción de
Meta del catálogo de tools (`docs/ai-agent-architecture.md` §6).

#### Capa 1: antes del modelo (entrante)

Un detector **determinístico** sobre el texto del paciente, en
`src/services/guardrailsDeSalud.ts`, puro y sin red. Corre en
`responderEnLaConversacion` **antes** de llamar al proveedor, en el mismo
lugar donde ediciones pone el gate de horario.

| Resultado | Qué hace | Ejemplos (no exhaustivos) |
|---|---|---|
| `URGENCIA` | Responde el **mensaje fijo de urgencia** y deriva con motivo `URGENCIA_DE_SALUD`. **No llama al modelo.** La tarea de derivación sale con prioridad alta. | "no puedo respirar", "se me hinchó la cara/la lengua/los labios", "dolor en el pecho", "me desmayé", "sangra mucho", "convulsión", ideas de hacerse daño |
| `CLINICA` | Responde el **mensaje fijo de derivación clínica** y deriva con motivo `CONSULTA_CLINICA`. **No llama al modelo.** | Síntomas o reacciones ("me salió", "me arde", "me quedó rojo", "se infectó", "me pica"), medicación ("¿puedo tomar…?", "¿qué crema me pongo?"), "¿es normal que…?", embarazo o lactancia, diagnóstico ("¿qué tengo?", "¿esto es…?") |
| `NINGUNO` | Sigue el loop normal. | "¿cuánto sale la limpieza facial?", "quiero un turno el martes" |

- **Normalización** antes de comparar: minúsculas, sin tildes, sin signos,
  espacios colapsados y repeticiones de letras reducidas ("ardeeee").
- **Lista de términos en código**, no en la base: cambiarla es un PR con
  tests. La lista final la revisa una persona del área de salud antes del
  primer cliente (§10).
- **Un falso positivo es aceptable; un falso negativo no.** Si "me arde"
  aparece en "me arde la ilusión de ir", el peor caso es que una persona
  responda una pregunta de turnos. Esa asimetría justifica una lista amplia.
- **La urgencia gana** sobre todo lo demás: sobre `humanoAtiendeLaConversacion`
  (si hay una persona atendiendo, el mensaje fijo sale igual), sobre el horario
  y sobre el nivel. Con SOLO_SEGUIMIENTO o con el agente apagado,
  `derivarEntranteSinAgente` también mira la urgencia y manda el mensaje fijo.
  No es una respuesta de IA: es un texto fijo de seguridad.
- **Después de una derivación clínica, el agente calla en esa conversación**
  hasta que una persona la devuelva (`return-to-agent`). Es la misma función
  que ediciones usa para PRIMER_CONTACTO (`humanoAtiendeLaConversacion` con
  solo el status), activada por el motivo. Así no sigue la charla después de un
  síntoma.

#### Capa 2: el prompt

Una instrucción fija del rubro (`INSTRUCCION_SALUD`): no diagnosticar, no
indicar tratamientos ni medicación, no interpretar síntomas, y llamar a
`request_human_handoff` con motivo clínico ante cualquier duda. Es la capa que
atrapa lo que el detector no conoce. **No es la garantía.**

#### Capa 3: después del modelo (saliente)

Un filtro sobre la respuesta, en la misma cadena que `revelaInstrucciones` y
`mencionaUnaTool` (`agentOrchestration.service.ts:2391-2448`):
`daIndicacionClinica(texto)`. Detecta dosis ("mg", "cada 8 horas"), verbos de
indicación sobre el cuerpo ("aplicate", "tomá", "suspendé", "no te
pongas"), y frases diagnósticas ("parece ser", "es normal que", "puede ser
una reacción"). Si da positivo, **la respuesta no sale**: se reemplaza por el
mensaje fijo de derivación clínica y se deriva. Se registra en
`Message.toolCalls` del turno, para auditar.

El mismo filtro corre sobre el texto libre del seguimiento de consultas
(`inquiryFollowUpDraft.service.ts`), si en CLINICA se permite (§9).

#### Mensajes fijos

Constantes en `src/config/rubros.ts`, con el nombre de la clínica como única
variable. Borradores:

- **Urgencia:** "Si es una urgencia, llamá ya al 911 o a tu servicio de
  emergencia móvil. Este chat no puede ayudarte con eso. Ya le avisamos al
  equipo de {clinica}."
- **Consulta clínica:** "Esa consulta la tiene que ver un profesional. Por acá
  no podemos darte indicaciones médicas. Ya le pasamos tu mensaje al equipo de
  {clinica} para que te contacte."

El texto exacto y el número de emergencias los valida la clínica y un
profesional (§10).

#### Lo que el detector no hace

- No guarda una etiqueta "síntoma X" en el contacto. La derivación dice
  "consulta clínica: ver la conversación" y nada más (§8.2).
- No usa un segundo modelo como clasificador en la v1. Es una opción para más
  adelante (P11), con su costo por mensaje.

#### Tests

- **Unitarios del detector:** una tabla de frases positivas y negativas por
  categoría, con tildes, sin tildes, con errores de tipeo y con letras
  repetidas. Un caso por cada término de la lista: si alguien borra un término,
  falla su caso.
- **Unitarios del filtro saliente:** respuestas con dosis o indicaciones se
  bloquean; respuestas de turnos y precios pasan.
- **Loop:** con un proveedor falso que falla si lo llaman, verificar que
  `URGENCIA` y `CLINICA` no lo llaman, que la conversación queda derivada con
  el motivo, que el mensaje fijo es exactamente la constante, y que el turno
  siguiente sigue callado. Igual por el widget web.
- **Composición:** `URGENCIA` con SOLO_SEGUIMIENTO, con el agente inactivo y con
  una persona atendiendo. En AUTOMOTORA el detector **no corre** (no cambia
  nada de hoy).

### 5.4 Indicaciones antes y después de un tratamiento (P5)

"¿Tengo que ir sin maquillaje?" o "¿puedo tomar sol después del láser?" son
preguntas frecuentes, y la clínica suele tener las respuestas por escrito.

| Opción | Qué hace | A favor | En contra |
|---|---|---|---|
| **A. Responder solo desde la base de conocimiento (recomendada)** | Entradas con un tipo nuevo `INDICACIONES` ("Antes de la depilación láser"), cargadas por la clínica. El agente puede **transcribirlas**, sin agregar ni interpretar. Si la pregunta trae un síntoma o un "¿es normal?", la capa 1 la deriva antes de llegar al modelo. | Descarga a recepción de lo más repetido. Lo dice la clínica, no la IA. | El modelo podría parafrasear de más. La capa 3 es la red. |
| B. Derivar siempre | Toda pregunta de cuidados va a una persona. | Lo más seguro. | Recepción contesta lo mismo veinte veces por día. |

Con A, la columna nueva es `KnowledgeBaseEntry.kind` (`GENERAL` \|
`INDICACIONES`), con migración. El prompt pone las de `INDICACIONES` en un bloque
aparte, con la instrucción "transcribí, no expliques". La pantalla de la base
de conocimiento avisa: "Lo que cargues acá lo puede repetir el agente
textualmente".

### 5.5 Precios, medios de pago y mutualistas (R7)

Van a la base de conocimiento como entradas normales. El agente informa lo que
está cargado y, si no está, dice que lo consulte con recepción. No hay tool de
cobro ni de seña. Cobertura de mutualistas: solo si hay una entrada; si no, "eso
lo confirma recepción". La instrucción ya existe en espíritu
(`INSTRUCCION_SOLO_LO_QUE_TE_CONSTA`); su versión de rubro (§3.2) nombra
precios, coberturas y medios de pago.

### 5.6 Test drive

No es una entidad. Lo único que hay que tocar son los ejemplos en las
descripciones de las tools y el texto por defecto del seguimiento de consultas
(`automationActions/inquiryFollowUp.ts:61`). Pasan a salir de
`textosDelRubro` (§3.2).

---

## 6. Recordatorios y confirmación (R8)

### 6.1 Modelo

```prisma
enum BookingReminderKind {
  REMINDER_24H  // §6
  CONTROL       // §7.2
}

enum BookingReminderStatus {
  PENDING
  SENT
  FAILED
  CANCELLED
}

model BookingReminder {
  id             String
  organizationId String
  bookingId      String   // del turno que se recuerda (en CONTROL, el turno atendido)
  contactId      String
  kind           BookingReminderKind
  scheduledFor   DateTime
  status         BookingReminderStatus @default(PENDING)
  attempts       Int      @default(0)
  nextAttemptAt  DateTime?
  lastError      String?
  sentAt         DateTime?
  externalMessageId String?            // wamid, para cruzar la respuesta
  // único: (bookingId, kind) mientras esté PENDING o SENT
}

model Booking {
  // ...
  patientConfirmedAt DateTime? // el paciente tocó "Confirmo"
}
```

- **"Confirmado por el paciente" no es un estado nuevo.** `CONFIRMED` ya
  significa "turno dado" y toda la capacidad cuenta sobre él. Un estado nuevo
  obligaría a revisar cada consulta de capacidad. Una columna con la fecha
  alcanza y no toca nada.
- La tabla es **una fila de cola**, con el patrón de `QrFollowUp` (reclamar,
  reintentar, cancelar). Es tabla nueva: lleva RLS, H-01, fila 5 del
  diagnóstico y una FK a `contacts` (inventario de `contactMerge`), según el
  checklist de tablas nuevas.

### 6.2 Cuándo se agenda

- Handler de `booking.created` y `booking.rescheduled`: si el turno empieza en
  **más de 24 h**, agenda `REMINDER_24H` para `startsAt − 24 h`. Al
  reprogramar, el pendiente se mueve.
- **Turno dado con menos de 24 h (P8):** no se agenda recordatorio. La
  confirmación del turno se acaba de dar en esa conversación.
- `booking.cancelled` cancela los pendientes.
- **Al enviar**, el worker revalida: el turno sigue `CONFIRMED`, el horario es
  el mismo y el contacto tiene teléfono de WhatsApp. Si algo cambió, cancela
  la fila con el motivo.
- **Horario:** el recordatorio de las 24 h sale aunque la sucursal esté
  cerrada (un turno de las 8:00 se recuerda a las 8:00 del día anterior). No se
  usa la postergación por horario de los seguimientos de consultas: un
  recordatorio tarde es peor que uno temprano.
- **Canal:** solo WhatsApp en la v1. Sin WhatsApp conectado o sin teléfono, no
  hay recordatorio y el turno muestra "sin recordatorio".

### 6.3 La plantilla

**Categoría: `UTILITY`.** Meta clasifica como utility los mensajes que no
tienen intención promocional y son específicos de una transacción o un pedido
del usuario. Un recordatorio de un turno que el paciente pidió encaja. Un mensaje
que mezcla contenido utilitario con promoción pasa a ser `MARKETING`, y Meta
puede recategorizar a marketing una plantilla utility ya aprobada. Según
fuentes secundarias, desde abril de 2025 una plantilla utility que Meta
considera promocional se **aprueba como marketing** (y se cobra como tal) en
lugar de rechazarse. Por eso:

- **La plantilla no lleva nada más que el turno**: ni ofertas, ni "aprovechá",
  ni "agendá también…".
- **No lleva el nombre de la prestación por defecto.** "Tu turno de control de
  lunares" es un dato de salud en un mensaje que puede leer cualquiera que vea
  la pantalla del teléfono. La variable existe y la clínica la puede activar.
  Ver también la regla de Meta sobre información de salud en §6.6.
- Borrador: "Hola {nombre}, te recordamos tu turno en {clinica} el {dia} a las
  {hora} con {profesional}. ¿Nos confirmás si venís?". Botones: **Confirmo** /
  **Necesito cancelar**.

**Lo que hay que construir para las plantillas** (hoy no existe):

| Pieza | Hoy | Falta |
|---|---|---|
| Categoría `UTILITY` | El tipo existe (`whatsappGraph.service.ts:289`), pero las tres acciones usan `MARKETING` (`whatsappTemplate.service.ts:231-235`) | La acción del recordatorio declara `UTILITY`. |
| Botones de respuesta rápida | `cuerpoDeAltaDePlantilla` solo arma HEADER y BODY (`whatsappGraph.service.ts:324-355`) | Componente `BUTTONS` con dos `QUICK_REPLY` con **payload fijo** (`CONFIRMAR`, `CANCELAR`). |
| Leer la respuesta del botón | Se lee el **texto** del botón y se pasa al agente como si lo hubiera escrito el cliente (`whatsappWebhook.service.ts:163-167`, `263-274`) | Leer el **payload**. Con un payload conocido, el webhook **no** pasa por el agente (§6.4). |
| Plantilla por regla de automatización | `WhatsappTemplate.automationId` (`schema.prisma:3382-3420`) | La plantilla del recordatorio cuelga de una regla de automatización del trigger nuevo `booking.reminder_due`. Así reusa la pantalla de la regla (`MensajeDeWhatsappCard.tsx`) y la sincronización con Meta, sin una pantalla de plantillas aparte. |
| Idioma | `es_AR` por defecto (`whatsappTemplate.service.ts:279`) | Sin cambios; verificar con el primer cliente si conviene `es`. |

**Costo:** una fuente secundaria (no de Meta) indica que desde el 1 de octubre
de 2026 cambian las reglas de cobro de las plantillas utility enviadas dentro
de la ventana de servicio. No se verificó en la documentación de Meta. Antes de
fijar el precio para una clínica hay que confirmar la tarifa vigente para
Uruguay.

### 6.4 Qué pasa con la respuesta

| Respuesta del paciente | Qué hace el backend | ¿Usa el modelo? |
|---|---|---|
| Botón **Confirmo** | `patientConfirmedAt = now()`. Responde un texto fijo ("¡Gracias! Te esperamos"). Nota en el contacto. | No |
| Botón **Necesito cancelar** | `cancelBooking` (el mismo de la API), responde un texto fijo que ofrece reprogramar y crea una tarea para recepción ("{paciente} canceló el turno de mañana a las {hora}"). Respeta la anticipación mínima (§5.1): dentro del plazo, no cancela y deriva. | No |
| Texto libre ("¿lo puedo pasar al jueves?") | Entra al loop normal, **con el turno en contexto** (el bloque de datos del CRM lista los turnos futuros). Lo que pase depende del nivel (§5.2) y los guardrails de salud corren igual. | Según el nivel |
| Nada | Ver §6.5. | No |

- El payload se cruza con el **turno del recordatorio**, no con "el próximo
  turno del contacto": el webhook busca la fila `BookingReminder` por el
  `context.id` del mensaje de Meta (el wamid del recordatorio que se está
  respondiendo), guardado en `externalMessageId`. Si no lo encuentra, trata la
  respuesta como texto libre.
- **Ventana de 24 h:** la respuesta del paciente abre la ventana de servicio,
  así que los textos fijos de respuesta son mensajes libres dentro de la
  ventana. No hace falta otra plantilla.
- Todo esto funciona con **cualquier nivel de IA**, incluido SOLO_SEGUIMIENTO,
  y con el agente apagado: no hay modelo de por medio.

### 6.5 Si no responde: tarea y aviso a recepción

- `HORAS_SIN_RESPUESTA` después de enviado (propuesta: 4 h, o 2 h antes del
  turno si eso es antes), sin `patientConfirmedAt` ni cancelación → se crea una
  **tarea** "Confirmar por teléfono el turno de {paciente} de mañana a las
  {hora}".
- **El turno no se cancela** (R8).
- **"Recepción" no existe en el código.** Las tareas de hoy van al asignado de
  la conversación, al dueño del contacto o al ADMIN más antiguo
  (`avisoSinRespuesta.service.ts:197`). Propuesta (P15): reusar
  `Branch.defaultOwnerId` ("Responsable por defecto" en CLINICA, §3.1) como
  destinatario, con el ADMIN más antiguo como respaldo. No se crea un rol nuevo.
- **"Aviso":** no hay un modelo de notificaciones. Como en el resto del
  sistema, la tarea **es** el aviso (ver `docs/ai-agent-architecture.md` §6).
  El calendario muestra además el turno con la marca "sin confirmar".
- Una sola tarea por turno. Si el paciente confirma después, la tarea se cierra
  sola, con la misma idea que `findTareaAbiertaDelPedido` (`tareaDelPedido.ts:45`).

### 6.6 Políticas de Meta: lo que hay que verificar antes del primer cliente

Leído en la política de mensajería de WhatsApp Business (actualizada el
2026-09-23) y en la guía de categorías de plantillas. **No es una
interpretación legal**: es la lista de lo que hay que confirmar con Meta o con
el proveedor (BSP) antes de conectar el número de una clínica.

1. **"Medical and healthcare products"** figura en la lista de bienes y
   servicios que no se pueden comprar, vender, promocionar ni facilitar por
   WhatsApp. La política no aclara si alcanza a los **servicios** de una clínica
   de estética o solo a productos médicos. Hay que confirmarlo. Es el riesgo
   más grande para el rubro: si alcanza, el canal WhatsApp no sirve para
   clínicas.
2. **Información de salud:** la política dice que no se use WhatsApp para
   telemedicina ni para enviar o pedir información de salud **cuando las
   normas aplicables prohíban distribuirla** a sistemas sin requisitos
   reforzados. La minimización de §8 (sin prestación en la plantilla, sin
   motivo clínico, derivación sin resumen) va en esa dirección. Hay que
   confirmar qué exige la normativa uruguaya (§10).
3. **Opt-in:** se necesita el teléfono **y** el permiso del destinatario para
   escribirle. Las buenas prácticas de Meta piden opt-ins separados por tipo de
   mensaje. El aviso del primer contacto (§8.1) es el lugar natural para pedirlo.
4. **Salida a una persona:** la política exige un camino claro para hablar con
   una persona. Ya existe (`request_human_handoff`, responder desde el CRM).
5. **Categorías:** recordatorio = utility; pedido de reseña de una visita
   concreta = podría ser utility, pero el código usa marketing y conviene
   seguir así; "agendá tu próximo control" = marketing (§7.2). Un paciente que
   apagó los mensajes de marketing **no recibe** el recordatorio de control,
   pero sí el de 24 h.

---

## 7. Después del turno (R9)

### 7.1 QR de reseña con "turno atendido"

Hoy el QR depende 100% de `opportunity.won` (ediciones §3): la acción solo
admite ese trigger, `QrFollowUp.opportunityId` es NOT NULL y el worker cancela si
la oportunidad dejó de estar WON (`qrFollowUpWorker.ts:204-206`).

**Propuesta:** trigger nuevo `booking.completed` ("Cuando se atiende un turno")
y la **misma** acción `opportunity.send_qr_followup`, que pasa a admitir los dos
triggers.

- **Migración:** `QrFollowUp.opportunityId` pasa a nullable, se agrega
  `bookingId` nullable y un CHECK de que va **exactamente uno** de los dos.
  Igual en `DiscountVoucherFollowUp`, si el cupón también se usa en clínicas.
- **Worker:** la revalidación mira lo que corresponda. Con `bookingId`, el turno
  tiene que seguir `COMPLETED`; un turno marcado "No vino" después del cierre
  automático cancela el envío.
- Con el cierre automático (§4.8), conviene que la demora mínima del QR en
  CLINICA sea de unas horas, para dar tiempo a corregir un "No vino".
- **⚠ ediciones:** ediciones §3 descartó la opción B (`opportunityId` nullable)
  **para ESENCIAL automotriz**, porque duplicaba la definición de venta. Acá no
  hay duplicación: en CLINICA no hay oportunidades (§2.1) y el turno es el único
  disparador. La automotora sigue con `opportunity.won`. No contradice ediciones,
  pero toca las mismas tablas: lo anoto para que Rocco lo vea.
- El catálogo de automatizaciones por rubro (ediciones §8) muestra
  `booking.completed` en CLINICA y oculta `opportunity.won` y
  `opportunity.stale`.

### 7.2 Recordatorio de control

```prisma
model ServiceType {
  // ...
  followUpAfterDays Int? // "Recordar control a los N días". null = sin control
}
```

- Handler de `booking.completed`: si la prestación tiene `followUpAfterDays`,
  agenda un `BookingReminder` `CONTROL` para `completedAt + N días`, a una hora
  dentro del horario de la sucursal.
- **Al enviar**, el worker cancela si el paciente **ya tiene un turno futuro**
  de esa prestación, si está marcado "sin interés" (`Contact.noInterestAt`) o si
  el turno de origen pasó a `NO_SHOW`.
- **Plantilla `MARKETING`** (§6.6, punto 5), con un texto sin dato clínico:
  "Hola {nombre}, ya pasaron {semanas} semanas desde tu último turno en
  {clinica}. Si querés agendar el próximo, escribinos por acá."
- La respuesta entra al loop normal, que puede agendar (según el nivel).
- No tiene botones en la v1.

---

## 8. Consentimiento y privacidad

### 8.1 Aviso en el primer contacto

- `Organization.privacyNoticeText` (texto corto) y `privacyPolicyUrl`, cargados
  por el ADMIN. Obligatorios para **activar** un agente en CLINICA (mismo
  patrón que "Nivel sin elegir" de ediciones §1.2: se puede guardar, no
  activar).
- Se manda **una vez por contacto**, antes de la primera respuesta del agente,
  como un mensaje aparte. Se guarda `Contact.privacyNoticeSentAt`.
- Si el primer mensaje del paciente cae en `URGENCIA`, primero va el mensaje de
  urgencia. El aviso espera al siguiente turno.
- El aviso **informa** (qué datos, para qué, cómo pedir la baja). Si además hace
  falta un **consentimiento expreso** para tratar datos de salud, y cómo se
  registra, es una pregunta para el profesional legal (§10). El diseño deja
  lugar para un `Contact.privacyConsentAt` sin construirlo antes de esa
  respuesta.

### 8.2 Qué datos se guardan y dónde

| Dato | Dónde | Clínica |
|---|---|---|
| Nombre, teléfono, email | `Contact` | Sí (mínimo de R11) |
| Prestación de interés | `Contact.leadServiceOfInterest` | Sí |
| Turno (prestación, profesional, fecha) | `Booking` | Sí |
| Motivo clínico, síntomas | **Ningún campo** | No, por defecto (R11) |
| Lo que el paciente escribe | `Message.content` | Inevitable: es la transcripción |

Lo que hay que cerrar para que el "sin motivo clínico" sea real:

- **`update_lead` sin texto libre en CLINICA.** Hoy `qualifyLead` agrega
  `leadNotes` y mezcla `leadAiData` (`docs/ai-agent-architecture.md`, nota del
  paso 3). El modelo podría escribir ahí "tiene acné severo". En CLINICA el
  schema de la tool del rubro no ofrece esos dos argumentos.
- **Derivación sin resumen.** La tarea de derivación (`crearActivityDeAviso`,
  `agentOrchestration.service.ts:1562`) lleva un brief armado por la IA. Con
  motivo `CONSULTA_CLINICA` o `URGENCIA_DE_SALUD`, el asunto y el cuerpo son
  **fijos** ("Consulta clínica: ver la conversación").
- **`Booking` no tiene notas** (`schema.prisma:2277-2344`), y no se le agregan.
- **Campos personalizados:** la pantalla de campos de contacto en CLINICA avisa
  que no se carguen datos de salud. No se puede impedir del todo (es texto libre
  del ADMIN); queda escrito como límite.
- **`docs/data-classification.md`:** `Message.content` y el texto libre de
  `Activity` de una organización CLINICA pasan a ser **Regulated por
  naturaleza**, no solo por jurisdicción (§1 de ese documento ya prevé el caso
  de un campo de salud). Se actualiza en el PR de los guardrails.

### 8.3 Terceros que reciben mensajes

Cada mensaje que el agente procesa va al proveedor de LLM (hoy vía OpenRouter,
`docs/ai-agent-architecture.md` §10) y la base está en Supabase. Con datos de
salud, eso es un **tercero que recibe datos sensibles** y, según dónde procese,
una **transferencia internacional**. `data-classification.md` §4 dice hoy
"Compartir con terceros: no aplica". Para CLINICA eso deja de ser cierto. Va a
la lista de §10.

---

## 9. Seguimientos (#446) y niveles de IA en un rubro de turnos

### 9.1 El seguimiento de consultas estancadas

Hoy (`inquiryFollowUp.repository.ts:58-126`) elige contactos cuya última
consulta quedó sin respuesta y **sin oportunidad OPEN**. No mira los turnos.

En una clínica sin oportunidades (§2.1), eso le escribiría "¿seguís
interesado?" a un paciente que **ya tiene un turno** para el jueves. Cambios:

1. **Filtro nuevo para los dos rubros:** se excluye el contacto con un turno
   `CONFIRMED` futuro o atendido en los últimos `daysSinceLastMessage` días. En
   la barrida, en la acción y en el worker antes de enviar (los mismos tres
   lugares donde hoy se mira la oportunidad). También corrige el caso de una
   automotora con un test drive agendado.
2. **Texto por defecto y variables por rubro:** hoy el texto menciona el test
   drive (`inquiryFollowUp.ts:61`) y la variable `{vehiculo}` usa "el vehículo
   que consultaste" como respaldo (`:123-134`). En CLINICA la variable es
   `{prestacion}` (de `leadServiceOfInterest`), con el respaldo "lo que
   consultaste".
3. **Texto libre de la IA en CLINICA (P7):** D9 permite texto libre solo con un
   agente AUTONOMA activo. En CLINICA se propone **siempre la plantilla**,
   también en AUTONOMA. Un mensaje no pedido, redactado por la IA, a alguien
   que preguntó por un tratamiento es el caso más sensible del sistema. Es más
   estricto que D9 y lo compone (es "el lado de menos IA"); no lo contradice.
   Si Rocco prefiere mantener D9 tal cual, el filtro de la capa 3 (§5.3) corre
   sobre ese texto.

### 9.2 Qué hace cada nivel con lo nuevo

| Pieza | AUTONOMA | PRIMER_CONTACTO | SOLO_SEGUIMIENTO | Sin nivel / inactivo |
|---|---|---|---|---|
| Agendar, reprogramar, cancelar por chat | ✅ | ❌ (deriva; P2) | ❌ | ❌ |
| Guardrails de salud (capas 1 y 3) | ✅ | ✅ | La urgencia sí (texto fijo) | La urgencia sí |
| Recordatorio 24 h y botones | ✅ | ✅ | ✅ | ✅ |
| Texto libre como respuesta al recordatorio | Agente | Agente (2 respuestas) | Deriva | Deriva |
| QR después del turno | ✅ | ✅ | ✅ | ✅ |
| Recordatorio de control | ✅ | ✅ | ✅ | ✅ |
| Seguimiento de consultas | Plantilla (P7) | Plantilla (D9) | Plantilla (D9) | Plantilla (D9) |

La regla de fondo: **lo que no usa el modelo no depende del nivel.** El nivel
regula cuánto conversa la IA, no si el sistema manda un recordatorio con
plantilla aprobada.

`agent.draft_follow_up` y `opportunity.stale` no aplican en CLINICA (no hay
oportunidades).

---

## 10. Ley 18.331 (URCDP): puntos a verificar con un profesional

**Esto no es asesoramiento legal.** Es la lista de preguntas que hay que llevarle
a un profesional con competencia en protección de datos y en normativa sanitaria
uruguaya **antes del primer cliente real**. Ninguna se responde acá ni se
completa con un valor razonable, mismo criterio que `data-classification.md`
§6.1.

1. **Datos sensibles.** ¿Qué de lo que guarda el sistema es dato de salud en el
   sentido de la ley? ¿Lo es la prestación de un turno de estética? ¿Lo es el
   texto que el paciente escribe en el chat?
2. **Consentimiento.** ¿Alcanza un aviso informativo en el chat, o hace falta un
   consentimiento expreso (y en qué forma) para tratar datos de salud? ¿Cómo se
   registra y se prueba?
3. **Roles.** ¿La clínica es responsable de la base y la plataforma es
   encargada del tratamiento? ¿Qué contrato hace falta entre las dos? ¿Qué
   tiene que decir sobre los subencargados (Supabase, el proveedor de LLM,
   Meta, Google)?
4. **Inscripción de la base** ante la URCDP: ¿la hace la clínica, la plataforma,
   las dos?
5. **Transferencia internacional.** La base, el LLM, Meta y Google procesan
   fuera de Uruguay. ¿Qué requisitos aplican y qué hay que firmar o informar?
6. **Proveedor de LLM.** ¿Puede recibir mensajes con datos de salud? ¿Hace falta
   un proveedor que no retenga ni entrene con los datos, y cómo se acredita?
7. **Conservación.** ¿Cuánto tiempo se pueden guardar las conversaciones y los
   turnos? Hoy el CRM no tiene retención (`data-classification.md` §5.1).
8. **Derechos del titular** (acceso, rectificación, supresión, oposición):
   plazos y forma. Hoy acceso y oposición no están soportados mecánicamente
   (`data-classification.md` §5.3).
9. **Historia clínica.** ¿Algo de lo que guarda el CRM (turnos, prestaciones,
   conversaciones) podría considerarse parte de la historia clínica, con las
   obligaciones que eso trae? El diseño apunta a que no, y conviene confirmarlo.
10. **Mensajes fijos.** El texto de urgencia (incluido el número) y el de
    derivación clínica: ¿los valida la clínica, su director técnico, un
    profesional de salud?
11. **Recordatorios.** ¿Puede un recordatorio por WhatsApp nombrar la
    prestación? ¿Y el profesional?
12. **Menores de edad.** ¿Qué pasa si escribe o agenda un menor? Hoy el sistema
    no pregunta la edad.
13. **Políticas de Meta** (§6.6): confirmar con Meta o con el BSP que una clínica
    de estética puede usar WhatsApp Business para turnos.
14. **Seguridad.** ¿Qué medidas exige la ley para datos sensibles, y alcanza con
    lo de `data-classification.md` §4 (cifrado por la infraestructura, control
    de acceso, registro de accesos parcial)?

El resultado de esa consulta va a `docs-privados/` si tiene datos de un cliente,
y las decisiones de diseño que salgan vuelven a este documento.

---

## 11. Clínica Demo

Una organización de demostración para mostrarle el producto a una clínica, con
datos inventados. **No se usa AutoMax** ni ningún dato real.

### 11.1 Cómo se crea

- **Plataforma → Nueva organización**, con rubro CLINICA, y una casilla
  **"Cargar datos de ejemplo"** (solo para el platform admin).
- Detrás, `POST /api/admin/organizations/:organizationId/demo-data`
  (`requirePlatformAdmin`), que llama a `cargarDatosDeEjemplo(organizationId)`.
  También sirve para cargarlos después del alta.
- **Solo si la organización no tiene contactos ni turnos** (409 si tiene). Nunca
  mezcla datos de ejemplo con datos reales.
- Usa **los services** (no Prisma directo), en este orden, para que los datos
  pasen por las mismas validaciones que los de un cliente.
- La organización de demo se marca con un slug `clinica-demo-*`. Se suma a la
  lista de organizaciones protegidas de `purge-test-organizations.ts` solo si se
  decide conservarla; si no, a `PATRONES_DE_SLUG_DE_PRUEBA` para poder
  limpiarla. Ver P14.

### 11.2 Qué datos lleva (todos inventados)

| Qué | Ejemplo |
|---|---|
| Organización | "Clínica Demo", ESENCIAL, CLINICA, `contactTerm = PACIENTE`, zona `America/Montevideo` |
| Sucursal | "Sede Centro", horario de lunes a viernes de 9 a 19 y sábados de 9 a 13 |
| Profesionales | "Dra. Lucía Ejemplo" (dermatología), "Lic. Martina Prueba" (cosmetología), "Lic. Sofía Muestra" (cosmetología) |
| Prestaciones | Consulta dermatológica (30 min, control a los 180 días) · Limpieza facial (60 min, control a los 30 días, la hacen las dos licenciadas) · Depilación láser (45 min, control a los 30 días) · Peeling químico (45 min) |
| Bloqueo | La Dra. Ejemplo no atiende el próximo viernes a la tarde |
| Base de conocimiento | Horarios · Cómo llegar · Precios de ejemplo · Medios de pago · Coberturas: "No trabajamos con mutualistas" · Política de cancelación · Indicaciones antes de la depilación láser (genéricas, con la aclaración "texto de ejemplo") |
| Pacientes | 8 contactos con nombres de fantasía, emails `@example.com` y **sin teléfono** (un teléfono inventado puede existir) |
| Turnos | Unos 15 en la semana siguiente, algunos con `patientConfirmedAt`, uno sobreturno, y 3 ya atendidos la semana anterior |
| Agente | "Recepción virtual", **inactivo y sin nivel** (D3: el nivel lo elige el ADMIN). Instrucciones de ejemplo cargadas. |
| Automatizaciones | Recordatorio 24 h, QR al atender y control, **inactivas**: las plantillas de Meta no se aprueban solas. |

---

## 12. Tests

1. **Catálogo** (`src/config/ediciones.test.ts`, el de ediciones §5.4):
   - toda ruta clasificada (sin cambios);
   - `modulosDe(e, AUTOMOTORA)` es igual a `MODULOS_POR_EDICION[e]` para las
     dos ediciones: el rubro no le quita nada a una automotora.
2. **Integración edición × rubro** (generalización de
   `ediciones.integration-test.ts`): cuatro organizaciones (ESENCIAL y COMPLETA,
   AUTOMOTORA y CLINICA), con slugs `rubros-{edicion}-{rubro}-{ts}` en
   `PATRONES_DE_SLUG_DE_PRUEBA`. Casos generados desde `modulosDe`: 403 donde el
   módulo falta, cualquier otra cosa donde está. Los 400 por campo
   (`vehicleOfInterestId`).
3. **Aislamiento:** cada tabla nueva (`ServiceTypeResource`, `ResourceTimeOff`,
   `BookingReminder`) entra al meta-test H-01 de
   `tenant-isolation.integration-test.ts`, con RLS
   (`rlsTodasLasTablas.test.ts`) y la fila 5 del diagnóstico. `BookingReminder`
   tiene FK a `contacts`: entra al inventario de `contactMerge`.
4. **Agenda:** varios profesionales por prestación, elección del profesional
   libre, sobreturno solo con el profesional habilitado y solo desde el panel,
   bloqueos en ofrecer y en aceptar (la misma función), reprogramar con dos
   reprogramaciones cruzadas en paralelo (sin deadlock), y Google como espejo
   (§4.6).
5. **Tools:** el filtro de cuatro términos para cada combinación, las tres tools
   nuevas con un turno de otro contacto (mismo error que inexistente), la
   anticipación mínima y "el catálogo tiene exactamente las N tools".
6. **Guardrails de salud:** §5.3.
7. **Recordatorios:** agenda y reprograma, cancela al cancelar, revalida antes de
   enviar, payload `CONFIRMAR` y `CANCELAR` sin llamar al modelo, cruce por el
   wamid, tarea por falta de respuesta (una sola), y funcionamiento con
   SOLO_SEGUIMIENTO.
8. **Post-turno:** `booking.completed` agenda el QR, un "No vino" posterior lo
   cancela, el CHECK de exactamente uno (`opportunityId` o `bookingId`), y el
   control se cancela si ya hay un turno futuro.
9. **Seguimiento de consultas:** un contacto con turno futuro no recibe
   seguimiento, en los dos rubros.

---

## 13. Plan de PRs

Los PR con 🗄 llevan migración y **quedan abiertos hasta que se autoricen a
mano**. Un PR por tema, cada uno con sus tests de aislamiento y su sección de la
guía de uso (regla de `docs/guia-de-uso/`).

**Dependencia con ediciones:** la migración de `industry` va **después** de que
se mergee y se despliegue el PR 2 de ediciones (#453, abierto hoy). El gate del
rubro va después del PR 3 de ediciones (`ediciones.ts` y `gateDeEdicion`), que
es el que crea el archivo que este diseño extiende. Ningún PR de este plan crea
su propio gate.

| # | PR | Migración | Riesgo | Contenido | Depende de |
|---|---|---|---|---|---|
| R0 | `docs: diseño de rubros (clínicas)` | — | Nulo | Este documento. | — |
| R1 | `feat(rubros): columnas industry y contactTerm` 🗄 | Sí | Bajo | `organizations.industry` (default `AUTOMOTORA`) y `contact_term` (default `CLIENTE`), sin backfill. Lo que pidan `verify:schema` y el diagnóstico. Ningún código las lee. | Ediciones PR 2 (#453) **mergeado y desplegado** |
| R2 | `feat(rubros): rubro en el catálogo y en el gate` | — | Medio | `MODULOS_POR_RUBRO`, `modulosDe`, `industry` y `contactTerm` en `AuthContext` y `/me`, `vocabulario` en `/me`, bloqueos por campo del rubro, tools del rubro en `toolsHabilitadas` y `puedeEjecutarTool`, `motivo` en el 403 (si P12 sale así), suite edición × rubro. | R1 aplicado, ediciones PR 3 |
| R3 | `feat(plataforma): elegir el rubro al crear` | — | Bajo | Selector en Nueva organización, `contactTerm = PACIENTE` en CLINICA, solo lectura en `/organization`, cambio de rubro solo sin datos (P1), guía §14. | R2, ediciones PR 4 |
| R4 | `feat(agente): guardrails de salud` | — | **Medio-alto** | §5.3 completo: detector, mensajes fijos, filtro saliente, silencio después de derivar, derivación sin resumen, `update_lead` acotada, actualización de `data-classification.md`. **Tiene que estar en producción antes de activar el agente de cualquier clínica.** | R2 |
| R5 | `feat(agenda): varios profesionales por prestación` 🗄 | Sí | Medio | `ServiceTypeResource` con relleno, disponibilidad y elección de profesional, `get_service_types` con profesionales, pantallas. | R2 |
| R6 | `feat(agenda): bloqueos y sobreturnos` 🗄 | Sí | Medio | `ResourceTimeOff`, `Resource.allowsOverbooking`, `Booking.isOverbooking`, pantallas. | R5 |
| R7 | `feat(agenda): Google como espejo con varios profesionales` | — | Bajo | §4.6 opción A (si P4 sale así). | R5 |
| R8 | `feat(agenda): reprogramar` | — | Medio | `PATCH .../reschedule`, `events.patch`, botón en el detalle del turno. | R5 |
| R9 | `feat(agenda): atendido, no vino y eventos del turno` 🗄 | Sí | Medio | `completedAt`, `completedBy`, rutas, cierre automático, eventos `booking.*` al outbox. | R8 |
| R10 | `feat(agente): tools de turnos` | — | Medio | `get_contact_bookings`, `reschedule_booking`, `cancel_booking`, `minHoursToChangeBooking` (🗄 si se agrega en este PR; si no, en R6), textos del rubro en el prompt (§3.2). | R8, R4 |
| R11 | `feat(automatizaciones): recordatorio de turno con confirmación` 🗄 | Sí | **Medio-alto** | `BookingReminder`, `patientConfirmedAt`, trigger `booking.reminder_due`, plantilla `UTILITY` con botones, payload en el webhook, tarea por falta de respuesta. | R9 |
| R12 | `feat(automatizaciones): QR y control después del turno` 🗄 | Sí | Medio | `QrFollowUp.bookingId` + CHECK, `ServiceType.followUpAfterDays`, trigger `booking.completed`, `CONTROL` en `BookingReminder`. | R11 |
| R13 | `feat(automatizaciones): seguimiento de consultas con turnos` | — | Bajo | Filtro por turno futuro (los dos rubros), texto y variables por rubro, regla de P7. | R9 |
| R14 | `feat(privacidad): aviso del primer contacto` 🗄 | Sí | Medio | `privacyNoticeText`, `privacyPolicyUrl`, `Contact.privacyNoticeSentAt`, requisito para activar un agente en CLINICA. | R2 |
| R15 | `feat(rubros): vocabulario y pantallas de clínica` | — | Medio | `useVocabulario`, menú, contactos, agenda, catálogo de automatizaciones por rubro, guía por rubro, test "no aparece 'cliente'". | R2 |
| R16 | `feat(plataforma): Clínica Demo` | — | Bajo | §11. | Todo lo anterior que se quiera mostrar |
| R17 | `feat(base de conocimiento): indicaciones` 🗄 | Sí | Bajo | `KnowledgeBaseEntry.kind` (si P5 sale A). | R4 |

**Orden:** R0 cuando sea. Después del despliegue de #453: R1 → (autorización y
aplicación) → R2 cuando esté ediciones PR 3 → R3 y R4 → R5 → R6, R7 y R8 →
R9 → R10, R11 y R13 → R12 → R14, R15 y R17 → R16.

**Antes del primer cliente real:** R4 y R14 desplegados, y la lista de §10
respondida por un profesional. Hasta R3 nadie puede crear una organización
CLINICA, así que todo lo anterior es inerte para las automotoras.

**Lo que se puede adelantar sin esperar a ediciones:** R8 (reprogramar), la
parte "para los dos rubros" de R13 y el arreglo de §4.6 no dependen del rubro.
Si conviene, se hacen antes.

---

## 14. Preguntas abiertas

| # | Pregunta | Opciones | Recomendada |
|---|---|---|---|
| P1 | ¿Se puede cambiar el rubro de una organización? | A. Solo el platform admin y solo sin datos de negocio (409 si hay). B. Nunca. C. Siempre, con advertencia. | **A** (§1.1). |
| P2 | **⚠ ediciones.** ¿Cómo agenda el agente en una clínica, si PRIMER_CONTACTO prohíbe `create_booking`? | A. AUTONOMA con el catálogo del rubro; PRIMER_CONTACTO no cambia. B. Nivel nuevo `AGENDA` (migración y cambio de ediciones §4). C. Excepción por rubro en PRIMER_CONTACTO. | **A** para la v1. B si un cliente pide "poca IA, pero que agende" (§5.2). |
| P3 | ¿Las clínicas tienen oportunidades? | A. Ocultas en CLINICA. B. La lista mínima de ESENCIAL. | **A** (§2.1). |
| P4 | Google Calendar con varios profesionales | A. Espejo, sin restar el `freebusy` en sucursales con más de un profesional. B. Un calendario por profesional. | **A** para la v1 (§4.6). |
| P5 | ¿Preguntas de cuidados antes y después de un tratamiento? | A. Transcribir desde la base de conocimiento (tipo `INDICACIONES`). B. Derivar siempre. | **A** (§5.4). |
| P6 | ¿Cómo se marca un turno como atendido? | A. Manual + cierre automático a las 3 h del fin. B. Solo manual. | **A** (§4.8). |
| P7 | Seguimiento de consultas con texto libre de IA en CLINICA | A. Siempre plantilla, también en AUTONOMA. B. D9 tal cual, con el filtro saliente de salud. | **A** (§9.1). |
| P8 | ¿Recordatorio para un turno dado con menos de 24 h? | A. No se manda. B. Se manda en el momento. C. Se manda unas horas antes. | **A** (§6.2). |
| P9 | ¿Puede el agente ofrecer sobreturnos? | A. No, solo el personal. B. Sí, si el profesional los permite. | **A** (§4.4). |
| P10 | ¿Cancelar y reprogramar desde el chat tiene un plazo mínimo? | A. Configurable por sucursal (`minHoursToChangeBooking`), sin valor por defecto: sin plazo, se permite siempre. B. Fijo en 24 h. C. Sin plazo. | **A** (§5.1). |
| P11 | Detector de síntomas y urgencias | A. Lista de términos en código (v1). B. A + un clasificador con un modelo. | **A** ahora; B si aparecen falsos negativos reales (§5.3). |
| P12 | **⚠ ediciones.** El 403 `MODULO_NO_INCLUIDO` dice "edición completa" | A. Campo aditivo `motivo: "EDICION" \| "RUBRO"`. B. Un código distinto (`MODULO_NO_INCLUIDO_EN_EL_RUBRO`). | **A**: no cambia el código de D10, solo agrega un dato (§1.2). |
| P13 | ¿Recordatorios de turno también para automotoras? | A. Sí, el módulo es de los dos rubros. B. Solo CLINICA en la v1. | **A**: un test drive se olvida igual. La automotora lo activa si quiere. |
| P14 | Clínica Demo | A. Endpoint del platform admin con datos de ejemplo. B. Script local. | **A** (§11). Conservarla o limpiarla: decide Rocco. |
| P15 | ¿Quién es "recepción"? | A. `Branch.defaultOwnerId` ("Responsable por defecto"), con el ADMIN más antiguo de respaldo. B. Un rol nuevo. | **A** (§6.5). |

### 14.1 Choques con `docs/ediciones.md`, juntos

1. **PRIMER_CONTACTO y `create_booking`** (P2). Este documento no cambia
   ediciones. La opción recomendada no lo toca.
2. **Texto del 403** (P12). Aditivo.
3. **`QrFollowUp.opportunityId` nullable** (§7.1). Ediciones §3 lo descartó para
   la automotora ESENCIAL. Acá se propone para el turno de una clínica, sin
   cambiar el disparador de la automotora. No es un choque de reglas, pero toca
   las mismas tablas.
4. **D9** (P7). La recomendación es más estricta que D9 solo en CLINICA. Lo
   compone, no lo contradice.
5. **Pipeline fijo de ESENCIAL** (ediciones §2.1). Se sigue creando en una
   clínica, invisible, para no bifurcar la transacción del alta. Ninguna regla
   cambia.
