# Rubros: AUTOMOTORA y CLINICA

> Documento de diseño. Estado: **decidido, sin código**. Fecha: 2026-10-09.
> Las preguntas abiertas se cerraron el mismo día en dos rondas y están en §16
> como decisiones: D1–D15 (primera ronda) y D16–D21 (segunda). No queda ninguna
> pregunta abierta (§17).
> Nada de lo descrito acá existe todavía. Las referencias `archivo:línea` son al
> código de `master` en el merge de #452 (`9876b16`) y sirven para ubicar dónde
> se tocaría. `src/config/ediciones.ts` todavía no existe: es el PR 3 de
> ediciones.
> Todos los nombres de personas, clínicas y prestaciones de este documento son
> inventados.
> **Numeración:** las decisiones de partida de Rocco son **B1–B11** (§0.2), las
> decisiones sobre las preguntas son **D1–D21** (§16) y los PR son **R0–R21**
> (§15). Las de `docs/ediciones.md` se citan como "ediciones D3".

## 0. Por qué

### 0.1 El pedido

La plataforma nació para automotoras. Los primeros clientes de un segundo rubro
van a ser **clínicas de estética y dermatología**. Una clínica no tiene stock de
vehículos, permutas ni test drive. Su núcleo es la **agenda**: turnos con
profesionales, recordatorios, confirmaciones y el control después del turno.
Además maneja un dato que una automotora no maneja: la **salud** de las
personas.

### 0.2 Punto de partida (Rocco, 2026-10-09)

| # | Decisión |
|---|---|
| B1 | **Misma plataforma**, no un proyecto aparte. |
| B2 | **Un rubro por organización** (`AUTOMOTORA` \| `CLINICA`), **independiente de la edición** (`COMPLETA` \| `ESENCIAL`). El rubro cambia el vocabulario y los módulos propios del rubro; la edición cambia cuánto del sistema hay y cuánta IA. |
| B3 | Primeros clientes: **clínicas de estética / dermatología**. |
| B4 | Las clínicas **arrancan en ESENCIAL**. El diseño tiene que funcionar con cualquier edición. |
| B5 | La **agenda vive en la plataforma** (recursos, servicios, turnos, Google Calendar). Sin integrar sistemas externos en la v1. |
| B6 | **Varios profesionales**, cada uno con sus horarios y prestaciones. La duración es por prestación. **Sobreturnos opcionales y desactivados por defecto.** Sin consultorios ni equipos como recurso aparte en la v1. |
| B7 | **Pagos:** el agente solo informa. No cobra ni pide señas. Cobertura de mutualistas: solo la informa si la clínica la cargó. |
| B8 | **Recordatorio antes del turno**, con plantilla. El paciente confirma o cancela respondiendo. Si no responde, el turno **no se cancela solo**: se crea una tarea y un aviso a recepción. |
| B9 | **Después del turno:** reseña con QR y recordatorio de control o de próximo turno, con el intervalo que la clínica define por prestación. |
| B10 | **Vocabulario:** "paciente" o "cliente", configurable por organización. Por defecto, "paciente" en clínicas. |
| B11 | **Datos de salud:** el agente nunca da historia clínica, diagnósticos ni consejos médicos. Ante síntomas o consultas clínicas deriva con un mensaje fijo. Ante una urgencia indica llamar a emergencias y deriva. **Validado en el backend, no solo en el prompt.** Datos mínimos: nombre, teléfono, prestación y turno. Sin motivo clínico detallado por defecto. |

### 0.3 Principio: la versión de clínicas es otro producto desde la experiencia

**Mismo repo, misma base y mismo deploy.** No se separa nada de la
infraestructura. Pero para el cliente, y para Rocco al operarla, la versión de
clínicas **se siente como otro producto**:

- **Propio del rubro:** menú, vocabulario, pantallas, textos del agente,
  plantillas de WhatsApp, catálogo de automatizaciones, guía de uso y Clínica
  Demo. **Una clínica no ve nada de autos.**
- **El código puede divergir donde haga falta.** Lo propio del rubro vive en
  módulos de clínicas (§1.3), no en ramas `if (industry === "CLINICA")`
  repartidas por los services compartidos.
- **El núcleo compartido se arregla una sola vez:** conversaciones, canales, el
  loop del agente, la base de conocimiento, Google Calendar, el multi-tenancy y
  la autenticación. Si una clínica necesita un cambio en el núcleo, el cambio se
  hace en el núcleo, y tiene que dejar a la automotora igual.

**Regla firme: nada de clínicas cambia el comportamiento de una automotora
existente, ni le pide a una automotora que reconecte nada.** Cada PR de este
plan que toca código compartido lleva un test que lo demuestra (la suite
"automotora sin cambios", §14.1). Si un PR no puede demostrarlo, no se mergea.

**Marca y dominio propios (nota, no es un PR).** Más adelante, las clínicas
pueden tener su propio nombre de producto y su propio dominio, sin tocar código.
Para que eso sea posible, el PR de pantallas de clínica (R17) saca el nombre
"Plataforma CRM", que hoy está escrito en `AppLayout.tsx:269` y `:567`, a la
configuración de marca. Esa configuración se resuelve por rubro y, el día que
haga falta, por dominio. Sumar el dominio después es configuración: el dominio
en Vercel, los orígenes permitidos (`CORS_ORIGIN`) y las URLs de redirección de
Supabase y de Google.

### 0.4 Rubro y edición, en una frase

- La **edición** dice **cuánto** sistema tiene la organización y cuánta IA
  (`docs/ediciones.md`).
- El **rubro** dice **de qué producto** se trata: qué módulos tiene, qué
  palabras usa la pantalla y el agente, y qué reglas extra valen (las de salud,
  en CLINICA).

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

model Organization {
  // ...
  industry OrganizationIndustry @default(AUTOMOTORA)
}
```

- **Es la única columna nueva en `organizations`.** Todo lo demás que configura
  una clínica (término del contacto, aviso de privacidad, parámetros de
  recordatorios) vive en tablas propias del módulo de clínicas (§1.3).
- **Nombre: `industry`.** No se reusa `Company.industry` (`schema.prisma:918`):
  ese es un texto libre que describe a una empresa cliente, no un enum que
  cambia el comportamiento del sistema.
- **Existentes:** la migración agrega la columna con `DEFAULT 'AUTOMOTORA'`.
  Todas las organizaciones actuales son automotoras: **no hace falta backfill**.
  Igual que `edition`, ningún código lee la columna hasta el PR del gate.
- **Quién lo elige:** el platform admin, en **Plataforma → Nueva
  organización**, **junto a la edición** y con el mismo criterio
  (`docs/ediciones.md` §1.1): obligatorio en el formulario y sin valor
  preseleccionado. En la API es opcional, con default `AUTOMOTORA`, por
  compatibilidad.
- **Quién lo cambia (D1):** solo el platform admin, con
  `PATCH /api/admin/organizations/:organizationId/industry`, y **solo mientras
  la organización no tenga datos de negocio** (contactos, turnos,
  conversaciones, vehículos) **ni usuarios con un rol que el rubro nuevo no
  admite** (USER al pasar a CLINICA, Recepción al pasar a AUTOMOTORA, §11.1).
  Si los tiene, responde 409. Cambiar a CLINICA crea
  las filas de configuración de clínica en la misma transacción. Cambiar a
  AUTOMOTORA las deja, sin uso.
- **Caché de autenticación:** igual que la edición, el rubro viaja en
  `AuthContext`. Un cambio llama a `vaciar()` (`authContextCache.ts:33`).
- El ADMIN de la organización ve el rubro como dato de **solo lectura**.

> **Implementado en R3.** Cómo quedó, y dónde difiere de lo de arriba:
>
> - **Llave `CLINICA_HABILITADA`** (`src/config/ediciones.ts`), en `false`,
>   con el mismo molde que `ESENCIAL_HABILITADA`. Con la llave en `false`, el
>   alta y el cambio de rubro responden 400 a CLINICA.
>   `GET /api/admin/organizations/industries` devuelve los rubros disponibles.
> - **Selector de rubro:** obligatorio y sin valor preseleccionado, junto al de
>   edición. Igual que el de edición, **solo aparece si el backend ofrece más
>   de un rubro**: hoy no se ve, y el alta no manda `industry` (default
>   AUTOMOTORA).
> - **Cambio de rubro (D1):** `PATCH /api/admin/organizations/:organizationId/industry`,
>   solo por API (no hay pantalla todavía, como pasó con la edición). Cuenta
>   como datos de negocio los contactos, turnos, conversaciones y vehículos,
>   **incluidos los dados de baja**. Cuenta como roles no admitidos los de
>   `ROLES_POR_RUBRO` (`src/config/ediciones.ts`): hoy CLINICA admite solo
>   ADMIN, y R12 le suma RECEPCION. Los chequeos y la escritura van en una
>   transacción con la fila de la organización bloqueada.
> - **`clinic_settings` → `organizations` con `ON DELETE CASCADE`**: es
>   configuración 1:1, sin datos de negocio. `clinic_branch_settings` sigue la
>   regla C-3 (FK compuesta a `branches`, RESTRICT).
> - **La sede de una clínica** crea su fila en `createBranch`, con el rubro de
>   `req.auth`. Una sucursal sin fila (por ejemplo, una creada antes de pasar a
>   CLINICA) usa los defaults.
> - **`/organization`:** `GET` y `PATCH /api/organization` suman `edition`,
>   `industry` y `contactTerm` (`null` en una automotora). El término se
>   cambia con el mismo `PATCH`, y en una automotora responde 400.
> - **`/me` → `vocabulario`:** las claves son `marca`, `contacto`, `recurso`,
>   `tipoDeServicio`, `reserva`, `agenda` y `responsable`. Cada una trae
>   `singular`, `plural`, `singularTitulo` y `pluralTitulo`. El de AUTOMOTORA
>   (`src/config/vocabulario.ts`) son los textos de hoy, y lo fija la suite
>   "automotora sin cambios". El de CLINICA está en
>   `src/clinicas/config/rubro.ts`.

### 1.2 Cómo se combinan rubro y edición: un solo catálogo

> **Implementado en R2.** El diseño de abajo es anterior al PR 3 de ediciones
> (#457), y el código real difiere en estos puntos:
>
> - **El gate no es un middleware aparte (`gateDeEdicion`):** es
>   `exigirModuloDeLaEdicion` (`src/middlewares/moduloDeLaEdicion.ts`), que
>   `authenticate` llama apenas resuelve `req.auth` (ediciones §5.2). R2 lo
>   extiende ahí. El no-op es para **COMPLETA + AUTOMOTORA**: una clínica
>   COMPLETA sí pasa por el gate.
> - **`RUTAS_POR_MODULO` es `Record<Modulo, string[]>`** con `"MÉTODO /api/patron"`,
>   no una lista de objetos.
> - **Bloqueos por campo:** no son zod refinados ni una lista por rubro. Es la
>   misma `CAMPOS_POR_RUTA` de ediciones, campo → módulo. El módulo decide con
>   `modulosDe`, así que sirve para la edición y para el rubro.
>   R2 suma `vehicleOfInterestId` en `PATCH /api/contacts/:id` (`stock`; el
>   `POST` no acepta ese campo), y `opportunityId` en `POST`/`PATCH
>   /api/activities` y `POST /api/bookings` (`oportunidades`). Las dos
>   ediciones tienen esos módulos, así que una automotora no los ve.
> - **`motivo` va en el 403 y en el 400.** Es `RUBRO` si el rubro no tiene el
>   módulo, aunque la edición tampoco lo tenga, porque subir de edición no se
>   lo daría. Si no, es `EDICION`. En una ruta sin clasificar es `RUBRO` fuera
>   de AUTOMOTORA. El texto del 403 de una automotora no cambia.
> - **`sync-vehicles` pasó de `base_de_conocimiento` a `stock`:** sin stock no
>   hay nada que volcar. Las dos ediciones tienen `stock`, así que a una
>   automotora no le cambia nada.
> - **Todavía no hay módulos propios de CLINICA.** R2 no los necesita:
>   `agenda_clinica` y los demás entran con el PR que les da rutas, y
>   `SOLO_CLINICA` los saca de AUTOMOTORA. Por eso `/me` de una automotora
>   devuelve los mismos `modulos` que antes. La garantía de §14.1 no compara
>   contra `MODULOS_POR_EDICION[e]`, que va a incluir esos módulos, sino
>   contra la lista fija de los módulos de antes de R2.
> - **Tools:** `toolDelRubro(nombre, edition, industry)` mapea cada tool a su
>   módulo (`MODULO_DE_LA_TOOL`) y le pregunta a `modulosDe`. Hay una sola
>   excepción explícita, `get_payment_info` fuera de CLINICA
>   (`TOOLS_FUERA_DEL_RUBRO`): su módulo no explica la exclusión (§5.1, B7).
>   En AUTOMOTORA no filtra nada, en ninguna edición.

**No se duplica el gate.** `docs/ediciones.md` §5 define un catálogo
(`src/config/ediciones.ts`) y un único middleware (`gateDeEdicion`). El rubro se
suma **al mismo archivo y al mismo middleware**:

```ts
// src/config/ediciones.ts (se extiende; no hay un segundo gate)

export type Modulo =
  | /* ...los de ediciones §5.1... */
  // propios de CLINICA:
  | "agenda_clinica"          // §4: profesionales, bloqueos, sobreturnos, reprogramar, atendido
  | "recordatorios_de_turno"  // §6
  | "post_turno"              // §7
  | "recepcion";              // §11: el rol

export const MODULOS_POR_EDICION: Record<OrganizationEdition, ReadonlySet<Modulo>>;
export const MODULOS_POR_RUBRO:   Record<OrganizationIndustry, ReadonlySet<Modulo>>;

/** La única función que decide. Gate, /me, tools y automatizaciones la usan. */
export function modulosDe(edition: OrganizationEdition, industry: OrganizationIndustry): ReadonlySet<Modulo>;

export const RUTAS_POR_MODULO: ReadonlyArray<{ metodo: string; ruta: string; modulo: Modulo }>;
```

- `MODULOS_POR_RUBRO[AUTOMOTORA]` = **exactamente** los módulos de hoy, sin
  ninguno de los propios de CLINICA. Por eso, para una automotora,
  `modulosDe(e, AUTOMOTORA)` es igual a `MODULOS_POR_EDICION[e]`, y lo fija un
  test (§14.1).
- `gateDeEdicion` llama a `modulosDe(req.auth.edition, req.auth.industry)`. Es
  una línea. `findUserForAuth` suma `o.industry` al mismo `SELECT` que suma
  `o.edition`.
- **Bloqueos por campo** (ediciones §5.3): una lista de campos por rubro en el
  mismo archivo. En CLINICA, por ejemplo, `vehicleOfInterestId` en
  `/api/contacts` da 400.
- **Respuesta (D12):** 403 `MODULO_NO_INCLUIDO` (ediciones D10), con un campo
  **aditivo** `motivo: "EDICION" | "RUBRO"`. El frontend dice "Disponible en la
  edición completa" solo con `EDICION`. Con `RUBRO` no ofrece nada: para una
  clínica, el stock de autos no es algo que le falte. Hoy no existe ninguna
  organización ESENCIAL, así que agregar el campo no cambia ninguna respuesta
  que un cliente ya reciba.
- **Caminos que no pasan por HTTP** (ediciones §5.2): tools del agente,
  automatizaciones, importación y workers usan la misma `modulosDe`.
- **Test "toda ruta clasificada"** (ediciones §5.4): no cambia. Las rutas del
  módulo de clínicas se clasifican como cualquier otra.

### 1.3 Dónde vive lo de clínicas

**Backend.** Una carpeta propia, `src/clinicas/`, con la misma organización por
capas que el resto (`routes`, `controllers`, `services`, `repositories`,
`workers`, `config`). Se monta desde `routes/index.ts` como un router más y sus
workers se registran donde se registran los demás. Adentro van:

- la configuración del rubro (`config/rubro.ts`: vocabulario, textos del agente,
  mensajes fijos de salud, catálogo de automatizaciones de clínica);
- los guardrails de salud;
- profesionales por prestación, bloqueos, sobreturnos, reprogramar, atendido;
- recordatorios, post-turno y su cola;
- la Clínica Demo.

**Frontend.** `frontend/src/features/clinica/` para las pantallas propias, y una
configuración de menú por rubro que `AppLayout` lee. Las pantallas compartidas
(conversaciones, contactos, agente) reciben el vocabulario por un hook; no se
copian.

**Guía de uso.** `docs/guia-de-uso/clinicas/`, con sus propios archivos y anclas.
`GuiaPage` elige la carpeta según el rubro de `/me`. La guía de automotoras no se
toca.

**Schema: dónde va cada dato nuevo.**

| Caso | Dónde | Ejemplos |
|---|---|---|
| Configuración que solo usa una clínica | **Tabla propia** de clínicas, 1:1 con la organización o la sucursal | `ClinicSettings`, `ClinicBranchSettings` |
| Entidad que solo existe en clínicas | **Tabla propia** | `ServiceTypeResource`, `ResourceTimeOff`, `BookingMessage`, `GoogleCalendarChannel` |
| Dato operativo de una fila compartida (`Booking`, `Resource`, `ServiceType`) | **Columna aditiva**, nullable o con un default que reproduce el comportamiento de hoy, que solo escribe y lee código de clínicas | `Booking.patientConfirmedAt`, `Resource.allowsOverbooking` |
| Cambio de una columna existente (NOT NULL → nullable, tipo, borrado) | **No se hace** en este plan | — |

La primera versión de este documento proponía hacer nullable
`QrFollowUp.opportunityId`. Con esta regla eso ya no va: el QR de las clínicas
sale por su propia cola (§7).

```prisma
// Propias del módulo de clínicas
model ClinicSettings {
  organizationId     String   @id
  contactTerm        ContactTerm @default(PACIENTE) // §3
  privacyNoticeText  String?  @db.VarChar(1000)     // §8
  privacyPolicyUrl   String?  @db.VarChar(500)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

enum ContactTerm {
  PACIENTE
  CLIENTE
}

model ClinicBranchSettings {
  branchId                  String  @id
  organizationId            String
  reminderHoursBefore       Int     @default(24)        // §6.2, CHECK 1..72
  lateBookingReminder       LateBookingReminder @default(NO_ENVIAR)
  lateBookingHoursBefore    Int     @default(2)         // solo con HORAS_ANTES, CHECK 1..23
  noResponseTaskHours       Int     @default(4)         // §6.5
  minHoursToChangeBooking   Int?                        // §5.1, null = sin plazo
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
}

enum LateBookingReminder {
  NO_ENVIAR
  EN_EL_MOMENTO
  HORAS_ANTES
}
```

- `ClinicSettings` se crea en la transacción del alta de una organización
  CLINICA. `ClinicBranchSettings` se crea al crear una sucursal de una clínica.
  Si falta la fila, el código usa los defaults: así nada depende de que la fila
  exista.
- Las dos tablas son nuevas: llevan RLS, H-01 y la fila 5 del diagnóstico
  (checklist de tablas nuevas).

---

## 2. Qué entra en cada rubro

**AUTOMOTORA = todo lo que existe hoy, sin cambios.** La tabla describe CLINICA.
La columna "Con ESENCIAL" dice qué queda al combinarla con la tabla de ediciones
§2.

| Módulo | CLINICA | Con ESENCIAL | Notas |
|---|---|---|---|
| Agentes de IA (+ probador, embed, guardrails) | ✅ | ✅ | Con los guardrails de salud obligatorios (§5.3). |
| Canales: WhatsApp, web, Messenger, Instagram | ✅ | ✅ | |
| Base de conocimiento | ✅ | ✅ | Con el tipo `INDICACIONES` (§5.4). **Sin `sync-vehicles`**. |
| Conversaciones | ✅ | ✅ | |
| Contactos ("Pacientes" / "Consultas sin identificar") | ✅ | ✅ | Sin "Vehículo de interés". |
| Usuarios, invitaciones | ✅ | ✅ | Roles ADMIN y Recepción (sin USER), y sedes por usuario (§11). |
| Sucursales ("sedes"), horarios | ✅ | ✅ | Más la configuración de recordatorios de la sede. |
| Agenda | ✅ **núcleo** | ✅ | |
| **Agenda de clínica** (`agenda_clinica`) | ✅ | ✅ | §4: varios profesionales por prestación, bloqueos, sobreturnos, reprogramar, atendido / no vino, un calendario de Google por profesional. **Solo CLINICA en la v1.** |
| **Recordatorios de turno** (`recordatorios_de_turno`) | ✅ | ✅ | §6. **Solo CLINICA en la v1 (D13).** |
| **Post-turno** (`post_turno`) | ✅ | ✅ | §7: QR de reseña y control. |
| **Recepción** (`recepcion`) | ✅ | ✅ | §11: el rol y los usuarios por sede (`UserBranch`). |
| Tareas (actividades) | ✅ | ✅ | |
| Seguimiento de consultas (#446) | ✅ con el filtro de turnos | ✅ | §9. |
| Cupones | ✅ manual | ✅ | El cupón manual (`POST /api/vouchers`) acepta un contacto sin oportunidad. Cupón automático después del turno: fuera de la v1. |
| QR de reseñas | ✅ | ✅ | Por la cola de clínicas, con el disparador "turno atendido" (§7). |
| Dashboard | ✅ atención | ✅ simple | El de atención de ediciones §6.4, más una tarjeta "turnos de hoy". |
| Campos personalizados | ✅ con aviso | ✅ (ediciones D5) | Aviso de no cargar datos de salud (§8.2). |
| Agente interno | ✅ opt-in | ✅ (ediciones D6) | |
| Fuentes / API keys / ingesta | ✅ | ✅ (ediciones D8) | |
| Importación de datos | ✅ | ✅ | Sin la entidad "vehículos". |
| Stock de vehículos, `sync-vehicles` | ❌ | — | `/api/vehicles*` → 403 `motivo: RUBRO`. |
| Vehículo de interés | ❌ (campo) | — | `vehicleOfInterestId` → 400. |
| Test drive | ❌ | — | No es una entidad; solo cambian textos (§5.6). |
| Permutas | ❌ | ❌ | |
| **Oportunidades (D3)** | ❌ | (mínima) | §2.1. |
| Procesos de venta, cotizaciones, pagos, entregas, empresas | ❌ | ❌ | Cuelgan de oportunidades. |

### 2.1 Las oportunidades en una clínica (D3: ocultas)

En CLINICA, `oportunidades` queda fuera de `MODULOS_POR_RUBRO`. Motivos:

- el agente no tiene iniciativas para crearlas: `INICIATIVAS_DEL_CLIENTE`
  (`utils/iniciativaDelCliente.ts:19-26`) es 100% automotor;
- lo que una clínica "vende" es un turno, y el turno ya es una entidad;
- el post-turno sale del turno (§7), no de "venta ganada".

Consecuencias:

- Fuera `create_opportunity` y `update_opportunity` (§5.1).
- El pipeline fijo de ESENCIAL (ediciones §2.1) se sigue creando en el alta, sin
  bifurcar esa transacción, y queda invisible.
- El seguimiento de consultas (#446), que mira "¿tiene una oportunidad OPEN?",
  ve siempre "no tiene". Por eso las clínicas suman el filtro por turnos (§9).
- **COMPLETA + CLINICA** tampoco tiene procesos de venta, cotizaciones, pagos ni
  entregas. Una clínica en COMPLETA conserva lo que COMPLETA cambia del agente
  (nivel AUTONOMA por defecto). Presupuestos de tratamiento y paquetes de
  sesiones quedan para una fase posterior, con su propio documento de diseño
  (D20, §15.1).

---

## 3. Vocabulario

| Capa | Ejemplo | Dónde vive | Quién lo cambia |
|---|---|---|---|
| **Término del contacto** (B10) | "paciente" / "cliente" | `ClinicSettings.contactTerm`, default `PACIENTE` | El ADMIN de la clínica, en `/organization` |
| **Vocabulario del rubro** | "Profesionales", "Prestaciones", "Turnos", "Agenda", "Responsable" | `src/clinicas/config/rubro.ts` | Nadie: es parte del producto |

- **Las automotoras no tienen término configurable:** siempre "cliente", como
  hoy. El campo no existe para ellas.
- **`/me`** devuelve `industry` y un objeto `vocabulario` armado por el backend
  (singular, plural, con y sin mayúscula, más la marca, §0.3). Mismo criterio
  que `modulos` en ediciones §7: el frontend no tiene una tabla propia. Para una
  automotora, `vocabulario` trae exactamente los textos de hoy.

### 3.1 Frontend

No hay biblioteca de i18n: los textos están escritos en el JSX, con `labels.ts`
por feature (`contact/labels.ts:23-29`). Hay unas 127 apariciones de "cliente"
fuera de los tests, en 59 archivos de `features/`. **No se reemplazan todas.**

| Pantalla | En CLINICA |
|---|---|
| Menú | Configuración propia del rubro (§1.3): Agenda, Turnos, Pacientes, Conversaciones, Tareas, Profesionales, Prestaciones, Base de conocimiento, Agente, Automatizaciones. Sin Stock, sin Empresas, sin Oportunidades. |
| Contactos | Pestaña "Pacientes"; etapa `CUSTOMER` = "Paciente". |
| Agenda | Pantallas propias en `features/clinica/` (calendario por profesional, bloqueos, atendido / no vino, reprogramar). |
| Sucursales | "Vendedor por defecto" (`Branch.defaultOwnerId`) → "Responsable por defecto", y la tarjeta de recordatorios (§6.2). |
| Automatizaciones | Catálogo de clínica (§7.3). |
| Ayuda | `docs/guia-de-uso/clinicas/`. |

**Test de vitest:** con una sesión CLINICA y `contactTerm = PACIENTE`, recorre
las pantallas y falla si aparece "cliente", "vehículo", "stock" o "test drive"
en lo visible. **Con una sesión AUTOMOTORA**, el menú y los textos son iguales a
los de hoy (snapshot).

### 3.2 Textos del agente

Textos que hoy están escritos para una automotora
(`agentOrchestration.service.ts`):

| Constante | Línea | Qué tiene de automotor |
|---|---|---|
| `INSTRUCCION_SIN_AUTORIDAD_COMERCIAL` | 409 | "permuta, financiación" |
| `INSTRUCCION_SOLO_LO_QUE_TE_CONSTA` | 435 | "si un auto acepta permuta o tiene financiación… búsqueda de stock" |
| `INSTRUCCION_OPORTUNIDAD_CON_INICIATIVA` | 453 | No va en CLINICA (la tool no está). |
| `MENSAJE_DE_FUGA_BLOQUEADA` | 505 | "sobre los vehículos, precios o para coordinar una visita" |
| `INSTRUCCION_DE_CIERRE_POR_TOPE` | 148 | "la unidad" |
| Descripciones de `get_availability` / `create_booking` | `agentTools.service.ts:1435`, `1597`, `1680` | Ejemplo: "Test drive" |

**Propuesta:** `armarSystemPrompt` sigue siendo pura y recibe un objeto
`textos` por parámetro, como ya recibe la base de conocimiento. Para
AUTOMOTORA, `textos` son **las mismas constantes de hoy**, sin tocarlas. Para
CLINICA, las versiones de `src/clinicas/config/rubro.ts`, con el término del
contacto ("el paciente").

**Test:** el system prompt completo de un agente AUTOMOTORA, armado con datos
fijos, es idéntico byte a byte antes y después del cambio.

---

## 4. Agenda para clínicas

### 4.1 Qué existe hoy

| Pieza | Estado | Dónde |
|---|---|---|
| `Resource` (`PERSON`, `ROOM`, `CLASS`) por sucursal | ✅ | `schema.prisma:1931-1959` |
| `ServiceType` con `durationMin` y `capacity` | ✅, **con un solo recurso** | `schema.prisma:1981-2016` |
| `WorkingHours` por recurso, horario partido | ✅ | `schema.prisma:2173-2213` |
| `Booking` (`CONFIRMED`, `CANCELLED`, `COMPLETED`, `NO_SHOW`) | ✅ | `schema.prisma:2277-2344` |
| Disponibilidad: horario − Google − reservas, contra la capacidad | ✅ | `availability.service.ts:156-221` |
| Crear con lock de recurso y de servicio | ✅ | `booking.service.ts:269-316` |
| `force` (solo ADMIN): saltea horario y grilla, **no** la capacidad | ✅ | `booking.service.ts:92-97`, `157-164` |
| Cancelar | ✅ | `booking.service.ts:415-454` |
| Google Calendar: una conexión y **un calendario** por sucursal | ✅ | booking-architecture §4 |
| Reprogramar | ❌ a propósito | `booking.service.ts:33-37` |
| Pasar a `COMPLETED` / `NO_SHOW` | ❌ | ningún código lo hace |
| Eventos de turno (outbox) | ❌ | `booking.service.ts:39-42` |
| Bloqueos puntuales | ❌ | booking-architecture §3 |
| Prestación con varios profesionales | ❌ | `ServiceType.resourceId` |
| Sobreturnos | ❌ | |

**Todo lo nuevo de esta sección es del módulo `agenda_clinica`**: solo lo ve y lo
usa una organización CLINICA. La agenda de una automotora sigue funcionando
exactamente como hoy.

### 4.2 Profesionales

**Un profesional es un `Resource` con `type = PERSON`.** Ya tiene sucursal,
horario partido y nombre. Las pantallas de clínica no ofrecen `ROOM` ni `CLASS`
(B6).

- Un profesional **no es un `User`**. Si algún día hace falta "mi agenda" para
  el profesional, se suma un `Resource.userId` opcional.
- El nombre que ve el paciente es `Resource.name` ("Dra. Lucía Ejemplo").

### 4.3 Prestaciones con varios profesionales

> **Implementado en R5.** Cómo quedó, y dónde difiere de lo de abajo:
>
> - **Tabla `service_type_resources`** (migración 20261102120000), con FKs
>   compuestas a `service_types` y `resources` y RLS. **Los profesionales de
>   una prestación son el principal más las filas de la tabla**: las lecturas
>   hacen esa unión siempre. No hay trigger ni service que "garantice" la fila
>   del principal, porque no hace falta.
> - **Relleno:** la migración escribe el principal de cada prestación de una
>   organización CLINICA. Hoy no hay ninguna, así que no escribe nada; queda
>   por si se aplica sobre una base con clínicas. Las automotoras no tienen
>   filas.
> - **Aceptar a otro profesional:** `resolverContexto` (disponibilidad) y la
>   relectura bajo lock de `createBooking` aceptan al principal o a un
>   profesional de la tabla. La tabla se consulta **solo** si el recurso no es
>   el principal: en el camino feliz de una automotora no hay ninguna consulta
>   nueva, y el rechazo es el mismo 400.
> - **El módulo de clínicas** (`src/clinicas/`):
>   - `services/agendaClinica.service.ts`: la disponibilidad de una prestación
>     es la unión de `obtenerDisponibilidad` por profesional, sin una segunda
>     cuenta. El "primero libre" elige entre los que tienen ese turno libre
>     según esa misma función, el de menos turnos ese día (en la zona de la
>     sede); si otro pedido se lo gana (409), prueba con el siguiente.
>   - Rutas `/api/clinica/*`: prestaciones, sus profesionales, disponibilidad
>     y turno. Las cinco son del módulo nuevo `agenda_clinica`, en
>     `SOLO_CLINICA`.
> - **El gate:** para COMPLETA + AUTOMOTORA sigue siendo un no-op, con una
>   única excepción. Una ruta de un módulo de `SOLO_CLINICA` da 403 con motivo
>   RUBRO. Las rutas sin clasificar y los campos siguen igual que antes.
> - **Tools del agente:** `ReglasDelRubro.toolsPropias` (R4) suma las
>   versiones de clínica de `get_service_types`, `get_availability` y
>   `create_booking` (`src/clinicas/toolsDeAgenda.ts`). Tienen el mismo nombre
>   y los mismos argumentos, y `resourceId` es el profesional que eligió el
>   paciente; sin él, se muestran todos los profesionales o se reserva al
>   primero libre. Sin oportunidad: una clínica no tiene (§2.1). AUTOMOTORA no
>   tiene tools propias.
> - **Pantallas:** `features/clinica/` tiene Profesionales (la lista, con
>   alta y horario en la pantalla de recursos que ya existe) y Prestaciones
>   (elegir quién atiende). Las dos usan el vocabulario de `/me`. En una
>   clínica el menú las muestra en lugar de Recursos y Tipos de servicio. **La
>   pantalla de reservas del panel todavía no ofrece "el primero libre"**:
>   reservar con otro profesional que el principal funciona por la API y por
>   el agente; el panel queda para el PR de pantallas (R17).
> - **Google:** la disponibilidad consulta el `freebusy` de la sucursal una
>   vez por profesional (el mismo calendario). Restar solo lo de cada
>   profesional es R8.

`ServiceType.resourceId` es NOT NULL y apunta a **un** recurso. "Limpieza
facial" la hacen dos cosmetólogas, y el paciente quiere "el primer turno libre
con cualquiera".

```prisma
model ServiceTypeResource {
  organizationId String
  serviceTypeId  String
  resourceId     String
  createdAt      DateTime @default(now())
  @@id([serviceTypeId, resourceId])
  // FKs compuestas (organizationId, x), como el resto del módulo
}
```

- **`ServiceType.resourceId` no se toca** (§1.3). En una clínica sigue siendo
  NOT NULL y significa "profesional principal". La tabla puente lista **todos**
  los profesionales de la prestación, incluido el principal. Un trigger o el
  service garantizan que el principal esté siempre en la tabla.
- **Sin backfill.** Solo se escriben filas para prestaciones de clínicas. La
  agenda de una automotora no lee la tabla.
- **Duración (B6):** `ServiceType.durationMin`. Sin duración por profesional en
  la v1.
- **Capacidad:** `ServiceType.capacity`, por profesional. En una clínica es 1.
- **Disponibilidad (servicio de clínicas):** con `serviceTypeId` y sin
  `resourceId`, devuelve los turnos de **todos** los profesionales de la
  prestación, cada uno con su `resourceId` y su nombre. Reusa `calcularTurnos`
  y `estaDentroDelHorario` por profesional: no hay una segunda cuenta de
  disponibilidad.
- **Turno sin profesional elegido:** el service elige al libre en ese horario.
  Si hay varios, el de **menos turnos ese día**. Con el lock del recurso elegido,
  como hoy.
- `get_service_types` (en CLINICA) devuelve, por prestación, la lista de
  profesionales (`id`, `name`).

### 4.4 Sobreturnos (D9)

> **Implementado en R6** (migración `20261106120000_clinicas_bloqueos_y_sobreturnos`).
> Decisiones de Rocco del 2026-10-10 y cómo quedó:
>
> - **Solo por profesional:** `Resource.allowsOverbooking` (apagado por
>   defecto) y `Resource.maxOverbookingsPerDay` (entero ≥ 1, default 1, CHECK
>   en la base), los dos los fija un ADMIN en la ficha del profesional
>   (`PUT /api/clinica/profesionales/:resourceId/sobreturnos`). No hay
>   interruptor por sede.
> - **El tope** cuenta los sobreturnos no cancelados del profesional que
>   empiezan ese día calendario, en la zona de la sede. Al llegar al tope no se
>   ofrecen más (409 si se intenta). Cancelar uno libera el cupo. Bajar el tope
>   por debajo de los ya cargados no los toca.
> - **Solo encima de un horario completo:** con lugar, el pedido da 400 ("agendá
>   un turno normal"). Con el profesional elegido (nunca "el primero libre").
>   Lo cargan ADMIN y Recepción desde `POST /api/clinica/turnos` con
>   `isOverbooking: true`; el agente nunca: la tool no acepta el campo y
>   `/api/clinica/disponibilidad` solo los ofrece con `sobreturnos=true`.
> - Un sobreturno no cuenta para la capacidad de los turnos normales
>   (`countOverlappingBookings` y `findConfirmedBookingsInRange` excluyen
>   `isOverbooking`). Al ofrecerlos no se resta Google: el horario completo
>   ya está ocupado en Google por el propio turno.

**Qué es:** un turno que se superpone con otro del **mismo profesional** aunque
la capacidad ya esté completa. No es `force`, que saltea horario y grilla pero
nunca la capacidad.

```prisma
model Resource { allowsOverbooking Boolean @default(false) } // aditiva
model Booking  { isOverbooking     Boolean @default(false) } // aditiva
```

- **Desactivado por defecto**, por profesional. Lo habilita un ADMIN.
- Lo crea **una persona** (ADMIN o Recepción, §11), desde el panel. **El agente
  nunca ofrece ni crea sobreturnos:** no entran en `get_availability` y la tool
  no acepta el campo.
- Valida todo lo demás: horario (salvo `force`), "no en el pasado" y
  aislamiento. Solo saltea la capacidad, y no le quita lugar a los turnos
  normales.
- El calendario lo marca. El recordatorio sale igual.

### 4.5 Bloqueos puntuales

> **Implementado en R6.** Cómo quedó, y dónde difiere de lo de abajo:
>
> - **Sin recurrencia** (no estaba prevista): cada bloqueo es un período real.
> - **Misma regla que un evento ocupado de Google:** `calcularTurnos` descarta
>   el turno que se superpone con un bloqueo (agente, `/api/availability` y
>   `/api/clinica/disponibilidad`), y `createBooking` lo rechaza con 409
>   bajo el lock del recurso (que es el mismo que toma crear un bloqueo). **Ni
>   `force` lo saltea**: el profesional no está. Una automotora no tiene filas,
>   así que su cuenta es la de antes (una consulta indexada más, vacía).
> - **Turnos ya dados dentro de un bloqueo nuevo** (decisión de Rocco): no se
>   cancelan. La respuesta los lista y se crea **una tarea por turno** para la
>   Recepción de la sede (§11.4; con el `branchId` del profesional). Una por
>   turno y no una sola: toda tarea cuelga de un contacto
>   (`activities_related_entity_check`). Reprogramar es R9: hasta entonces la
>   pantalla ofrece cancelar.
> - Rutas `/api/clinica/profesionales/:resourceId/bloqueos` (GET, POST) y
>   `/api/clinica/bloqueos/:id` (DELETE), `authorize("ADMIN", "RECEPCION")`,
>   con el límite por sede de R20 (404 fuera de sus sedes).
> - **Arreglo de R20 incluido:** `GET /api/availability` le da a una Recepción
>   de clínica el mismo 400 que un recurso inexistente si el profesional es de
>   otra sede. Para las automotoras no cambia (`sedesDelActor` = todas).
> - Las columnas nuevas no salen en las respuestas de una automotora
>   (`src/clinicas/camposDeClinica.ts`, el mismo criterio que `branchId` en
>   las tareas de R20).

```prisma
model ResourceTimeOff {
  id             String   @id
  organizationId String
  resourceId     String
  startsAt       DateTime // instante: un bloqueo es un período real
  endsAt         DateTime
  reason         String?  @db.VarChar(200) // interno; nunca se le muestra al paciente
  createdAt      DateTime @default(now())
}
```

- La disponibilidad de clínicas resta los bloqueos al ofrecer **y** al aceptar
  (la misma función, booking-architecture §5).
- Crear un bloqueo encima de turnos ya dados **no los cancela**: responde con la
  lista de afectados y la pantalla ofrece reprogramarlos o cancelarlos.
- Los crean ADMIN y Recepción.

### 4.6 Google Calendar: un calendario por profesional (D4)

> **R8 implementado** (migración `20261107120000_clinicas_google_por_profesional`).
> Cómo quedó, y dónde difiere de lo de abajo:
>
> - **Modelo:** `Resource.googleCalendarId` y `Booking.googleCalendarId`
>   (nullable). En `GoogleCalendarChannel`: `resourceId` (FK compuesta NO
>   ACTION) y `lastErrorAt`/`lastErrorMessage`. Sin `connectionId`, como en
>   R7. La fila de la sede de hoy queda con `resourceId` NULL.
> - **La fuente de verdad es `Resource.googleCalendarId`.** El worker de
>   renovación crea la fila de canal de cada profesional de clínica con
>   calendario cuya sede tiene Google ACTIVE, y la abre o renueva
>   (`events.watch` sobre ese calendario). Así, reconectar o desconectar la
>   sede, que borra sus filas (R7), no pierde nada: la próxima pasada las vuelve
>   a crear. Desconectar detiene también los canales de los profesionales.
> - **Disponibilidad:** un `freebusy` por profesional consultado, no uno solo
>   con todos los calendarios: cada uno usa el mismo `obtenerDisponibilidad`,
>   y así el error de un calendario no tumba a los demás. Lo activa
>   `googlePorProfesional` (la agenda de clínica siempre; `/api/availability`
>   cuando el usuario es de una clínica). El error de un calendario de
>   profesional queda en su fila de canal y **no** marca la conexión de la sede
>   en ERROR.
> - **Turno de un profesional sin calendario:** el evento va al calendario de
>   la sede con el título de siempre (el nombre del profesional ya viaja en la
>   descripción). `Booking.googleCalendarId` queda NULL (= el de la sede).
> - **Rutas** (módulo `agenda_clinica`, ADMIN):
>   `GET /api/branches/:branchId/google-calendar/calendars` y
>   `PUT /api/clinica/profesionales/:resourceId/google-calendar` (en lugar de
>   `/api/resources/:id/google-calendar`, para que la ruta sea del módulo de
>   clínica). La elección valida con un `freebusy` sobre el calendario y
>   rechaza el de la sede y uno que ya usa otro profesional. El canal del
>   calendario nuevo **se abre en el momento** (pedido de Rocco, para no quedar
>   hasta una hora sin detectar cambios); si Google falla, la asignación vale
>   igual, el error queda en la fila y el worker lo reintenta en su pasada.
> - **Archivar un profesional** (el "eliminar" de recursos es un soft delete):
>   su fila de canal se borra en la misma transacción que el archivado y el
>   canal se detiene en Google después del commit, best-effort. Si Google
>   falla, el archivado vale igual: el canal vence solo y sus notificaciones ya
>   no encuentran fila. Sus bloqueos (R6) quedan como historia: con soft delete
>   el RESTRICT nunca se dispara.
> - **`last_error_message`** guarda solo el error de Google o de esta
>   integración, con cualquier forma de token tapada (`mensajeDeErrorDelCanal`).
>   Un error de otro origen (la base, la red) se guarda como un texto fijo; el
>   detalle queda en el log.
> - **Scopes:** `scopesDeConexion(industry)`. Para una automotora, la URL es
>   idéntica byte a byte (suite "automotora sin cambios").
>   `include_granted_scopes=true` solo para clínicas.
> - **D16, decisión de Rocco del 2026-10-10:** en una clínica un turno
>   **borrado o movido** directamente en Google no se cancela ni se mueve
>   solo. Se registra y se crea una tarea para la Recepción de la sede (§11.4),
>   con paciente, profesional, fecha y qué pasó en Google. Un turno borrado
>   queda además sin `googleEventId` (ya no tiene espejo). La plataforma sigue
>   siendo la fuente de verdad. **La cancelación inversa automática queda solo
>   para las automotoras**, como hoy.

> **R7 implementado (canales en su propia tabla).** Cómo quedó, y dónde
> difiere del modelo de abajo:
>
> - **`google_calendar_channels`** tiene `organizationId`, `branchId`,
>   `calendarId`, los tres campos del canal (con el mismo CHECK de "van
>   juntos"), `syncToken` y timestamps. `channelId` es `@unique` y hay un
>   unique `(organizationId, branchId, calendarId)`.
>   - **Sin `connectionId`.** Hay una conexión por sucursal, así que la FK
>     compuesta va a `branches(organization_id, id)`, igual que la de la
>     conexión. `google_calendar_connections` no tiene un unique
>     `(organization_id, id)`, y agregarlo era tocar una tabla existente.
>   - **Sin `resourceId` ni `lastError*`.** Son de R8, que los agrega con su
>     migración junto con el uso.
>   - **RLS sin políticas (deny-all)**, como la conexión y
>     `meta_page_connections`.
> - **Copia, no mueve.** La migración copia el canal y el `syncToken` de cada
>   conexión que los tiene. El código de R7 **lee** la tabla nueva y **escribe
>   las dos**, con las columnas viejas como espejo en la misma transacción.
>   Volver al código anterior no pierde ningún canal renovado ni ningún
>   `syncToken`. R21 borra las columnas y el espejo juntos.
> - **Transición.** Entre que se aplica la migración y se despliega el código,
>   el código viejo puede escribir las columnas viejas. Hay dos redes:
>   - el webhook, si no encuentra el `channelId` en la tabla nueva, lo busca en
>     las columnas viejas;
>   - el worker de renovación, al empezar cada pasada, corre
>     `reconciliarCanalesConLasColumnasViejas`, que adopta lo que el código
>     viejo haya escrito (las columnas viejas ganan cuando difieren). En régimen
>     no cambia ninguna fila.
> - **Reconectar o desconectar** borra las filas de canal de la sucursal, en la
>   misma transacción que limpia la conexión.
> - Los repositorios conservan su firma. Webhook, sync y worker no cambiaron de
>   forma, salvo `desconectar` (lee el canal de la tabla nueva) y la
>   reconciliación al inicio de la pasada.

#### El problema de hoy

Con Google conectado, `obtenerDisponibilidad` consulta el `freebusy` del
**calendario de la sucursal** y lo resta de **cualquier** recurso
(`availability.service.ts:178-191`). Todos los eventos se crean en ese mismo
calendario. En una clínica con tres profesionales, cada turno vuelve "ocupado"
ese horario para los tres.

**Para las automotoras no se cambia nada (D17).** Una automotora con más de un
recurso tiene el mismo problema, pero arreglarlo cambiaría su comportamiento
(§0.3), y ninguna lo reportó. El `freebusy` de las automotoras queda como está.
Si algún día se arregla, será con su propio diseño y su propio PR, fuera de
este plan.

#### Scopes: verificados contra Google y contra el código

Hoy se piden **dos** scopes (`googleCalendar.service.ts:59-62`, y el test
`googleCalendar.service.test.ts:278-284`, que además exige que **no** estén
`calendar.readonly` ni `calendar`):

| Operación | Scopes que Google acepta (referencia oficial) | ¿Alcanza con los de hoy? |
|---|---|---|
| `freebusy.query` sobre otro calendario | `calendar.readonly`, `calendar`, `calendar.events.freebusy`, `calendar.freebusy` | **Sí** (`calendar.events.freebusy`) |
| `events.insert` / `patch` / `delete` en otro calendario | `calendar.events` (entre otros) | **Sí** |
| `events.watch` y `events.list` por calendario | `calendar.events`, `calendar.events.freebusy` y otros siete | **Sí** |
| **`calendarList.list`** (elegir de una lista) | `calendar.readonly`, `calendar`, `calendar.calendarlist`, **`calendar.calendarlist.readonly`** | **No**: hace falta un scope nuevo |

Todo el funcionamiento por profesional anda con los scopes de hoy. Lo único que
pide un scope nuevo es **mostrar la lista** de calendarios para elegir uno.

**Cómo se garantiza que solo lo pidan las clínicas:**

- Los scopes se arman **en cada pedido de autorización**, no se configuran una
  vez para toda la app. `scopesDeConexion(industry)` devuelve los dos de hoy
  para AUTOMOTORA y los dos más `calendar.calendarlist.readonly` para CLINICA.
  La URL de autorización de una automotora queda idéntica a la de hoy.
- **Una conexión ya hecha no se toca.** Un refresh token conserva los scopes con
  los que se otorgó: las sucursales de automotoras ya conectadas no pasan por
  ninguna pantalla nueva ni tienen que reconectar.
- `include_granted_scopes=true` va **solo** en el pedido de clínicas, para que
  una clínica que se conectó antes de este cambio pueda sumar el scope
  reconectando, sin perder lo otorgado.
- **Test:** la URL de autorización de una sucursal AUTOMOTORA tiene exactamente
  los dos scopes de hoy y los mismos parámetros. La de una CLINICA tiene los
  tres. El test existente que prohíbe `calendar.readonly` y `calendar` sigue
  valiendo para los dos rubros.

**Configuración externa que hay que hacer antes del PR R8:** sumar
`calendar.calendarlist.readonly` a la pantalla de consentimiento del proyecto en
Google Cloud. Si la app está verificada, Google puede pedir verificar el scope
nuevo. Mientras tanto, **el pedido de las automotoras no lo incluye**, así que
no les cambia nada. Las clínicas tienen el camino de respaldo de abajo (pegar el
ID), que no necesita el scope.

#### Modelo

```prisma
model Resource {
  // ...
  googleCalendarId String? @db.VarChar(255) // aditiva; solo CLINICA la escribe
}

model Booking {
  // ...
  googleCalendarId String? @db.VarChar(255) // aditiva: en qué calendario quedó el evento
}

model GoogleCalendarChannel {
  id                String    @id
  organizationId    String
  branchId          String
  connectionId      String    // FK a GoogleCalendarConnection
  resourceId        String?   // null = el calendario de la sucursal
  calendarId        String    @db.VarChar(255)
  channelId         String?   @unique @db.Uuid
  channelResourceId String?   @db.VarChar(255)
  channelExpiration DateTime?
  syncToken         String?
  lastErrorAt       DateTime?
  lastErrorMessage  String?   @db.VarChar(500)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  @@unique([connectionId, calendarId])
  @@index([channelExpiration])
  // CHECK: channelId, channelResourceId y channelExpiration van juntos
  // (el mismo que google_calendar_connections_channel_all_or_none_check)
}
```

- **`Booking.googleCalendarId`** hace falta para cancelar o mover un evento en
  el calendario donde se creó, aunque después cambie el calendario del
  profesional. Para las automotoras queda `null` y el código sigue usando el de
  la conexión, como hoy.
- **El estado del canal sale de `GoogleCalendarConnection`** (`channelId`,
  `channelResourceId`, `channelExpiration` y `syncToken`,
  `schema.prisma:2089-2112`) a `GoogleCalendarChannel`, porque ahora una
  conexión tiene varios calendarios y cada uno su canal y su `syncToken`.

#### Migración del estado de los canales (sin reconectar a nadie)

1. Crear `google_calendar_channels`.
2. **Copiar**, por cada conexión, una fila con `resourceId = null`, el
   `calendarId` de la conexión y los cuatro valores del canal **tal como
   están**. Los canales vivos en Google siguen siendo los mismos: mismo
   `channelId`, mismo `resourceId` de Google, mismo vencimiento.
3. Las columnas viejas **quedan en el schema, sin uso**. Se borran después
   (D18), en un PR posterior (R21 🗄), cuando R7 lleve un tiempo en producción
   sin problemas. Ese PR **no se mergea por iniciativa propia**: es un borrado
   de columnas.
4. El webhook (`googleCalendarWebhook.controller.ts`) y `procesarNotificacion`
   buscan por `channelId` en la tabla nueva (hoy `findConnectionByChannelId`).
   El token firmado (`organizationId`, `branchId`, `channelId`) no cambia de
   formato: las notificaciones de los canales existentes se siguen aceptando.

Es el único cambio de este plan que modifica código compartido de Google para
las automotoras. **El comportamiento es el mismo**, y lo prueban los tests de
§14.1.

#### Comportamiento en CLINICA

- **Elegir el calendario de un profesional:**
  - `GET /api/branches/:branchId/google-calendar/calendars` (CLINICA, ADMIN)
    llama a `calendarList.list` con `minAccessRole=writer` y devuelve
    `{ id, summary, accessRole }`. Sin el scope (una conexión vieja), responde
    409 con "reconectá Google para ver la lista" y la pantalla ofrece el
    respaldo.
  - **Respaldo sin scope nuevo:** pegar el ID del calendario. Se valida con un
    `freebusy.query` sobre ese ID: si Google lo reporta con error de acceso,
    400.
  - `PUT /api/resources/:id/google-calendar` `{ calendarId | null }` (CLINICA,
    ADMIN) guarda `Resource.googleCalendarId` y crea la fila de canal.
  - El calendario tiene que ser de la cuenta conectada o estar compartido con
    ella con permiso de edición. La pantalla lo explica.
- **Disponibilidad:** un solo `freebusy.query` con los calendarios de los
  profesionales que se están consultando, y a cada uno se le resta **solo lo
  suyo**. Un profesional sin calendario propio no resta nada de Google. **En
  CLINICA, el calendario de la sucursal nunca se resta.**
- **Crear turno:** `events.insert` en el calendario del profesional (o, si no
  tiene, en el de la sucursal, con el nombre del profesional en el título). Se
  guarda `Booking.googleCalendarId`. El orden de booking-architecture §5 no
  cambia: Google afuera de la transacción, best-effort.
- **Reprogramar (§4.7):** con el mismo profesional, `events.patch`. Con otro
  profesional, `events.delete` en el calendario viejo y `events.insert` en el
  nuevo.
- **Cancelar:** `events.delete` en `Booking.googleCalendarId`.
- **Evento borrado en Google (D16, cambiado en R8):** cada calendario tiene su
  canal, y el evento se busca por `googleEventId` (único por organización,
  migración `20260902140000`). En una clínica **no se cancela el turno**: se
  registra y se crea una tarea para recepción, como un evento movido. La
  cancelación inversa automática queda solo para las automotoras.
- **Evento movido en Google (D16):** no se aplica. Se registra (como hoy, con
  el `bookingId` y los dos horarios) y se crea una **tarea para recepción** de la
  sede del turno (§11.4): "El turno de {paciente} se movió en Google al {dia}
  {hora}. En la plataforma sigue el {dia} {hora}: reprogramalo o avisale al
  paciente". El turno no cambia hasta que una persona lo reprograme. La tarea
  lleva el `branchId` del turno, así la ve la recepción de esa sede (§11.5).
- **Cambiar el calendario de un profesional:** se detiene el canal viejo
  (`channels.stop`) y se crea el nuevo. Los turnos ya creados conservan su
  `googleCalendarId`.

#### Worker de renovación

`renovarCanalesVencidos` (`googleCalendarChannelWorker.ts:78`) pasa a recorrer
`GoogleCalendarChannel` en lugar de las conexiones:

- canal sin `channelId` o que vence en menos de 24 h, con su conexión `ACTIVE` →
  `events.watch` sobre su `calendarId` y `channels.stop` del anterior;
- un access token por conexión y por pasada, no uno por canal;
- conexión `REVOKED` o `ERROR` → se detienen todos sus canales;
- el error de un canal (un calendario que se borró) se guarda en su fila y no
  frena a los demás. Para las automotoras hay una fila por conexión, así que la
  pasada hace lo mismo que hoy.

### 4.7 Reprogramar

> **Implementado en R9** (sin migración). Cómo quedó, y dónde difiere de lo de
> abajo:
>
> - `reprogramarTurno` (`src/clinicas/services/reprogramar.service.ts`) detrás
>   de `PATCH /api/bookings/:id/reschedule` `{ startsAt, resourceId?,
>   isOverbooking?, force? }`, con `authorize("ADMIN", "RECEPCION")` y el
>   límite por sede (404). El horario nuevo pasa por las mismas reglas que
>   agendar: horario y grilla (`resolverContexto`; `force` solo ADMIN),
>   bloqueos (R6), capacidad sin contar el propio turno, y el sobreturno solo
>   con `isOverbooking`, si el profesional lo permite y dentro del tope (R6).
>   Otro profesional, solo de la misma prestación (R5) y de la misma sede.
> - **El historial** es una NOTE en el paciente con el horario anterior, el
>   nuevo y quién reprogramó.
> - **Google:** mismo profesional, `events.patch`; otro, delete en el viejo e
>   insert en el nuevo. El horario nuevo y el desvinculado del evento viejo se
>   guardan **antes** de tocar Google, así la notificación de vuelta no dispara
>   la tarea de "movido o borrado en Google" (D16). Si Google falla con la sede
>   conectada, se crea en el momento una tarea para la Recepción de la sede.
>   No hay columna de "desincronizado" (decisión de Rocco del 2026-10-10: sin
>   migración).
> - **Archivar un profesional con turnos futuros** (solo clínicas): los turnos
>   no se cancelan y se crea una tarea por turno para la Recepción de la sede.
>   `GET /api/clinica/profesionales/:id/turnos-futuros` le da a la pantalla el
>   número para avisar antes de confirmar.
> - **Lo que R11 tiene que reutilizar:** la tool `reschedule_booking` llama a
>   `reprogramarTurno` con `quien` = el asistente (como `userId`, el
>   responsable de la conversación o de la sede, porque `authorId` no admite
>   nulos) y sin `isOverbooking` ni `force`. Antes suma solo sus reglas
>   propias (§5.1): el turno del contacto de la conversación, el candado de
>   identidad y `minHoursToChangeBooking`. Las validaciones, Google y el
>   historial no se duplican en la tool.
> - **Lo que R13 tiene que contemplar:** reprogramar no recalcula
>   recordatorios porque todavía no existen. R13 tiene que mover (o cancelar) el
>   `BookingMessage` pendiente del turno dentro de `reprogramarTurno`.

- `PATCH /api/bookings/:id/reschedule` `{ startsAt, resourceId? }`, módulo
  `agenda_clinica`.
- **Mismo `id`.** Los mensajes pendientes se recalculan (§6).
- En una transacción: lock del recurso viejo y del nuevo **en orden por `id`**
  (sin deadlock entre dos reprogramaciones cruzadas), revalidación con
  `resolverContexto`, capacidad sin contar el propio turno y bloqueos.
- Después del commit: Google, como en §4.6.
- Solo desde `CONFIRMED` y hacia el futuro.
- Una `Activity` NOTE con el horario anterior.

### 4.8 Atendido y No vino (D6)

> **Implementado en R10** (migración `20261108120000_clinicas_atendido_no_vino`).
> Decisiones de Rocco del 2026-10-10 y cómo quedó:
>
> - **Marcar:** `PATCH /api/bookings/:id/attended` y `/no-show` (módulo
>   `agenda_clinica`, ADMIN y Recepción, 404 fuera de sus sedes), sobre un
>   turno que ya empezó. Marcar lo mismo otra vez no hace nada (ni nota ni
>   evento). Un turno cancelado da 409. El agente no marca nada.
> - **Corrección:** `COMPLETED` ↔ `NO_SHOW`, sin límite de tiempo (se aparta
>   de "solo desde CONFIRMED"); volver a `CONFIRMED` no. Queda una nota
>   "Corrección del turno: de X a Y" con quién, y el evento del estado nuevo va
>   con `esCorreccion: true` y `estadoAnterior`.
> - **Historial:** una NOTE en el paciente con qué se marcó, cuándo y quién, y la
>   nota opcional (200 caracteres; la pantalla avisa que no se carguen datos de
>   salud). El texto vive solo en la actividad: el turno no guarda nota.
> - **Columnas:** `completedAt` y `completedBy` (`PERSONA` | `AUTO`), los dos
>   juntos y solo en `COMPLETED`/`NO_SHOW` (CHECK `bookings_completed_check`).
> - **Eventos, solo en CLINICA:** `booking.created`, `booking.cancelled`,
>   `booking.rescheduled`, `booking.completed` y **`booking.no_show`** (sumado
>   para R14). Salen de los servicios únicos de turnos (agendar, cancelar,
>   reprogramar, marcar, el cierre automático), en la misma transacción que el
>   cambio, y cada uno lleva un `eventoId` único. Lo que se detecta desde
>   Google en una clínica (D16) no emite nada: solo crea la tarea. Una
>   automotora no emite nada nuevo (suite "automotora sin cambios"). Hasta que
>   R13/R14 los sumen como triggers del motor, un handler los consume sin
>   acción (`registrarEventosDeTurno`) para que no vayan a `DEAD_LETTER`;
>   ese PR lo reemplaza.
> - **LOS CONSUMIDORES TIENEN QUE SER IDEMPOTENTES POR TURNO** y no reenviar un
>   mensaje que ya salió por una corrección (`esCorreccion`) o un cierre
>   automático (`automatico`).
> - **Cierre automático:** `cerrarTurnosVencidos` (worker de cada 15 min)
>   pasa a `COMPLETED` (`completedBy AUTO`) los turnos `CONFIRMED` de
>   clínicas cuyo `endsAt` pasó hace más de 3 h. Deja una nota "Turno cerrado
>   automáticamente" y emite `booking.completed` con `automatico: true`. **Para
>   R14:** puede esperar o tratar distinto un cierre automático antes de pedir la
>   reseña. Si Recepción corrige después a No vino, llega como corrección.
>   Idempotente por el CAS sobre `CONFIRMED`. Una automotora nunca cambia
>   sola.

- `PATCH /api/bookings/:id/attended` y `/no-show`, transiciones con el verbo en
  el path, como `cancel`. Solo desde `CONFIRMED` y después de `startsAt`.
- **Cierre automático:** un worker de clínicas pasa a `COMPLETED` los turnos
  `CONFIRMED` de organizaciones CLINICA cuyo `endsAt` pasó hace más de 3 h.
  Hasta ese momento, recepción puede marcar "No vino". **El worker filtra por
  rubro:** un turno de una automotora nunca cambia de estado solo.
- Columnas aditivas `Booking.completedAt` y `completedBy` (`PERSONA` \| `AUTO`).
- **Eventos al outbox, solo en CLINICA:** `booking.created`, `booking.cancelled`,
  `booking.rescheduled` y `booking.completed`. Los turnos de una automotora no
  emiten nada, como hoy (`booking.service.ts:39-42`); emitir sin handlers los
  mandaría a `DEAD_LETTER`. Lo prueba un test.

---

## 5. El agente en una clínica

### 5.1 Tools por rubro

Filtro efectivo (extiende ediciones §6.1):

**`enabledTools ∩ toolsDeLaEdicion ∩ toolsDelRubro ∩ toolsDelNivel`**

En los mismos dos lugares: `toolsHabilitadas` (`agentTools.service.ts:2913`) y
`puedeEjecutarTool` (`agentPermissions.service.ts:84-149`).

| Tool | AUTOMOTORA | CLINICA | Notas |
|---|---|---|---|
| `get_service_types` | ✅ como hoy | ✅ | En CLINICA, con los profesionales (§4.3). |
| `get_availability` | ✅ como hoy | ✅ | En CLINICA, por todos los profesionales de la prestación. |
| `create_booking` | ✅ como hoy | ✅ | En CLINICA, `resourceId` opcional. |
| **`get_contact_bookings`** (nueva) | ❌ | ✅ | Los turnos futuros `CONFIRMED` del contacto de la conversación. |
| **`reschedule_booking`** (nueva) | ❌ | ✅ | Sobre §4.7. |
| **`cancel_booking`** (nueva) | ❌ | ✅ | Sobre `cancelBooking`. |
| `get_contact_info`, `get_contact_activities` | ✅ | ✅ | |
| `create_lead`, `update_lead` | ✅ | ✅ **acotadas** | Sin `notes` ni `aiData` en CLINICA (§8.2). |
| `update_contact_custom_fields`, `mark_no_interest` | ✅ | ✅ | |
| `get_payment_info` | ✅ | ❌ | Devuelve un link de pago; B7 dice "solo informa". |
| `create_opportunity`, `update_opportunity` | ✅ | ❌ | D3. |
| `search_vehicles`, `reserve_vehicle` | ✅ | ❌ | |
| `request_human_handoff` | siempre | siempre | |

- Las tres tools nuevas viven en `src/clinicas/` y se registran en
  `CATALOGO_DE_TOOLS` (`agentTools.service.ts:2890`). Como
  `toolsDelRubro(AUTOMOTORA)` no las incluye, **un agente de automotora no las
  ve ni las puede ejecutar** aunque alguien las ponga en `enabledTools`. El
  formulario del agente de una automotora no las muestra. Lo fija un test.
- En CLINICA, las versiones de `get_service_types`, `get_availability` y
  `create_booking` son las de clínicas (wrappers del módulo de clínicas). Para
  AUTOMOTORA siguen siendo las de hoy, sin cambios.
- **Reglas de las tools nuevas, en el backend:**
  - el turno tiene que ser del **contacto de la conversación**; uno de otro
    contacto da el mismo error que uno inexistente (sin oráculo);
  - pasan por el candado de identidad (`bloqueoPorIdentidad`,
    `agentTools.service.ts:175-184`);
  - **anticipación mínima (D10):** `ClinicBranchSettings.minHoursToChangeBooking`.
    Sin valor, no hay plazo. Con valor, dentro del plazo la tool devuelve
    `{ ok: false }` y el agente deriva. La política de cancelación es de la
    clínica; el agente no la negocia;
  - el tope `MAX_RESERVAS_FUTURAS_POR_CONTACTO = 2`
    (`agentTools.service.ts:192`) sigue igual. Reprogramar no lo consume.

> **Implementado en R11.** Cómo quedó, y dónde difiere de lo de arriba:
>
> - **Las tres tools NO están en `CATALOGO_DE_TOOLS`** (se aparta de lo de
>   arriba): ese catálogo también arma el selector de `accionesProhibidas` y el
>   prompt de traducción de guardrails, que una automotora usa. Viven en
>   `src/clinicas/toolsDeTurnos.ts` y entran por
>   `ReglasDelRubro.toolsExclusivas`; su módulo es `agenda_clinica`
>   (`MODULO_DE_LA_TOOL_DE_CLINICA` en `config/ediciones.ts`), y
>   `toolDelRubro(AUTOMOTORA)` da `false` para ellas. Consecuencia: en una
>   clínica, la traducción de guardrails todavía no puede prohibirlas por
>   nombre (se sacan de `enabledTools`).
> - **Nivel:** solo AUTONOMA (no están en `TOOLS_DE_PRIMER_CONTACTO`).
> - **Reglas, en este orden**, iguales para reprogramar y cancelar: candado de
>   identidad (antes de mirar el turno), turno del contacto **y de la sede** de
>   la conversación (si no, el mismo error que uno inexistente), `CONFIRMED` y
>   futuro, y `minHoursToChangeBooking` contra el horario actual del turno.
>   `get_contact_bookings` también pasa por el candado de identidad.
> - **Reprogramar** llama a `reprogramarTurno` como una Recepción de la sede
>   de la conversación, sin `isOverbooking` ni `force` (la tool no los
>   acepta): nunca un sobreturno. **Cancelar** usa `cancelBooking` y suma la
>   nota en su misma transacción. Los eventos (`booking.rescheduled`,
>   `booking.cancelled`) salen de esos servicios.
> - **Autor:** `Activity.authorId` no admite nulos. La nota la firma el
>   responsable de la conversación, si no la Recepción de la sede, si no el
>   ADMIN más antiguo. Su asunto empieza con `[Asistente] `
>   (`MARCA_DEL_ASISTENTE`) y la pantalla muestra **"Asistente"** como autor,
>   nunca el nombre de esa persona. El cuerpo dice "Reprogramó/Canceló: el
>   asistente".
> - **Textos del prompt (§3.2):** `armarSystemPrompt` recibe `textos` (último
>   parámetro). AUTOMOTORA usa las constantes de siempre
>   (`textosDeAutomotora()`, snapshot byte a byte); CLINICA, las de
>   `src/clinicas/config/textosDelAgente.ts` con el término del contacto, más
>   la instrucción de gestión de turnos si se ofrece alguna de las tres tools.
>   El mensaje de fuga bloqueada y el cierre por tope también son del rubro.
>   Un test busca en el prompt de clínica que no quede ninguna mención a autos,
>   permuta, financiación, vehículos ni "la unidad".
> - **El plazo (D10) se configura** en el formulario de la sede, sección "Turnos
>   por chat", solo ADMIN: `GET`/`PUT /api/clinica/sedes/:branchId/configuracion`
>   (módulo `agenda_clinica`), entero de 0 a 8760 o `null`. Sin valor por
>   defecto: una sede nueva no tiene plazo.
> - **Detector de salud:** "costra*" con un error de tipeo agarraba "contraoferta",
>   "contrato" o "en contra" (la raíz con tolerancia se comparaba contra el
>   comienzo de cualquier palabra). Ahora, con un error de tipeo, lo que sigue a
>   la raíz tiene que ser una terminación (`TERMINACIONES_CON_TOLERANCIA`).

### 5.2 Agendar con los niveles de IA (D2)

**Decidido:** la clínica agenda con el agente en **AUTONOMA**, con las tools
filtradas por rubro (§5.1). **PRIMER_CONTACTO no cambia y ediciones queda
igual:** sigue sin `create_booking`, con el tope de 2 respuestas (ediciones
D12). En una clínica, PRIMER_CONTACTO significa "toma los datos y recepción
agenda", y el formulario del agente de clínicas lo dice así.

- La elección del nivel sigue siendo del ADMIN y obligatoria en ESENCIAL
  (ediciones D3).
- **SOLO_SEGUIMIENTO** en una clínica: el agente no conversa. Los recordatorios
  y la confirmación por botón **siguen funcionando**, porque no usan el modelo
  (§6).
- Los guardrails de salud (§5.3) valen en **todos** los niveles.

### 5.3 Guardrails de salud, en el backend (D11)

> **Pendiente (decisión de Rocco del 2026-10-10):** las preguntas comunes que
> hoy la capa 1 deriva a propósito ("¿la depilación duele?") y que el agente
> podría contestar con lo cargado en la base de conocimiento van en un **PR chico
> aparte del detector**, cuando la lista de términos esté revisada por un
> profesional de salud. No entran en R18.

> **Implementado en R4.** Cómo quedó, y dónde difiere de lo de abajo:
>
> - **Los puntos de extensión** son `src/services/reglasDelRubro.ts`: por rubro,
>   una lista de verificadores de entrada **prioritarios** (la urgencia, que
>   corren antes del gate de una persona atendiendo y también sin agente),
>   otra de entrada (la consulta clínica), otra de salida (capa 3), si el
>   agente calla después de derivar, las instrucciones fijas del prompt y los
>   argumentos que las tools no ofrecen. AUTOMOTORA es `SIN_REGLAS`: todo vacío.
>   Las de CLINICA están en `src/clinicas/reglasDeClinica.ts`.
> - **Los mensajes fijos** están en `src/clinicas/config/mensajesDeSalud.ts`,
>   no en `rubro.ts`: R3, en paralelo, crea `rubro.ts` con el vocabulario.
> - **Capa 2:** `armarSystemPrompt` recibe un último parámetro,
>   `instruccionesDelRubro`, que va antes de la instrucción de identidad. Vacío
>   en AUTOMOTORA, así que el prompt es el mismo byte a byte (snapshot de
>   §14.1). El objeto `textos` de §3.2 llegó en R11 (ver la nota de §5.1).
> - **"Prioridad alta"**: `Activity` no tiene una columna de prioridad, y R4 no
>   lleva migración. La tarea de una urgencia empieza con `URGENTE · `, vence
>   en el acto (`dueDate` = ahora), no reutiliza una tarea abierta y se crea
>   aunque la conversación ya estuviera derivada. Si sin agente asignado
>   tampoco hay vendedor, va al ADMIN activo más antiguo.
> - **El silencio** no usa una columna: la respuesta fija se guarda con una
>   marca `regla_del_rubro` en `Message.toolCalls`. Si la conversación está
>   derivada y el último saliente del agente tiene la marca, el agente calla.
>   "Devolver al agente" la pasa a ACTIVE y el agente vuelve.
> - **Ráfagas:** la capa 1 mira todo lo que escribió el contacto desde la
>   última vez que le habló el negocio, no solo el último mensaje.
> - **La derivación que pide el modelo:** si su `reason` dispara la capa 1 (por
>   ejemplo, "consulta clínica"), la tarea lleva el aviso fijo y no el
>   `reason`.
> - **Sin agente:** un webhook con el agente apagado encola igual el mensaje si
>   el rubro tiene una regla prioritaria. El worker llama a
>   `derivarEntranteSinAgente` con `responder`: con una urgencia guarda y manda
>   el texto fijo; con otra cosa, deriva como siempre.
> - **SOLO_SEGUIMIENTO** todavía no existe en el código (PR 6 de ediciones).
>   La urgencia corre antes que cualquier filtro por nivel, así que vale
>   cualquiera sea. El test lo fija con un agente en SOLO_SEGUIMIENTO.

**Regla:** en CLINICA, en **todos** los niveles y **todos** los canales
(incluido el widget web), el agente no da historia clínica, diagnósticos ni
consejos médicos. Tres capas. **Ninguna es configurable por el ADMIN.** En
AUTOMOTORA no corre ninguna: el loop de una automotora es el de hoy.

**Cómo se engancha sin ensuciar el núcleo:** el loop
(`responderEnLaConversacion`) gana dos **puntos de extensión** genéricos, uno
antes del modelo y otro sobre la respuesta, que reciben una lista de
verificadores según el rubro. Para AUTOMOTORA la lista está vacía. Para CLINICA
trae los de `src/clinicas/guardrailsDeSalud.ts`. Es un arreglo del núcleo que
se hace una vez (§0.3): el día que otro rubro necesite reglas propias, usa los
mismos puntos.

#### Capa 1: antes del modelo (entrante)

Un detector **determinístico**, puro y sin red.

| Resultado | Qué hace | Ejemplos (no exhaustivos) |
|---|---|---|
| `URGENCIA` | Responde el **mensaje fijo de urgencia** y deriva con motivo `URGENCIA_DE_SALUD`. **No llama al modelo.** La tarea sale con prioridad alta. | "no puedo respirar", "se me hinchó la cara / la lengua / los labios", "dolor en el pecho", "me desmayé", "sangra mucho", ideas de hacerse daño |
| `CLINICA` | Responde el **mensaje fijo de derivación clínica** y deriva con motivo `CONSULTA_CLINICA`. **No llama al modelo.** | Síntomas o reacciones ("me salió", "me arde", "me quedó rojo", "se infectó"), medicación ("¿puedo tomar…?"), "¿es normal que…?", embarazo o lactancia, diagnóstico ("¿qué tengo?") |
| `NINGUNO` | Sigue el loop. | "¿cuánto sale la limpieza facial?", "quiero un turno el martes" |

- **Normalización:** minúsculas, sin tildes, sin signos, espacios colapsados,
  letras repetidas reducidas ("ardeeee").
- **Lista de términos en código** (D11): cambiarla es un PR con tests. La lista
  final la revisa una persona del área de salud antes del primer cliente
  (§10).
- **Un falso positivo es aceptable; un falso negativo no.** Por eso la lista es
  amplia.
- **La urgencia gana** sobre `humanoAtiendeLaConversacion`, sobre el horario y
  sobre el nivel. Con SOLO_SEGUIMIENTO o con el agente apagado, el camino de
  `derivarEntranteSinAgente` también corre el verificador de urgencia (por el
  mismo punto de extensión) y manda el texto fijo.
- **Después de una derivación clínica, el agente calla en esa conversación**
  hasta que una persona la devuelva (`return-to-agent`).

#### Capa 2: el prompt

Una instrucción fija del rubro (`INSTRUCCION_SALUD`): no diagnosticar, no indicar
tratamientos ni medicación, no interpretar síntomas, y llamar a
`request_human_handoff` con motivo clínico ante la duda. **No es la garantía.**

#### Capa 3: después del modelo (saliente)

`daIndicacionClinica(texto)`, en el punto de extensión de salida, después de
`revelaInstrucciones` y `mencionaUnaTool`
(`agentOrchestration.service.ts:2391-2448`). Detecta dosis ("mg", "cada 8
horas"), indicaciones sobre el cuerpo ("aplicate", "tomá", "suspendé") y
frases diagnósticas ("parece ser", "es normal que"). Si da positivo, la
respuesta **no sale**: se reemplaza por el mensaje fijo de derivación clínica y
se deriva. Queda en `Message.toolCalls` para auditar.

#### Mensajes fijos

En `src/clinicas/config/rubro.ts`, con el nombre de la clínica como única
variable. Borradores:

- **Urgencia:** "Si es una urgencia, llamá ya al 911 o a tu servicio de
  emergencia móvil. Este chat no puede ayudarte con eso. Ya le avisamos al
  equipo de {clinica}."
- **Consulta clínica:** "Esa consulta la tiene que ver un profesional. Por acá
  no podemos darte indicaciones médicas. Ya le pasamos tu mensaje al equipo de
  {clinica} para que te contacte."

El texto exacto y el número de emergencias los valida la clínica y un
profesional (§10).

#### Lo que no hace

- No guarda una etiqueta "síntoma X" en el contacto. La derivación dice
  "consulta clínica: ver la conversación" y nada más (§8.2).
- No usa un segundo modelo como clasificador en la v1 (D11).

#### Tests

- **Detector:** tabla de frases positivas y negativas por categoría, con y sin
  tildes, con errores de tipeo y letras repetidas. Un caso por término.
- **Filtro saliente:** dosis e indicaciones se bloquean; turnos y precios pasan.
- **Loop:** con un proveedor falso que falla si lo llaman, `URGENCIA` y
  `CLINICA` no lo llaman, derivan con el motivo, mandan exactamente la
  constante, y el turno siguiente sigue callado. Igual por el widget.
- **Composición:** `URGENCIA` con SOLO_SEGUIMIENTO, con el agente inactivo y con
  una persona atendiendo.
- **Automotora sin cambios:** en AUTOMOTORA, un mensaje "me arde la garganta"
  llega al modelo como hoy.

### 5.4 Indicaciones antes y después de un tratamiento (D5)

Se responden **solo desde la base de conocimiento**:

- `KnowledgeBaseEntry.kind` (`GENERAL` \| `INDICACIONES`), columna aditiva con
  default `GENERAL`. Las automotoras no ven el selector y todas sus entradas
  siguen siendo `GENERAL`.
- La clínica carga, por ejemplo, "Antes de la depilación láser". El agente
  puede **transcribirlas**, sin agregar ni interpretar. El prompt las pone en un
  bloque aparte con la instrucción "transcribí, no expliques".
- Si la pregunta trae un síntoma o un "¿es normal?", la capa 1 la deriva antes
  de llegar al modelo. La capa 3 es la red si el modelo parafrasea de más.
- La pantalla avisa: "Lo que cargues acá lo puede repetir el agente
  textualmente".

> **Implementado en R18.** Migración `clinicas_indicaciones_kb`: enum
> `KnowledgeBaseEntryKind` y la columna `kind` con default `GENERAL` (sin
> CHECK ni FK nuevas). El controller rechaza `kind` en una automotora (400) y
> lo saca de sus respuestas (`CAMPOS_DE_CLINICA.knowledgeBaseEntry`). El
> prompt arma un bloque aparte, después de la base de conocimiento general, con
> el encabezado `ENCABEZADO_INDICACIONES`. Sigue el límite por sede de siempre
> (las entradas son de la sucursal del agente). Las FAQs que hoy deriva la capa
> 1 no entran en R18 (pendiente en §5.3).

### 5.5 Precios, medios de pago y mutualistas (B7)

Van a la base de conocimiento. El agente informa lo que está cargado y, si no
está, dice que lo confirma recepción. No hay tool de cobro ni de seña.

### 5.6 Test drive

No es una entidad. Lo único automotor son los ejemplos de las descripciones de
las tools y el texto por defecto del seguimiento de consultas. En CLINICA salen
de la configuración del rubro. En AUTOMOTORA no cambian.

---

## 6. Recordatorios y confirmación (B8, D8, D13)

**Solo CLINICA en la v1 (D13).** Módulo `recordatorios_de_turno`. Las
automotoras no tienen la tabla, las rutas, el trigger ni las plantillas.

> **Implementado en R13** (migración `20261109120000_clinicas_recordatorios`).
> Cómo quedó, y dónde difiere de lo de abajo:
>
> - **Módulo `recordatorios_de_turno`** (SOLO_CLINICA, sin rutas propias). El
>   trigger `booking.reminder_due` y la acción `booking.send_reminder` llevan su
>   módulo (`MODULO_DEL_TRIGGER`, `AccionRegistrada.modulo`). Para una
>   automotora no existen: el CRUD le da el 400 de siempre ("no existe"), con
>   la lista de siempre.
> - **La regla guarda la plantilla y si está activa.** Nadie emite
>   `booking.reminder_due`: el recordatorio lo agendan los consumidores de los
>   eventos de R10 (`registrarEventosDeTurno`). `created` programa,
>   `rescheduled` cancela el del horario viejo y agenda el nuevo (por el evento,
>   no dentro de `reprogramarTurno` como decía §4.7), `cancelled` anula, y
>   `completed`/`no_show` no hacen nada.
> - **Idempotente por turno y por horario:** `booking_messages` tiene
>   `booking_starts_at` (el horario que recuerda) y un UNIQUE parcial
>   `(booking_id, kind, booking_starts_at)` mientras esté PENDING o SENT.
> - **Variables:** una sola `{lugar}` armada por el backend (la clínica, o
>   "Clínica X (sede Y)" con más de una sede; decisión de Rocco del
>   2026-10-10) en lugar de `{clinica}`, más `{nombre}`, `{dia}`, `{hora}` y
>   `{profesional}`. **Sin `{prestacion}`** en R13 (decisión del 2026-10-10).
> - **La respuesta del botón:** el webhook lee el `payload` y el
>   `context.id` y marca la respuesta en `booking_messages` (CAS, en la misma
>   transacción que el entrante y su job). El worker de turnos del agente la
>   resuelve antes que nada, sin el modelo, y manda el texto fijo. Cancelar
>   usa `cancelBooking` con la tarea en su misma transacción.
> - **Sin respuesta:** la tarea va a `min(envío + noResponseTaskHours, turno −
>   2 h)` a la Recepción de la sede (§11.4). Con el turno a menos de 2 h no hay
>   tarea (decisión del 2026-10-10).
> - **Borrados:** las FKs son RESTRICT y no se disparan en el uso normal (las
>   reglas y los contactos tienen soft delete; el borrado de datos personales
>   anonimiza la fila; los turnos no se borran). Desactivar o borrar la regla
>   cancela sus pendientes en la misma transacción; borrar los datos de un
>   paciente cancela los suyos y limpia el `last_error`. `last_error` va sin
>   tokens y cortado a 500 caracteres.
> - **En el calendario,** solo "Confirmado por el paciente" en el detalle del
>   turno; las marcas "sin confirmar" y "sin recordatorio" quedan para R17.

### 6.1 Modelo: una cola de mensajes del turno

```prisma
enum BookingMessageKind {
  REMINDER   // §6
  // CONTROL y REVIEW_QR se agregan en R14 (§7), con su migración:
  // un valor de enum que el backend no sabe ejecutar es una trampa (ediciones §1.2).
}

enum BookingMessageStatus {
  PENDING
  SENT
  FAILED
  CANCELLED
}

model BookingMessage {
  id                String
  organizationId    String
  bookingId         String   // el turno que se recuerda (en CONTROL y REVIEW_QR, el atendido)
  contactId         String
  automationId      String   // la regla de automatización, de donde sale la plantilla
  kind              BookingMessageKind
  scheduledFor      DateTime
  status            BookingMessageStatus @default(PENDING)
  attempts          Int      @default(0)
  nextAttemptAt     DateTime?
  lastError         String?
  sentAt            DateTime?
  externalMessageId String?  // wamid, para cruzar la respuesta (§6.4)
  // único parcial: (bookingId, kind) mientras esté PENDING o SENT
}

model Booking {
  // ...
  patientConfirmedAt DateTime? // aditiva: el paciente tocó "Confirmo"
}
```

- **"Confirmado por el paciente" no es un estado nuevo.** `CONFIRMED` ya significa
  "turno dado" y toda la capacidad cuenta sobre él. Una columna alcanza.
- Es una **tabla de cola propia de clínicas**, con el patrón de `QrFollowUp`
  (reclamar, reintentar, cancelar), y la usan también el post-turno (§7).
  Tabla nueva: RLS, H-01, fila 5 del diagnóstico y FK a `contacts` (inventario
  de `contactMerge`).

### 6.2 Cuándo se agenda (D8: configurable por sucursal)

Configuración en `ClinicBranchSettings` (§1.3), editable por el ADMIN en la
tarjeta "Recordatorios" de la sede:

| Campo | Default | Qué controla |
|---|---|---|
| `reminderHoursBefore` | **24** | Cuántas horas antes del turno sale el recordatorio (1 a 72). |
| `lateBookingReminder` | **`NO_ENVIAR`** | Qué hacer con un turno dado con **menos** anticipación que `reminderHoursBefore`. |
| `lateBookingHoursBefore` | 2 | Solo con `HORAS_ANTES`: cuántas horas antes (1 a 23). |

Las tres opciones para un turno dado con poca anticipación:

- **`NO_ENVIAR`** (default): no hay recordatorio. La confirmación se acaba de
  dar en esa conversación.
- **`EN_EL_MOMENTO`**: el recordatorio sale enseguida, con los mismos botones.
- **`HORAS_ANTES`**: sale `lateBookingHoursBefore` horas antes del turno. Si
  ese momento ya pasó, no sale.

Reglas:

- Handler de `booking.created` y `booking.rescheduled` (solo CLINICA, §4.8):
  calcula `scheduledFor` con la configuración **vigente en ese momento** y
  agenda o mueve el `REMINDER`. Cambiar la configuración no recalcula lo que ya
  está agendado.
- `booking.cancelled` cancela los pendientes.
- **Al enviar**, el worker revalida: el turno sigue `CONFIRMED`, el horario es
  el mismo y el contacto tiene WhatsApp. Si algo cambió, cancela la fila con el
  motivo.
- El recordatorio sale aunque la sede esté cerrada: un turno de las 8:00 se
  recuerda a las 8:00 del día anterior.
- Solo WhatsApp en la v1. Sin WhatsApp o sin teléfono, el turno muestra "sin
  recordatorio".

### 6.3 La plantilla

**Categoría `UTILITY`.** Meta clasifica como utility los mensajes que no tienen
intención promocional y son específicos de una transacción o un pedido del
usuario. Un recordatorio de un turno que el paciente pidió encaja. Un mensaje
que mezcla contenido utilitario con promoción pasa a ser `MARKETING`, y Meta
puede recategorizar a marketing una plantilla utility ya aprobada. Según
fuentes secundarias, desde abril de 2025 una plantilla utility que Meta
considera promocional se **aprueba como marketing** (y se cobra como tal) en
lugar de rechazarse. Por eso:

- **La plantilla no lleva nada más que el turno.**
- **No lleva el nombre de la prestación por defecto.** "Tu turno de control de
  lunares" es un dato de salud visible en la pantalla del teléfono. La variable
  existe y la clínica la puede activar (§10, punto 11).
- Borrador: "Hola {nombre}, te recordamos tu turno en {clinica} el {dia} a las
  {hora} con {profesional}. ¿Nos confirmás si venís?". Botones: **Confirmo** /
  **Necesito cancelar**.

**Lo que hay que construir** (sin cambiar lo que mandan las automotoras):

| Pieza | Hoy | Falta |
|---|---|---|
| Categoría `UTILITY` | Existe el tipo (`whatsappGraph.service.ts:289`); las tres acciones usan `MARKETING` (`whatsappTemplate.service.ts:231-235`) | La acción del recordatorio, que vive en el catálogo de clínicas, declara `UTILITY`. Las tres de hoy no cambian. |
| Botones `QUICK_REPLY` | `cuerpoDeAltaDePlantilla` arma HEADER y BODY (`whatsappGraph.service.ts:324-355`) | Un componente `BUTTONS` **opcional**, con payload fijo (`CONFIRMAR`, `CANCELAR`). Sin botones, el cuerpo que se manda a Meta es **idéntico** al de hoy (test). |
| Leer la respuesta del botón | Se lee el **texto** y se pasa al agente (`whatsappWebhook.service.ts:163-167`, `263-274`) | Leer el **payload** y el `context.id`. Solo si el `context.id` coincide con un `BookingMessage` enviado, se resuelve sin el agente (§6.4). Si no, todo sigue como hoy: una automotora no tiene filas en esa tabla, así que su camino no cambia (test). |
| Plantilla por regla de automatización | `WhatsappTemplate.automationId` (`schema.prisma:3382-3420`) | La plantilla cuelga de una regla del trigger de clínicas `booking.reminder_due`. Reusa la sincronización con Meta y la tarjeta de la regla. |

**Costo:** una fuente secundaria (no de Meta) indica que desde el 1 de octubre
de 2026 cambian las reglas de cobro de las plantillas utility enviadas dentro de
la ventana de servicio. No se verificó en la documentación de Meta. Antes de
fijar el precio para una clínica hay que confirmar la tarifa vigente para
Uruguay.

### 6.4 Qué pasa con la respuesta

| Respuesta | Qué hace el backend | ¿Modelo? |
|---|---|---|
| **Confirmo** | `patientConfirmedAt = now()`, texto fijo ("¡Gracias! Te esperamos"), nota en el contacto, y cierra la tarea de §6.5 si existía. | No |
| **Necesito cancelar** | `cancelBooking`, texto fijo que ofrece reprogramar y una tarea para recepción. Respeta `minHoursToChangeBooking`: dentro del plazo no cancela y deriva. | No |
| Texto libre | Entra al loop normal con los turnos futuros en el contexto. Depende del nivel (§5.2); los guardrails corren igual. | Según el nivel |
| Nada | §6.5. | No |

- El botón se cruza con **el turno del recordatorio** (por el `context.id`, que
  es el wamid guardado en `externalMessageId`), no con "el próximo turno del
  contacto".
- La respuesta del paciente abre la ventana de 24 h, así que los textos fijos son
  mensajes libres dentro de la ventana.
- Funciona con **cualquier nivel de IA** y con el agente apagado.

### 6.5 Si no responde: tarea y aviso a recepción

- Pasadas `noResponseTaskHours` (default 4) desde el envío, o 2 h antes del
  turno si eso es antes, sin confirmación ni cancelación → **tarea** "Confirmar
  por teléfono el turno de {paciente} de mañana a las {hora}".
- **El turno no se cancela** (B8).
- Una sola tarea por turno. Si el paciente confirma después, se cierra sola
  (con la idea de `findTareaAbiertaDelPedido`, `tareaDelPedido.ts:45`).
- **A quién va (D15):**
  - **Transición, mientras no exista el rol Recepción (R12):** al
    **"Responsable por defecto"** de la sede (`Branch.defaultOwnerId`) y, si no
    hay, al ADMIN más antiguo (`avisoSinRespuesta.service.ts:197`).
  - **Con el rol Recepción:** ver §11.4.
- **"Aviso":** no hay modelo de notificaciones; la tarea **es** el aviso
  (`docs/ai-agent-architecture.md` §6). El calendario muestra el turno con la
  marca "sin confirmar".

### 6.6 Políticas de Meta: lo que hay que verificar antes del primer cliente

Leído en la política de mensajería de WhatsApp Business (actualizada el
2026-09-23) y en la guía de categorías de plantillas. **No es una interpretación
legal.** Hay que confirmarlo con Meta o con el proveedor (BSP) antes de conectar
el número de una clínica.

1. **"Medical and healthcare products"** figura en la lista de bienes y
   servicios que no se pueden comprar, vender, promocionar ni facilitar por
   WhatsApp. La política no aclara si alcanza a los **servicios** de una clínica
   de estética. Es el riesgo más grande del rubro: si alcanza, WhatsApp no sirve
   para clínicas.
2. **Información de salud:** no usar WhatsApp para telemedicina ni para enviar o
   pedir información de salud **cuando las normas aplicables prohíban
   distribuirla** a sistemas sin requisitos reforzados. La minimización de §8
   va en esa dirección.
3. **Opt-in:** hace falta el teléfono **y** el permiso del destinatario. Meta
   recomienda opt-ins separados por tipo de mensaje. El aviso del primer
   contacto (§8.1) es el lugar natural.
4. **Salida a una persona:** obligatoria; ya existe.
5. **Categorías:** recordatorio = utility; reseña y control = marketing (§7). Un
   paciente que apagó el marketing no recibe el control ni la reseña, pero sí el
   recordatorio.

---

## 7. Después del turno (B9)

> **Implementado en R14** (migración `20261110120000_clinicas_post_turno`).
> Cómo quedó, y dónde difiere de lo de abajo:
>
> - **Módulo `post_turno`** (SOLO_CLINICA). Trigger `booking.completed` en el
>   motor (lo emite R10 al marcar Atendido o al cerrar solo) con dos acciones:
>   `booking.send_qr_review` y `booking.schedule_control`. Para una automotora
>   no existen (el 400 de siempre). `booking.no_show` (también una corrección a
>   No vino) cancela el QR y el control pendientes del turno.
> - **QR de reseña:** la misma configuración que el de una automotora (QR,
>   demora con mínimo 3 h, formato y texto con `{nombre}`/`{link}`). **Después de
>   un cierre automático sale 24 h después del cierre** (decisión de Rocco del
>   2026-10-10), no con la demora de la regla.
> - **Control:** `ServiceType.followUpAfterDays` (1 a 730, CHECK), editable en
>   Prestaciones (`PUT /api/clinica/prestaciones/:id/control`, solo ADMIN). Texto
>   con `{nombre}`, `{semanas}` (N/7 redondeado, al menos 1) y `{lugar}` (el de
>   R13) en lugar de `{clinica}`.
> - **Idempotente por turno:** los dos van a `booking_messages` con `kind`
>   `REVIEW_QR` / `CONTROL`; el UNIQUE parcial de R13 (turno, tipo, horario)
>   hace que una reentrega no duplique y que **lo enviado nunca se reenvíe** (un
>   SENT sigue vigente). Una corrección a Atendido después de un No vino vuelve
>   a agendar lo que no salió.
> - **Envío:** el worker de R13, siempre con la plantilla aprobada (MARKETING),
>   dentro del horario de la sede (se pospone sin gastar el intento). Revalida
>   antes: QR y control solo con el turno COMPLETED; el control, además, sin
>   turno futuro de esa prestación y sin "sin interés".

Módulo `post_turno`, solo CLINICA. **No toca `QrFollowUp`, sus acciones ni su
worker:** el QR de una automotora sigue colgando de `opportunity.won`, como hoy
(ediciones §3).

### 7.1 QR de reseña con "turno atendido"

- Trigger de clínicas `booking.completed` ("Cuando se atiende un turno") y
  acción de clínicas `booking.send_qr_review`, con la misma configuración que la
  de automotoras (`qrCodeId`, demora, texto).
- Se agenda como `BookingMessage` con `kind = REVIEW_QR` (el valor entra con su
  migración en R14).
- **El envío reusa las piezas del núcleo**, no las copia: `sendWhatsappTemplateReal`
  con el header de imagen del QR, y `findApprovedWhatsappTemplate`. Lo que es de
  clínicas es la cola y la revalidación.
- **Revalidación al enviar:** el turno sigue `COMPLETED`. Un "No vino" marcado
  después del cierre automático cancela el envío.
- La demora mínima en clínicas es de 3 h, para dar tiempo a corregir un "No
  vino".
- **Plantilla `MARKETING`**, como las de hoy.

### 7.2 Recordatorio de control

```prisma
model ServiceType {
  // ...
  followUpAfterDays Int? // aditiva; "Recordar control a los N días". null = sin control
}
```

- Handler de `booking.completed`: si la prestación tiene `followUpAfterDays`,
  agenda un `BookingMessage` `CONTROL` para `completedAt + N días`, en horario de
  la sede.
- **Al enviar**, cancela si el paciente ya tiene un turno futuro de esa
  prestación, si está marcado "sin interés" o si el turno de origen pasó a
  `NO_SHOW`.
- **Plantilla `MARKETING`**, sin dato clínico: "Hola {nombre}, ya pasaron
  {semanas} semanas desde tu último turno en {clinica}. Si querés agendar el
  próximo, escribinos por acá."
- Sin botones en la v1. La respuesta entra al loop.

### 7.3 Catálogo de automatizaciones de clínica

| Trigger | Rótulo | Acciones |
|---|---|---|
| `booking.reminder_due` | "Recordatorio antes del turno" | `booking.send_reminder` (UTILITY, con botones) |
| `booking.completed` | "Cuando se atiende un turno" | `booking.send_qr_review`, `booking.schedule_control`, `activity.create_follow_up` |
| `contact.inquiry_stalled` | "Cuando una consulta queda sin respuesta" | `inquiry.follow_up` (con el filtro de turnos, §9) |

- **Tarea después del turno** (`activity.create_follow_up` sobre
  `booking.completed`, PR aparte de R14 por decisión de Rocco del 2026-10-10):
  la misma acción de la venta ganada, que con el evento de un turno delega en
  `src/clinicas/postTurno/tarea.ts`. La tarea va a la recepción de la sede del
  turno (§11.4), con el paciente y la sede, y vence a N días desde que se marcó
  atendido. `activities.source_booking_id` y `source_automation_id` (migración
  `clinicas_tarea_post_turno`) con el índice único parcial
  `activities_follow_up_por_turno_key`: una tarea por regla y por turno. Si el
  turno se corrige a "No vino", la tarea abierta se cierra sola con una nota;
  si vuelve a "Atendido", se reabre. Una automotora no ve las columnas
  (`CAMPOS_DE_CLINICA.activity`).
- Los triggers y acciones de clínicas se registran en el motor con su módulo
  (ediciones §8). `modulosDe` los saca del catálogo de una automotora, y
  `opportunity.won` y `opportunity.stale` del de una clínica.
- Registrar triggers y acciones nuevos rompe los tests de catálogo
  (`automationOpportunityWon.integration-test.ts`, `automationActions.test.ts`):
  se actualizan en el mismo PR. **El catálogo que ve una automotora es el de
  hoy** (test).

---

## 8. Consentimiento y privacidad

### 8.1 Aviso en el primer contacto

- `ClinicSettings.privacyNoticeText` y `privacyPolicyUrl`, cargados por el
  ADMIN. Obligatorios para **activar** un agente en CLINICA (mismo patrón que
  "Nivel sin elegir", ediciones §1.2: se puede guardar, no activar).
- Se manda **una vez por contacto**, antes de la primera respuesta del agente,
  como mensaje aparte. Se guarda `Contact.privacyNoticeSentAt` (columna
  aditiva, nullable; solo la escribe código de clínicas).
- Si el primer mensaje cae en `URGENCIA`, primero va el mensaje de urgencia.
- El aviso **informa**. Si además hace falta un consentimiento expreso, y cómo
  se registra, lo responde el profesional legal (§10).

> **Implementado en R16.** El aviso es un `Message` de AUTOMATION con
> `noticeType = PRIVACY_NOTICE` (valor nuevo del enum), creado justo antes de la
> respuesta del modelo. `privacyNoticeSentAt` se escribe con un CAS (solo si
> estaba en NULL) en la misma transacción: dos turnos a la vez no mandan dos
> avisos. El worker de WhatsApp manda los avisos sin enviar antes de la
> respuesta, también en un reintento. En el widget web, la respuesta del POST
> trae `avisoDePrivacidad` y el widget lo pinta primero; el sondeo no lo
> repite. No sale con la respuesta fija de una regla del rubro (urgencia o
> derivación clínica). Unir contactos conserva la fecha más vieja. Borrar el
> aviso o el link con agentes activos da 409. El texto de ejemplo de la
> pantalla es un borrador (no asesoramiento legal) que se carga con un botón y
> no se guarda solo. **Pendiente:** la revisión profesional de §10 antes del
> primer cliente real.

### 8.2 Qué datos se guardan y dónde

| Dato | Dónde | Clínica |
|---|---|---|
| Nombre, teléfono, email | `Contact` | Sí (mínimo de B11) |
| Prestación de interés | `Contact.leadServiceOfInterest` | Sí |
| Turno (prestación, profesional, fecha) | `Booking` | Sí |
| Motivo clínico, síntomas | **Ningún campo** | No (B11) |
| Lo que el paciente escribe | `Message.content` | Inevitable: es la transcripción |

Para que "sin motivo clínico" sea real:

- **`update_lead` sin texto libre en CLINICA** (sin `notes` ni `aiData`).
- **Derivación sin resumen:** con motivo `CONSULTA_CLINICA` o
  `URGENCIA_DE_SALUD`, la tarea de derivación (`crearActivityDeAviso`,
  `agentOrchestration.service.ts:1562`) lleva un asunto y un cuerpo **fijos**.
  Lo decide el punto de extensión de §5.3. Las derivaciones de una automotora
  siguen con su brief.
- **`Booking` no tiene notas**, y no se le agregan.
- **Campos personalizados:** la pantalla de clínicas avisa que no se carguen
  datos de salud. No se puede impedir del todo; queda escrito como límite.
- **`docs/data-classification.md`:** `Message.content` y el texto libre de
  `Activity` de una organización CLINICA pasan a ser **Regulated por
  naturaleza**. Se actualiza en el PR de los guardrails.

### 8.3 Terceros que reciben mensajes

Cada mensaje que el agente procesa va al proveedor de LLM y la base está en
Supabase. Con datos de salud, eso es un tercero que recibe datos sensibles y,
según dónde procese, una transferencia internacional. `data-classification.md`
§4 dice "Compartir con terceros: no aplica"; para CLINICA deja de ser cierto.
Va a la lista de §10.

---

## 9. Seguimientos (#446) y niveles de IA en un rubro de turnos

### 9.1 El seguimiento de consultas estancadas

Hoy (`inquiryFollowUp.repository.ts:58-126`) elige contactos con la consulta sin
respuesta y **sin oportunidad OPEN**, y no mira los turnos.

**Solo en CLINICA** (decidido sobre R13):

1. **Filtro por turnos:** se excluye al contacto con un turno `CONFIRMED` futuro o
   atendido en los últimos `daysSinceLastMessage` días. En la barrida, en la
   acción y en el worker antes de enviar (donde hoy se mira la oportunidad). El
   filtro se agrega **solo cuando la organización es CLINICA**; la consulta que
   corre para una automotora es la de hoy (test con una automotora con un
   test drive agendado: el seguimiento sale igual que hoy).
2. **Texto y variables del rubro:** en CLINICA, `{prestacion}` (de
   `leadServiceOfInterest`), con el respaldo "lo que consultaste". El texto por
   defecto de una automotora (`inquiryFollowUp.ts:61`) no cambia.
3. **Siempre la plantilla (D7):** en CLINICA el seguimiento nunca manda texto
   libre de la IA, tampoco en AUTONOMA. Es más estricto que ediciones D9 y lo
   compone ("el lado de menos IA"). En AUTOMOTORA sigue ediciones D9.

> **Implementado en R15** (sin migración). Cómo quedó:
>
> - **Filtro:** `src/clinicas/seguimientoDeConsultas.ts`. Se excluye al contacto
>   con un turno `CONFIRMED` con `startsAt` futuro, o `COMPLETED` (R10) que
>   terminó en los últimos `daysSinceLastMessage` días de la regla. Un `NO_SHOW`
>   o un `CANCELLED` no frenan. Se lee el estado del turno que dejan los
>   servicios de R10 (no se consumen sus eventos: el filtro es una consulta, y el
>   estado del turno es la fuente de verdad). Está en las tres barreras: el
>   barrido (`findStalledInquiries` recibe el filtro solo en CLINICA), la acción
>   y el worker antes de mandar (cancela con su motivo).
> - **Texto y variables:** `{prestacion}` (`TOKEN_PRESTACION`), solo en
>   CLINICA: la acción tiene un schema por rubro (`AccionRegistrada.schemaPorRubro`),
>   que usan el CRUD, el despacho y el alta de la plantilla en Meta
>   (`variablesDeLaAccion` con el rubro). Una clínica no acepta `{vehiculo}` y una
>   automotora no acepta `{prestacion}`. El texto por defecto de clínica es
>   `TEXTO_POR_DEFECTO_DE_CLINICA`; la tarea de los otros canales dice "Le
>   interesa: <prestación>".
> - **D7:** en CLINICA el worker nunca manda texto libre.

### 9.2 Qué hace cada nivel con lo nuevo

| Pieza | AUTONOMA | PRIMER_CONTACTO | SOLO_SEGUIMIENTO | Sin nivel / inactivo |
|---|---|---|---|---|
| Agendar, reprogramar, cancelar por chat | ✅ | ❌ (deriva) | ❌ | ❌ |
| Guardrails de salud | ✅ | ✅ | La urgencia (texto fijo) | La urgencia (texto fijo) |
| Recordatorio y botones | ✅ | ✅ | ✅ | ✅ |
| Texto libre como respuesta al recordatorio | Agente | Agente (2 respuestas) | Deriva | Deriva |
| QR después del turno | ✅ | ✅ | ✅ | ✅ |
| Control | ✅ | ✅ | ✅ | ✅ |
| Seguimiento de consultas | Plantilla (D7) | Plantilla | Plantilla | Plantilla |

**Lo que no usa el modelo no depende del nivel.** El nivel regula cuánto conversa
la IA, no si el sistema manda un recordatorio con una plantilla aprobada.

---

## 10. Ley 18.331 (URCDP): puntos a verificar con un profesional

**Esto no es asesoramiento legal.** Es la lista de preguntas que hay que llevarle
a un profesional con competencia en protección de datos y en normativa sanitaria
uruguaya **antes del primer cliente real**. Ninguna se responde acá, mismo
criterio que `data-classification.md` §6.1.

1. **Datos sensibles.** ¿Qué de lo que guarda el sistema es dato de salud en el
   sentido de la ley? ¿Lo es la prestación de un turno de estética? ¿Y el texto
   que el paciente escribe en el chat?
2. **Consentimiento.** ¿Alcanza un aviso informativo, o hace falta un
   consentimiento expreso (y en qué forma)? ¿Cómo se registra y se prueba?
3. **Roles.** ¿La clínica es responsable de la base y la plataforma encargada
   del tratamiento? ¿Qué contrato hace falta? ¿Qué dice de los subencargados
   (Supabase, el proveedor de LLM, Meta, Google)?
4. **Inscripción de la base** ante la URCDP: ¿quién la hace?
5. **Transferencia internacional.** La base, el LLM, Meta y Google procesan
   fuera de Uruguay. ¿Qué requisitos aplican?
6. **Proveedor de LLM.** ¿Puede recibir mensajes con datos de salud? ¿Hace falta
   uno que no retenga ni entrene con los datos, y cómo se acredita?
7. **Conservación.** ¿Cuánto tiempo se pueden guardar conversaciones y turnos?
   Hoy el CRM no tiene retención (`data-classification.md` §5.1).
8. **Derechos del titular** (acceso, rectificación, supresión, oposición): plazos
   y forma. Hoy acceso y oposición no están soportados mecánicamente.
9. **Historia clínica.** ¿Algo de lo que guarda el CRM podría considerarse parte
   de la historia clínica? El diseño apunta a que no; conviene confirmarlo.
10. **Mensajes fijos.** ¿Quién valida el de urgencia (incluido el número) y el de
    derivación clínica?
11. **Recordatorios.** ¿Puede un recordatorio por WhatsApp nombrar la
    prestación? ¿Y el profesional?
12. **Menores de edad.** ¿Qué pasa si escribe o agenda un menor?
13. **Políticas de Meta** (§6.6): confirmar que una clínica de estética puede
    usar WhatsApp Business para turnos.
14. **Seguridad.** ¿Qué medidas exige la ley para datos sensibles, y alcanza con
    lo de `data-classification.md` §4?
15. **Google Calendar.** Un evento en el calendario de un profesional lleva el
    nombre del paciente y la prestación. ¿Es aceptable, o el evento tiene que
    llevar menos datos?

El resultado de esa consulta va a `docs-privados/` si tiene datos de un cliente,
y las decisiones de diseño que salgan vuelven a este documento.

---

## 11. Roles de una clínica: ADMIN y Recepción (D15, D19, D21)

**En una clínica no hay USER (D21).** Los profesionales no son usuarios: son
recursos de la agenda (§4.2). Las personas que entran al sistema son quienes lo
administran (ADMIN) y quienes atienden la recepción (Recepción). El rol USER
sigue existiendo porque lo usan las automotoras, y para ellas no se borra ni
cambia nada.

> **Implementado en R12 (las sedes llegaron con R20, §11.5).** Cómo quedó, y dónde difiere
> de lo de abajo:
>
> - **Rol:** fila `RECEPCION` en `roles` (migración `20261104120000_rol_recepcion`
>   y seed). `RoleName` y `KNOWN_ROLES` (`types/auth.ts`, exportado) la suman.
>   **Orden de despliegue:** aplicar la migración antes del código es seguro.
>   Una fila en `roles` sin usuarios no la lee nadie: `resolveAuthContext` solo
>   rechaza a un usuario que tiene un rol desconocido, y el código viejo no
>   puede asignarla (su zod acepta solo ADMIN y USER).
> - **`ROLES_POR_RUBRO`** (`config/ediciones.ts`): CLINICA = ADMIN y RECEPCION.
>   `exigirRolDelRubro` da 400 `ROL_NO_DISPONIBLE_EN_EL_RUBRO` en invitaciones
>   y en el cambio de rol. El cambio de rubro (D1) mira los tres roles y, desde
>   R12, también las **invitaciones pendientes** con un rol que el rubro nuevo
>   no admite. `/api/me` suma `rolesAsignables` (los del rubro): los selectores
>   de rol no tienen una tabla propia.
> - **`src/services/permisos.ts`** con `puede(actor, capacidad)`. Solo se
>   reemplazaron los chequeos donde Recepción difiere de USER:
>   `editar_cualquier_contacto` (en `permisosDelVendedor.assertPuedeEditar`; ni
>   ella reasigna) y `atender_cualquier_conversacion`
>   (`puedeAtenderLaConversacion`). Los demás `role === "ADMIN"` quedan como
>   estaban, y Recepción cae del lado de "no ADMIN".
> - **Tareas:** hasta R20 (`Activity.branchId`), Recepción ve y edita las
>   suyas, como un USER. "Las de sus sedes" llega con R20.
> - **Rutas:** ninguna ruta con `authorize` se le abre a Recepción en R12.
>   `authorize()` lleva sus roles en el middleware (`rolesDeAuthorize`), y
>   `permisos.test.ts` recorre el router real y fija que todas exigen ADMIN.
>   La primera que habilite a Recepción (la agenda de clínica) la suma ahí a
>   propósito.
> - **Menú:** Recepción ve el menú de un usuario no ADMIN. El menú propio de
>   la clínica es de R17.

### 11.1 Cómo se modela

Los roles no son un enum de Postgres: son filas de la tabla `roles` (`name`
VarChar, `schema.prisma:782-794`), sembradas por `prisma/seed.ts`, y en el código
son el tipo `RoleName = "ADMIN" | "USER"` con `KNOWN_ROLES` e `isRoleName`
(`types/auth.ts:4-9`).

- **Migración 🗄:** `INSERT INTO roles (name, description) VALUES ('RECEPCION', …)
  ON CONFLICT (name) DO NOTHING`. Va en la migración (no solo en el seed) para que
  producción tenga el rol sin depender de que alguien corra `prisma:seed`. El
  seed también lo suma (upsert idempotente, como los otros dos).
- **Código:** `RoleName` suma `"RECEPCION"` y `KNOWN_ROLES` también. El orden
  importa: primero se despliega el código que conoce el rol, después se aplica la
  migración. Antes de eso nadie puede tenerlo asignado.
- **Qué rol admite cada rubro**, en `src/config/ediciones.ts` junto a los
  módulos (`ROLES_POR_RUBRO`):

  | Rubro | Roles | Asignar otro rol |
  |---|---|---|
  | AUTOMOTORA | ADMIN, USER (como hoy) | `RECEPCION` → 400 `ROL_NO_DISPONIBLE_EN_EL_RUBRO` |
  | CLINICA | ADMIN, RECEPCION | `USER` → 400 `ROL_NO_DISPONIBLE_EN_EL_RUBRO` |

  Lo validan las invitaciones y el cambio de rol de un usuario, en el backend. El
  selector de rol de la pantalla muestra solo los dos roles del rubro.
- **Quién asigna:** el ADMIN de la clínica, en Usuarios (cambio de rol y sedes) e
  Invitaciones (rol y sedes del invitado). El alta de la organización crea
  siempre un ADMIN.
- **Cambio de rubro (D1):** el 409 de §1.1 cubre también a los usuarios con un
  rol que el rubro nuevo no admite.

### 11.2 Qué puede hacer cada rol en una clínica

Recepción tiene **permisos operativos sobre la agenda, los pacientes, las
conversaciones y las tareas, dentro de sus sedes** (§11.5). No configura nada.
ADMIN ve y hace todo, en todas las sedes, sin importar las sedes que tenga
asignadas.

| Pantalla | ADMIN | Recepción |
|---|---|---|
| **Agenda:** ver turnos | ✅ todas las sedes | ✅ de sus sedes |
| Crear, cancelar y reprogramar turnos | ✅ | ✅ en profesionales de sus sedes |
| Atendido / No vino | ✅ | ✅ de sus sedes |
| Sobreturno (si el profesional lo permite) | ✅ | ✅ de sus sedes |
| `force` (fuera de horario) | ✅ | ❌ |
| Bloqueos de un profesional | ✅ | ✅ de sus sedes |
| Profesionales, prestaciones, horarios, calendario de Google | ✅ | ❌ |
| **Pacientes:** ver | ✅ todos | ✅ todos (ver "solo lo suyo" abajo) |
| Crear y editar | ✅ | ✅ cualquiera |
| Borrar, borrado de datos personales, unir, importar | ✅ | ❌ |
| **Conversaciones:** ver, responder y devolver al agente | ✅ todas | ✅ las de sus sedes |
| Cerrar | ✅ | ✅ las de sus sedes |
| **Tareas:** ver | ✅ todas | ✅ las suyas y las de sus sedes |
| Completar y editar | ✅ | ✅ las que ve |
| Asignarse una tarea | ✅ | ✅ las que ve |
| Asignarle una tarea a otra persona | ✅ | ❌ |
| Usuarios, invitaciones, agente, automatizaciones, base de conocimiento, organización, sedes | ✅ | ❌ |

**Cómo se aplica "solo lo suyo" a Recepción.** En las automotoras, un USER solo
edita lo que tiene asignado (`permisosDelVendedor.ts`), solo responde las
conversaciones asignadas (`conversationReply.service.ts:133`) y solo ve sus
tareas (`activity.service.ts:82-90`). Esas reglas existen porque el vendedor es
dueño de sus clientes. En una clínica nadie es dueño de un paciente, así que
**para Recepción el límite no es "lo asignado" sino "sus sedes"**:

- **Pacientes: todos, sin dueño.** `Contact` no tiene sede: un paciente puede
  atenderse en más de una, y darle sede al contacto sería sucursalizar el CRM
  entero, que booking-architecture §3 dejó como una decisión aparte y grande.
  Recepción ve y edita cualquier paciente, porque necesita buscarlo para darle
  un turno. `ownerId` no se usa para limitar nada en una clínica.
- **Conversaciones: las de sus sedes.** `Conversation.branchId` ya existe
  (`docs/ai-agent-architecture.md` §3). Recepción ve y responde cualquier
  conversación de sus sedes, esté asignada o no. Que la conversación esté
  asignada a otra persona no la bloquea: es un equipo atendiendo una misma
  recepción.
- **Tareas: las suyas y las de sus sedes.** Columna aditiva
  `Activity.branchId` (nullable). La escriben solo los flujos de clínica: las
  tareas que nacen de un turno o de una conversación (sin respuesta al
  recordatorio, cancelación por botón, turno movido en Google, derivaciones) la
  llevan con la sede del turno o de la conversación. Recepción ve las tareas
  **asignadas a sí misma** más las que tienen un `branchId` de sus sedes. Una
  tarea sin `branchId` (una tarea manual que un ADMIN cargó sobre un paciente) la
  ve solo si está asignada a esa persona.

  > **Cambio de Rocco (2026-10-10, R20):** una tarea sin `branchId` (las
  > manuales y todas las anteriores a R20) la ven y la toman **todas** las
  > Recepciones de la organización, para que ninguna tarea quede invisible. Una
  > Recepción sin sedes ve las suyas y las sin sede; la agenda y las
  > conversaciones, vacías.

### 11.3 Cómo se implementa sin tocar a ADMIN ni a USER

Hoy hay 16 chequeos `role === "ADMIN"` sueltos (en `activity.service.ts`,
`permisosDelVendedor.ts`, `conversationReply.service.ts`, `booking.service.ts`,
`contact.controller.ts`, `opportunity.controller.ts`, `me.controller.ts`,
`avisoSinRespuesta.service.ts`, `discountVoucherManual.service.ts` y
`requireInternalAgentAccess.ts`). Todos son binarios: ADMIN o "el otro rol", y
"el otro rol" hoy es siempre USER.

- **Un solo lugar nuevo:** `src/services/permisos.ts`, con
  `puede(actor, capacidad, recurso?)` y una tabla rol → capacidades. Las
  capacidades salen de la tabla de §11.2 (`ver_tareas`, `editar_contacto`,
  `responder_conversacion`, `marcar_atendido`, `crear_sobreturno`,
  `bloquear_profesional`…). Cuando la capacidad depende de la sede, `puede`
  recibe el recurso y mira `sedesDelActor` (§11.5).
- **Se reemplazan los chequeos donde Recepción no puede caer en el lado de
  USER:** tareas, edición de contactos, respuesta en conversaciones y los de
  agenda. Para **ADMIN y USER**, `puede` devuelve exactamente lo que devolvía el
  `if`, con la misma regla de "solo lo suyo" de hoy. Los otros chequeos
  (`force`, cupones, agente interno, oportunidades) quedan como están y
  Recepción cae en el lado de "no ADMIN", que en esos casos es lo correcto.
- **Rutas:** las que llevan `authorize("ADMIN")` siguen así; Recepción recibe
  403. Las rutas de agenda de clínica que habilitan a Recepción declaran
  `authorize("ADMIN", "RECEPCION")`. Las rutas de hoy que no tienen `authorize`
  (contactos, conversaciones, turnos, tareas) siguen sin tenerlo: el límite de
  sede lo pone `puede`, adentro del service.
- **Fuera de sede, 404:** un turno, una conversación o una tarea de otra sede
  pedido por id responde 404, como hoy una tarea ajena para un USER (ítem 25 de
  `frontend-cambios-pendientes.md`). No se confirma que exista.
- **`/me`** devuelve el rol y las sedes. El frontend suma `useRol()`. El menú de
  clínica le muestra a Recepción: Agenda, Turnos, Pacientes, Conversaciones,
  Tareas.

**Tests de autorización:**

- **Unitario de `permisos.ts`:** la tabla completa. **ADMIN y USER (automotora)
  dan lo mismo que el código de hoy** para cada capacidad que existía. ADMIN y
  Recepción (clínica), con y sin sede, dan lo de §11.2.
- **Rutas:** recorre `RUTAS_POR_MODULO` y, para cada ruta con
  `authorize("ADMIN")`, un usuario Recepción recibe 403, salvo la lista explícita
  de §11.2.
- **Integración de clínica:** una clínica con dos sedes, un ADMIN, una Recepción
  de la sede 1, una de las dos sedes y una sin sedes, cada una contra las
  pantallas de §11.2 (incluidos los 404 fuera de sede). **No hay USER en la
  clínica:** invitar o pasar a alguien a USER da 400.
- **Automotora:** asignar `RECEPCION` da 400, y los tests de autorización
  existentes de ADMIN y USER pasan sin cambios (suite "automotora sin cambios",
  §14.1).

### 11.4 A quién van los avisos

Las tareas de recepción (sin respuesta al recordatorio, cancelación por botón,
turno movido en Google, derivaciones de la clínica) llevan el `branchId` de la
sede y se asignan así:

1. al "Responsable por defecto" de la sede, si tiene el rol Recepción y esa
   sede asignada;
2. si no, al usuario de Recepción **de esa sede** con menos tareas abiertas;
3. si la sede no tiene nadie de Recepción, al "Responsable por defecto" o al
   ADMIN más antiguo (la transición de §6.5).

Como Recepción ve las tareas de sus sedes, cualquier persona de Recepción de esa
sede puede tomar una asignada a otra. No hace falta una columna de "cola".

### 11.5 Usuarios por sede (D19)

> **Implementado en R20** (migración `20261105120000_usuarios_por_sede`). Cómo
> quedó, y dónde difiere de lo de abajo:
>
> - **Modelo:** `user_branches` e `invitation_branches` llevan
>   `organization_id` (RLS y política uniforme), FKs compuestas y **ON DELETE
>   CASCADE** (excepciones declaradas en la fila 14 del diagnóstico: una fila es
>   una asignación). `invitations` suma `UNIQUE (organization_id, id)` para la FK
>   compuesta. `activities.branch_id` es nullable, NO ACTION.
> - **`sedesDelActor`** y los helpers `estaEnSusSedes`, `exigirSedeDelActor`
>   (404) y `filtroDeSedes` viven en `src/services/permisos.ts`. Fallan cerrado:
>   un actor de Recepción sin `sedes` ve vacío.
> - **AuthContext:** `sedes` es opcional y solo existe para Recepción en una
>   clínica (subconsulta en el mismo SELECT de `findUserForAuth`). Cambiar las
>   sedes de un usuario pasa por `updateUser`, que ya hacía
>   `olvidarContextoDeAuth`.
> - **Límite aplicado en:** turnos (listar, ver, cancelar, crear, y la
>   disponibilidad y el turno de clínica), conversaciones (listar, ver, brief,
>   cerrar, responder, reintentar, devolver), tareas (§11.2) y `get_agenda` del
>   agente interno. Los pacientes no tienen límite.
> - **Usuarios e invitaciones:** `branchIds`. 400 `SEDES_OBLIGATORIAS` (Recepción
>   sin sedes), `SEDES_INVALIDAS` (de otra organización o borrada) y
>   `ADMIN_SIN_SEDES`. Pasar a alguien a ADMIN borra sus filas. En una
>   automotora `branchIds` se ignora antes de validar: un body con solo eso da
>   el 400 de siempre.
> - **Respuestas:** `/me` suma `sedes` (`"todas"` o la lista) y los listados de
>   usuarios e invitaciones suman `branches`, **solo en una clínica**. La tarea
>   sale sin `branchId` en una automotora: sus respuestas no cambian (lo fija
>   `automotoraSinCambios.integration-test.ts`).
> - **Avisos (§11.4):** la tarea sin respuesta (devolver al agente) y la de la
>   derivación del agente, en una clínica, llevan la sede de la conversación y
>   van a su Recepción (`avisoDeRecepcion`, `src/clinicas/services/`).
> - **Frontend:** la sede activa es el filtro **Sucursal** de Reservas,
>   Calendario y Conversaciones, que a una Recepción le ofrece solo sus sedes.

```prisma
model UserBranch {
  organizationId String
  userId         String
  branchId       String
  createdAt      DateTime @default(now())
  @@id([userId, branchId])
  // FKs compuestas (organizationId, userId) y (organizationId, branchId)
}

model InvitationBranch {
  organizationId String
  invitationId   String
  branchId       String
  @@id([invitationId, branchId])
}
```

- **Solo lo usan las clínicas.** Una automotora no tiene filas, y su código no
  las lee: `sedesDelActor(actor)` devuelve **"todas"** para cualquier usuario de
  una automotora y para cualquier ADMIN. Para una automotora el resultado es
  exactamente el de hoy, y lo fija un caso de la suite "automotora sin cambios"
  (§14.1).
- **Para Recepción** devuelve el conjunto de sedes de `UserBranch`, sin las sedes
  borradas.
- **Asignación:** el ADMIN de la clínica elige las sedes en el formulario del
  usuario y al invitar. Una invitación de Recepción **exige al menos una sede**
  (400 si no trae ninguna). Las sedes de la invitación se copian a `UserBranch`
  al aceptar, en la misma transacción que crea el usuario. ADMIN no necesita
  sedes y el formulario no las pide.
- **Usuario de Recepción sin sedes:** solo pasa si se le sacaron todas o si se
  borraron. Puede entrar y ver pacientes (que no tienen sede), y ve las tareas
  asignadas a sí misma. La agenda, las conversaciones y las demás tareas están
  vacías, con el aviso "No tenés sedes asignadas. Pedile a un administrador que
  te asigne una". No recibe avisos nuevos (§11.4, punto 2).
- **Caché:** las sedes viajan en `AuthContext` (se agregan al `SELECT` de
  `findUserForAuth` solo para usuarios de clínica). Cambiar las sedes de un
  usuario llama a `vaciar()` para ese usuario, como el cambio de edición.
- **Borrar una sede** no borra las filas de `UserBranch`. `sedesDelActor` ignora
  las sedes borradas.
- Son tablas nuevas: RLS, H-01, fila 5 del diagnóstico.

---

## 12. Clínica Demo (D14)

Una organización de demostración para mostrarle el producto a una clínica, con
datos inventados. **No se usa AutoMax** ni ningún dato real.

### 12.1 Cómo se crea

- **Plataforma → Nueva organización**, con rubro CLINICA, y la casilla **"Cargar
  datos de ejemplo"** (solo platform admin).
- Detrás, `POST /api/admin/organizations/:organizationId/demo-data`
  (`requirePlatformAdmin`), que llama a `cargarDatosDeEjemplo(organizationId)` del
  módulo de clínicas. Responde 409 si la organización no es CLINICA o si ya tiene
  contactos o turnos: nunca mezcla datos de ejemplo con datos reales.
- Usa **los services**, para que los datos pasen por las mismas validaciones que
  los de un cliente.
- **Limpieza:** Rocco la borra después de cobrarle al primer cliente. El slug es
  `clinica-demo-*`. **No** entra en `PATRONES_DE_SLUG_DE_PRUEBA`, para que una
  purga de organizaciones de test no la borre antes de tiempo. El borrado se hace
  a mano ese día.

### 12.2 Qué datos lleva (todos inventados)

| Qué | Ejemplo |
|---|---|
| Organización | "Clínica Demo", ESENCIAL, CLINICA, `contactTerm = PACIENTE`, zona `America/Montevideo` |
| Sede | "Sede Centro", de lunes a viernes de 9 a 19 y sábados de 9 a 13. Recordatorio a las 24 h, `NO_ENVIAR` para turnos tardíos |
| Profesionales | "Dra. Lucía Ejemplo" (dermatología), "Lic. Martina Prueba" y "Lic. Sofía Muestra" (cosmetología). Sin calendario de Google |
| Prestaciones | Consulta dermatológica (30 min, control a los 180 días) · Limpieza facial (60 min, control a los 30 días, la hacen las dos licenciadas) · Depilación láser (45 min, control a los 30 días) · Peeling químico (45 min) |
| Bloqueo | La Dra. Ejemplo no atiende el próximo viernes a la tarde |
| Base de conocimiento | Horarios · Cómo llegar · Precios de ejemplo · Medios de pago · Coberturas: "No trabajamos con mutualistas" · Política de cancelación · Indicaciones antes de la depilación láser (`INDICACIONES`, con la aclaración "texto de ejemplo") |
| Pacientes | 8 contactos con nombres de fantasía, emails `@example.com` y **sin teléfono** (un teléfono inventado puede existir) |
| Turnos | Unos 15 en la semana siguiente, algunos con `patientConfirmedAt`, un sobreturno y 3 atendidos la semana anterior |
| Agente | "Recepción virtual", **inactivo y sin nivel** (ediciones D3). Instrucciones y aviso de privacidad de ejemplo |
| Automatizaciones | Recordatorio, QR al atender y control, **inactivas**: las plantillas de Meta no se aprueban solas |

---

## 13. Lo que queda en el núcleo compartido

Para que se vea en un solo lugar qué toca código que también corre para las
automotoras, y qué lo garantiza:

| Cambio en el núcleo | Por qué es del núcleo | Garantía para la automotora |
|---|---|---|
| `industry` en `organizations` y en `AuthContext` | Es el dato que separa los productos | Default `AUTOMOTORA`, sin backfill |
| `modulosDe` en el gate de ediciones | Un solo gate | `modulosDe(e, AUTOMOTORA) = MODULOS_POR_EDICION[e]` |
| Campo `motivo` en el 403 | Distingue edición de rubro | Aditivo; hoy no existe ninguna ESENCIAL |
| `textos` por parámetro en `armarSystemPrompt` | Prompt por rubro | Prompt de automotora idéntico byte a byte |
| Puntos de extensión antes del modelo y sobre la respuesta | Guardrails por rubro | Lista vacía en AUTOMOTORA; test con "me arde la garganta" |
| `toolsDelRubro` en el filtro de tools | Catálogo por rubro | Las tools que ve un agente de automotora son las de hoy |
| Canales de Google en `GoogleCalendarChannel` | Varios calendarios por conexión | Migración que copia; webhook y renovación iguales; sin reconectar |
| Scopes por rubro en la URL de OAuth | Solo las clínicas listan calendarios | URL de automotora idéntica |
| Botones opcionales y payload en el webhook de WhatsApp | Recordatorio con confirmación | Cuerpo de las plantillas sin botones idéntico; un botón sin `BookingMessage` sigue el camino de hoy |
| `permisos.ts` | Roles de clínica (ADMIN y Recepción) | Tabla de ADMIN y USER igual al código de hoy |
| Roles por rubro | En una clínica no hay USER; en una automotora no hay Recepción | Las automotoras siguen con ADMIN y USER; asignar Recepción da 400 |
| `sedesDelActor` y sedes en `AuthContext` | Usuarios por sede | Devuelve "todas" para cualquier usuario de una automotora; sin filas de `UserBranch` |
| Columnas aditivas (`Booking`, `Resource`, `ServiceType`, `KnowledgeBaseEntry`, `Contact`, `Activity.branchId`) | Datos operativos del turno y sede de las tareas | Nullable o con default que reproduce hoy; solo las escribe código de clínicas |
| Menú y marca por configuración | Producto aparte y marca futura | Snapshot del menú de automotora |

---

## 14. Tests

### 14.1 Suite "automotora sin cambios"

Es la que hace cumplir la regla de §0.3. Vive en un archivo propio
(`src/clinicas/automotoraSinCambios.test.ts` y su par de integración), y **cada
PR que toca el núcleo le agrega su caso**:

- `modulosDe(e, AUTOMOTORA)` es igual a `MODULOS_POR_EDICION[e]` para las dos
  ediciones.
- El system prompt de un agente AUTOMOTORA es idéntico al de antes del cambio
  (snapshot con datos fijos).
- Las tools que ofrece y ejecuta un agente AUTOMOTORA son las de hoy, incluso con
  las tools de clínica en `enabledTools`.
- "me arde la garganta" en AUTOMOTORA llega al modelo.
- La URL de autorización de Google de una sucursal AUTOMOTORA es idéntica, con
  sus dos scopes.
- Después de la migración de canales, una notificación de un canal existente de
  una automotora se procesa igual y la renovación no crea canales nuevos ni
  detiene los vigentes.
- Un turno de una automotora no emite eventos al outbox, no recibe
  recordatorios y no se cierra solo.
- El seguimiento de consultas de una automotora con un test drive agendado sale
  igual que hoy.
- El cuerpo de alta de una plantilla sin botones es idéntico al de hoy, y un
  botón de una automotora sigue llegando al agente como texto.
- El catálogo de automatizaciones de una automotora es el de hoy.
- Los chequeos de permisos de ADMIN y USER dan lo mismo que antes.
- En una automotora, asignar `RECEPCION` da 400, y ADMIN y USER se siguen
  pudiendo asignar como hoy.
- **Sedes:** en una automotora con dos sucursales, un USER sigue viendo los
  turnos, las conversaciones y las tareas que ve hoy (las mismas reglas de "solo
  lo suyo"), sin ninguna fila de `UserBranch`; `sedesDelActor` devuelve "todas".
- Las tareas que crean los flujos compartidos (derivación del agente, aviso sin
  respuesta) en una automotora no llevan `branchId`.
- Frontend: snapshot del menú y de los textos de una sesión AUTOMOTORA.

### 14.2 Resto

1. **Catálogo:** toda ruta clasificada (ediciones §5.4).
2. **Integración edición × rubro:** cuatro organizaciones (ESENCIAL y COMPLETA,
   AUTOMOTORA y CLINICA), con slugs `rubros-{edicion}-{rubro}-{ts}` en
   `PATRONES_DE_SLUG_DE_PRUEBA`. Casos generados desde `modulosDe`, incluido el
   `motivo` del 403.
3. **Aislamiento:** cada tabla nueva (`ClinicSettings`, `ClinicBranchSettings`,
   `ServiceTypeResource`, `ResourceTimeOff`, `GoogleCalendarChannel`,
   `BookingMessage`, `UserBranch`, `InvitationBranch`) entra a H-01, RLS (`rlsTodasLasTablas.test.ts`) y la fila 5
   del diagnóstico. `BookingMessage` tiene FK a `contacts`: entra a
   `contactMerge`.
4. **Agenda de clínica:** varios profesionales, elección del libre, sobreturnos,
   bloqueos (ofrecer y aceptar con la misma función), reprogramaciones cruzadas
   en paralelo.
5. **Google por profesional:** `freebusy` resta solo lo de cada profesional; un
   profesional sin calendario no resta nada; el calendario de la sucursal no
   resta en CLINICA; `events.insert` y `delete` en el calendario del turno; un
   evento borrado en el calendario de un profesional cancela su turno; cambiar el
   calendario detiene el canal viejo; un canal que falla no frena a los demás en
   la renovación; sin el scope de lista, 409 y el respaldo por ID funciona.
6. **Tools de clínica:** turno de otro contacto (mismo error que inexistente),
   anticipación mínima, "el catálogo tiene exactamente N tools".
7. **Guardrails de salud:** §5.3.
8. **Recordatorios:** las tres políticas de turno tardío, `reminderHoursBefore`
   distinto de 24, mover al reprogramar, cancelar al cancelar, revalidar antes de
   enviar, `CONFIRMAR` y `CANCELAR` sin modelo, cruce por wamid, una sola tarea,
   funcionamiento con SOLO_SEGUIMIENTO.
9. **Post-turno:** `booking.completed` agenda el QR y el control; un "No vino"
   posterior los cancela; el control se cancela si ya hay un turno futuro.
10. **Roles y sedes:** §11.3 (ADMIN y Recepción en la clínica, con y sin sedes;
    USER rechazado) y §11.5 (asignación, invitación sin sedes, sede borrada,
    caché).
11. **Turno movido en Google:** se registra, el turno no cambia y se crea una
    sola tarea con el `branchId` del turno (D16).

---

## 15. Plan de PRs

Los PR con 🗄 llevan migración y **quedan abiertos hasta que se autoricen a
mano**. Un PR por tema, cada uno con sus tests de aislamiento, su caso en la
suite "automotora sin cambios" (§14.1) si toca el núcleo, y su sección de la guía
de clínicas.

**Dependencia con ediciones:** la migración de `industry` va **después** de que
se mergee y se despliegue el PR 2 de ediciones (#453, abierto hoy). El gate del
rubro va después del PR 3 de ediciones, que crea `ediciones.ts` y
`gateDeEdicion`. Ningún PR de este plan crea su propio gate.

| # | PR | 🗄 | Riesgo | Contenido | Depende de |
|---|---|---|---|---|---|
| R0 | `docs: diseño de rubros (clínicas)` (#454) | — | Nulo | Este documento. | — |
| R1 | `feat(rubros): columna industry` 🗄 | Sí | Bajo | `organizations.industry`, default `AUTOMOTORA`, sin backfill. `verify:schema` y diagnóstico. Nadie la lee. | Ediciones PR 2 (#453) **mergeado y desplegado** |
| R2 | `feat(rubros): rubro en el catálogo y en el gate` | — | Medio | `MODULOS_POR_RUBRO`, `modulosDe`, `industry` en `AuthContext` y `/me`, `motivo` en el 403, bloqueos por campo, `toolsDelRubro`, esqueleto de `src/clinicas/` y de la suite "automotora sin cambios", suite edición × rubro. | R1 aplicado, ediciones PR 3 |
| R3 | `feat(clinicas): alta y configuración de la clínica` 🗄 | Sí | Bajo | `ClinicSettings`, `ClinicBranchSettings` (con los campos de recordatorio de D8), selector de rubro en Nueva organización, cambio de rubro solo sin datos (D1), `contactTerm` y vocabulario en `/me`. | R2, ediciones PR 4 |
| R4 | `feat(clinicas): guardrails de salud` | — | **Medio-alto** | Puntos de extensión del loop, detector, mensajes fijos, filtro saliente, silencio después de derivar, derivación sin resumen, `update_lead` acotada, `data-classification.md`. **En producción antes de activar el agente de cualquier clínica.** | R2 |
| R5 | `feat(clinicas): varios profesionales por prestación` 🗄 | Sí | Medio | `ServiceTypeResource` (sin tocar `resourceId`), disponibilidad de clínica, elección de profesional, pantallas. | R3 |
| R6 | `feat(clinicas): bloqueos y sobreturnos` 🗄 | Sí | Medio | `ResourceTimeOff`, `Resource.allowsOverbooking`, `Booking.isOverbooking`. | R5 |
| R7 | `refactor(google): canales en su propia tabla` 🗄 | Sí | **Medio-alto** | `GoogleCalendarChannel` con la copia de los canales existentes, webhook, sync y worker de renovación sobre la tabla nueva. **Comportamiento idéntico para todos** (§4.6). Las columnas viejas quedan. | R2 |
| R8 | `feat(clinicas): un calendario de Google por profesional` 🗄 | Sí | Medio | `Resource.googleCalendarId`, `Booking.googleCalendarId`, scopes por rubro, lista y respaldo por ID, `freebusy` e `insert` por calendario, canal por calendario. Requiere el scope en la pantalla de consentimiento de Google Cloud. | R7, R5 |
| R9 | `feat(clinicas): reprogramar` | — | Medio | §4.7, con Google como en §4.6. | R8 |
| R10 | `feat(clinicas): atendido, no vino y eventos del turno` 🗄 | Sí | Medio | `completedAt`, `completedBy`, rutas, cierre automático, eventos `booking.*` solo en CLINICA. | R9 |
| R11 | `feat(clinicas): tools de turnos` | — | Medio | `get_contact_bookings`, `reschedule_booking`, `cancel_booking`, versiones de clínica de las tools de agenda, textos del rubro en el prompt (§3.2). | R10, R4 |
| R12 | `feat(clinicas): rol Recepción` 🗄 | Sí | **Medio-alto** | Fila `RECEPCION` en `roles` (migración y seed), `RoleName`, `ROLES_POR_RUBRO` (USER → 400 en clínicas, Recepción → 400 en automotoras), `permisos.ts`, reemplazo de los chequeos de §11.3, invitaciones y usuarios con el selector de dos roles, menú, tests de autorización. Toca permisos de todo el sistema: la tabla de ADMIN y USER sin cambios es la red. Hasta R20, Recepción ve todas las sedes. | R2 |
| R13 | `feat(clinicas): recordatorio con confirmación` 🗄 | Sí | **Medio-alto** | `BookingMessage` (`REMINDER`), `patientConfirmedAt`, trigger y acción de clínica, plantilla `UTILITY` con botones, payload en el webhook, políticas de turno tardío (D8), tarea sin respuesta (con la transición de §6.5 si R12 no está). | R10 |
| R14 | `feat(clinicas): QR y control después del turno` 🗄 | Sí | Medio | Valores `REVIEW_QR` y `CONTROL` del enum, `ServiceType.followUpAfterDays`, acciones de clínica, catálogo de §7.3. | R13 |
| R15 | `feat(clinicas): seguimiento de consultas con turnos` | — | Bajo | Filtro de turnos, texto y variables, y "siempre plantilla", **solo CLINICA** (§9.1). | R10 |
| R16 | `feat(clinicas): aviso de privacidad` 🗄 | Sí | Medio | `Contact.privacyNoticeSentAt`, envío, requisito para activar un agente (los textos ya están en `ClinicSettings` desde R3). | R4 |
| R17 | `feat(clinicas): menú, pantallas, marca y guía` | — | Medio | Menú por rubro, `useVocabulario`, marca por configuración (§0.3), pantallas de `features/clinica/`, `docs/guia-de-uso/clinicas/`, snapshot de la automotora. | R3 (y crece con cada PR) |
| R18 | `feat(clinicas): indicaciones en la base de conocimiento` 🗄 | Sí | Bajo | `KnowledgeBaseEntry.kind` (D5). | R4 |
| R19 | `feat(clinicas): Clínica Demo` | — | Bajo | §12. | Lo que se quiera mostrar |
| R20 | `feat(clinicas): usuarios por sede` 🗄 | Sí | **Medio-alto** | `UserBranch`, `InvitationBranch`, `Activity.branchId` (aditiva), `sedesDelActor` y sedes en `AuthContext`, límite por sede en agenda, conversaciones y tareas (§11.2, §11.5), sedes en el formulario del usuario y en la invitación, avisos por sede (§11.4), tests de autorización con sedes y el caso de la suite "automotora sin cambios". Se numera al final para no renumerar el plan, pero va **inmediatamente después de R12** (ver el orden). | R12 |
| R21 | `chore(google): borrar las columnas de canal de google_calendar_connections` 🗄 | Sí | Bajo | D18. Borra `channel_id`, `channel_resource_id`, `channel_expiration` y `sync_token` de `google_calendar_connections`. **Se abre después de un tiempo con R7 en producción sin problemas, y no se mergea por iniciativa propia** (borrado de columnas). | R7 en producción |

**Orden:**

1. R0 cuando sea.
2. Después del despliegue de #453: R1 → (autorización y aplicación) → R2,
   cuando esté ediciones PR 3.
3. R3, R4, R7 y R12 en paralelo (no dependen entre sí). R20 apenas se mergee
   R12, antes de R13: los avisos de recepción de R13 ya salen por sede.
4. R5 → R6 y R8 → R9 → R10.
5. R11, R13 y R15.
6. R14, R16 y R18.
7. R19.
8. R21 cuando R7 lleve un tiempo en producción.

R17 acompaña: cada PR de pantallas suma lo suyo, y R17 cierra el menú y la marca.

**Pendientes fuera de la tabla** (decisiones de Rocco del 2026-10-10):

- ~~`activity.create_follow_up` sobre `booking.completed` (§7.3).~~ Hecho: la
  tarea después del turno.
- Las FAQs que hoy deriva la capa 1, en un PR chico del detector con la lista
  revisada por un profesional de salud (§5.3).

**Antes del primer cliente real:**

- R4 y R16 desplegados;
- la lista de §10 respondida por un profesional;
- §6.6 confirmado con Meta o el BSP.

Hasta R3 nadie puede crear una organización CLINICA: todo lo anterior es inerte.

### 15.1 Fase posterior: presupuestos de tratamiento y paquetes de sesiones (D20)

**Qué problema resuelven.** Muchos tratamientos estéticos no son un turno
suelto: son un plan ("6 sesiones de depilación láser", "3 peelings con un mes
entre cada uno") con un presupuesto que la clínica da antes de empezar, que el
paciente acepta o no, y que se va consumiendo sesión por sesión. Hoy no hay
dónde registrar ese presupuesto, cuántas sesiones quedan, ni avisar cuando el
paquete se termina.

**Por qué quedan afuera.** Es una funcionalidad grande: toca precios y
condiciones comerciales que ve el paciente, el vínculo entre turnos y un plan, y
probablemente lo que COMPLETA aporta a una clínica (§2.1). No hace falta para el
primer cliente: la v1 resuelve la agenda, los recordatorios y el post-turno, que
es lo que la clínica usa todos los días. Va **después de R19**, con su propio
documento de diseño, y no se diseña acá.

---

## 16. Decisiones

Tomadas por Rocco el 2026-10-09, en dos rondas: D1–D15 sobre las preguntas
P1–P15 de la primera versión de este documento, y D16–D21 sobre las preguntas
A1–A6 de la segunda.

| # | Pregunta | Decisión | Dónde se aplica |
|---|---|---|---|
| D1 | ¿Se puede cambiar el rubro? | **Solo el platform admin y solo sin datos de negocio** (409 si hay). | §1.1 |
| D2 | ¿Cómo agenda el agente si PRIMER_CONTACTO prohíbe `create_booking`? | **AUTONOMA con las tools filtradas por rubro.** PRIMER_CONTACTO no cambia; ediciones queda igual. | §5.2 |
| D3 | ¿Oportunidades en clínicas? | **Ocultas en CLINICA.** | §2.1 |
| D4 | Google Calendar con varios profesionales | **Un calendario por profesional.** Canales en tabla propia, scope de lista solo en conexiones de clínicas, sin reconectar a las automotoras. | §4.6, R7, R8 |
| D5 | Preguntas de cuidados antes y después | **Transcribir desde la base de conocimiento** (tipo `INDICACIONES`). | §5.4 |
| D6 | ¿Cómo se marca un turno atendido? | **Manual + cierre automático a las 3 h**; "No vino" manual. | §4.8 |
| D7 | Seguimiento de consultas con texto libre en CLINICA | **Siempre plantilla**, también en AUTONOMA. | §9.1 |
| D8 | Recordatorio de un turno dado con poca anticipación | **Configurable por sucursal:** horas de anticipación (default 24) y política de turno tardío (no mandar, en el momento, unas horas antes; default no mandar). | §1.3, §6.2 |
| D9 | ¿El agente ofrece sobreturnos? | **No**, solo el personal. | §4.4 |
| D10 | Plazo mínimo para cancelar o reprogramar por chat | **Configurable por sucursal, sin valor por defecto.** | §5.1 |
| D11 | Detector de síntomas y urgencias | **Lista de términos en código** en la v1. | §5.3 |
| D12 | Texto del 403 | **Campo aditivo `motivo: "EDICION" \| "RUBRO"`.** | §1.2 |
| D13 | ¿Recordatorios también para automotoras? | **Solo clínicas en la v1.** | §2, §6 |
| D14 | Clínica Demo | **Endpoint del platform admin** con datos inventados. Rocco la limpia después de cobrarle al primer cliente. | §12 |
| D15 | ¿Quién es recepción? | **Rol nuevo "Recepción".** Mientras no exista, los avisos van al "Responsable por defecto" de la sede. | §6.5, §11 |
| D16 | Un turno movido **o borrado** directamente en Google, en una clínica | **Se registra y se crea una tarea para recepción** de la sede del turno, con paciente, profesional, fecha y qué pasó en Google. El turno no se mueve ni se cancela (la plataforma es la fuente de verdad). La cancelación inversa automática queda solo para las automotoras. (Borrado sumado por Rocco el 2026-10-10, R8.) | §4.6 |
| D17 | El `freebusy` de la sucursal se resta de todos los recursos en las automotoras con más de un recurso | **No se toca** (regla de §0.3). | §4.6 |
| D18 | Columnas de canal viejas de `google_calendar_connections` | **Se borran en un PR posterior** (R21), después de un tiempo con R7 en producción. No se mergea por iniciativa propia. | §4.6, R21 |
| D19 | ¿Recepción ve todas las sedes? | **No: usuarios por sede** (`UserBranch`, con migración). Solo en clínicas; en las automotoras no cambia nada. | §11.2, §11.5, R20 |
| D20 | ¿Qué agrega COMPLETA a una clínica? | **Presupuestos de tratamiento y paquetes de sesiones, como fase posterior a R19**, con su propio documento de diseño. No entran para el primer cliente. | §2.1, §15.1 |
| D21 | ¿USER puede reprogramar? | **En una clínica no hay USER.** Los roles de una clínica son ADMIN y Recepción. Recepción crea, cancela y reprograma turnos, marca atendido / no vino, carga sobreturnos y bloquea profesionales. Asignar USER en una clínica da 400; USER sigue igual en las automotoras. | §11 |

Además, sobre el PR del seguimiento de consultas (R13 en la versión anterior,
R15 ahora): **el filtro por turno futuro queda solo para clínicas**, sin cambiar a
las automotoras (§9.1).

---

## 17. Preguntas abiertas

**No queda ninguna.** Las A1–A6 de la versión anterior se cerraron como D16–D21
(§16).

### 17.1 Choques con `docs/ediciones.md`

Ninguno queda abierto:

1. **PRIMER_CONTACTO y `create_booking`:** resuelto por D2 sin cambiar ediciones.
2. **Texto del 403:** D12, aditivo.
3. **`QrFollowUp.opportunityId` nullable:** ya no se propone. El QR de las
   clínicas sale por su propia cola (§7).
4. **D9 de ediciones:** D7 es más estricto solo en CLINICA y lo compone.
5. **Pipeline fijo de ESENCIAL:** se sigue creando en una clínica, invisible.
