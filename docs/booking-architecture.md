# Arquitectura del módulo de Agenda/Booking

Documento de diseño — 28/08/2026. Sigue la misma convención que `authentication-architecture.md` e `ingestion-architecture.md`: describe el diseño antes de implementarlo, se actualiza a medida que se construye.

## 1. Contexto y decisión

El sistema necesita agendar turnos y clases (packs Turnos, Clínica/Salud, Fitness/Clases — ver `sistema_saas_definicion_funcional.md` en la carpeta "Sistema Saas", sección 22). Se evaluó construir un motor de disponibilidad propio vs. integrar un proveedor externo. Decisión: **integrar Google Calendar API**, no construir un motor de calendario propio.

Motivo: Google Calendar API es gratis para uso estándar dentro de cuotas muy altas (10.000 req/min por proyecto, 600 req/min por usuario, 1.000.000 de requests/día antes de que Google considere facturar), sin costo de suscripción por negocio conectado. Se evaluó también Cal.com; sus planes públicos (Free / Teams USD 12 por usuario/mes / Organizations USD 28 por usuario/mes) son para uso de un equipo con la página de reservas de Cal.com, no para embeber agenda multi-tenant dentro de este producto — el producto que serviría para eso ("Cal.com Platform/Atoms") no tiene precio público y requiere hablar con ventas. Google Calendar no soporta nativamente "evento con cupos" (necesario para el Pack Fitness/Clases), pero esto no es un problema real: el control de capacidad vive en este CRM (ver sección 3), no en el proveedor de calendario — Google solo necesita reflejar si un horario está ocupado o no.

## 2. Alcance de este módulo

Incluye: gestión de recursos agendables por sucursal, tipos de servicio con duración y capacidad, creación/cancelación de reservas, sincronización con Google Calendar, disparo de automatizaciones asociadas, y las tools de IA `get_availability()` / `create_booking()`.

No incluye (por ahora, fuera de alcance): motor de disponibilidad propio sin proveedor externo, soporte a otros proveedores de calendario (Outlook, Apple Calendar), pago de seña al momento de reservar (evaluar por separado si/cuando se prioriza un pack donde se justifique, ej. Pack Turnos).

## 3. Modelo de datos

> **Nota del 28/08/2026 — `Branch` ya existe como entidad real.**
>
> Cuando se escribió esta sección, las tres entidades se modelaban con
> `organizationId + sucursalId` **pero no había ninguna entidad de sucursal en
> `prisma/schema.prisma`** — verificado con grep sobre el archivo completo, cero
> coincidencias. Era un prerrequisito que el diseño daba por existente.
>
> Ya está implementada, junto con `Resource` y `ServiceType` (migración
> `20260828160000`). Tres precisiones sobre lo que se construyó:
>
> - **Se llama `Branch`, no `Sucursal`, y el campo es `branchId`.** El schema es
>   100% inglés (`Organization`, `Contact`, `Pipeline`, `Stage`); el
>   `sucursalId` que decían estos bloques era un desliz de redacción y quedó
>   corregido arriba. La prosa de este documento sigue diciendo "sucursal", igual
>   que dice "organización" para `Organization`.
> - **Alcance acotado a este módulo.** Solo las entidades de Booking llevan
>   `branchId`. `Contact`, `Company`, `Opportunity`, `Activity`, `Pipeline` y
>   `Stage` **no** lo tienen y no se preparó nada para que lo tengan:
>   sucursalizar el resto del CRM toca el aislamiento de todas las lecturas, no
>   solo el modelo, y es una decisión aparte y más grande.
> - **Sin sucursal obligatoria.** El onboarding no crea ninguna y cero `Branch`
>   es un estado válido para una organización que no usa Booking. No hay
>   invariante de "al menos una sucursal activa" — a diferencia de "al menos un
>   pipeline activo", acá nada se rompe con cero.
>
> `Branch` lleva además `timezone` (IANA, validada contra el runtime), que la §4
> de este mismo documento ya pedía. Se agregó ahora, antes de que Google Calendar
> exista, para no migrar de nuevo cuando llegue.
>
> **Lo que todavía NO está** de estos bloques: `googleCalendarId` en `Resource`,
> el modelo `Booking` entero y `GoogleCalendarConnection`. Ver el plan de
> implementación en §9.

Nuevas entidades, todas bajo el mismo patrón de aislamiento multi-tenant ya usado en el resto del schema (`organizationId` + `branchId`, FKs compuestas, soft delete donde aplica):

```prisma
model Resource {
  id             String   @id @default(uuid())
  organizationId String
  branchId     String
  name           String              // "Juan (barbero)", "Sala 2", "Clase de Yoga 18hs"
  type           ResourceType        // PERSON | ROOM | CLASS
  googleCalendarId String?           // id del calendario de Google vinculado (null hasta conectar)
  deletedAt      DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

enum ResourceType {
  PERSON
  ROOM
  CLASS
}

model ServiceType {
  id             String   @id @default(uuid())
  organizationId String
  branchId     String
  name           String              // "Corte de pelo", "Clase de Pilates"
  durationMin    Int
  capacity       Int      @default(1) // 1 = turno exclusivo, N = clase con cupo
  resourceId     String              // qué Resource lo provee
  deletedAt      DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model Booking {
  id             String   @id @default(uuid())
  organizationId String
  branchId     String
  serviceTypeId  String
  resourceId     String
  contactId      String
  opportunityId  String?             // vínculo opcional con el pipeline comercial
  startsAt       DateTime
  endsAt         DateTime
  status         BookingStatus @default(CONFIRMED)
  googleEventId  String?             // id del evento creado en Google Calendar
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

enum BookingStatus {
  CONFIRMED
  CANCELLED
  COMPLETED
  NO_SHOW
}
```

> **Nota del 30/08/2026 — `Booking` ya existe, y apareció una entidad que este
> documento nunca modeló: `WorkingHours`.**
>
> Implementadas en la migración `20260830120000`.
>
> **`WorkingHours` es la entidad que faltaba.** Las §4 y §5 mencionaban "el rango
> de trabajo configurado por Resource" como si existiera, pero **no estaba
> modelado en ninguna parte de este documento** — era el pendiente que el paso 2
> dejó anotado y que bloqueaba `GET /api/availability`. Decisión tomada y ahora
> construida:
>
> - **Por `Resource`, no por `Branch`**: dos barberos de la misma sucursal pueden
>   trabajar días distintos.
> - **Una fila = una franja.** "Lunes de 9 a 13 y de 16 a 20" son **dos** filas
>   con `weekday = MONDAY`, que es lo que permite el horario partido — la forma
>   normal de trabajar de una peluquería o un consultorio. Por eso **no** hay un
>   `@@unique([resourceId, weekday])`.
> - **La hora es LOCAL de la sucursal, no UTC.** `weekday` + `startMinute` son
>   hora de pared en la zona de `Branch.timezone`. Guardar UTC sería incorrecto:
>   "los lunes a las 9" no es un instante, y en una zona con horario de verano no
>   corresponde siempre al mismo UTC.
> - **Minutos desde la medianoche (`Int`), no `time` ni `"HH:MM"`.** Toda la
>   lógica del módulo es aritmética; la API sí habla `"HH:MM"` y la conversión
>   vive en el borde.
> - **Alcance mínimo a propósito**, mismo criterio con el que nació `Branch`: sin
>   excepciones, sin feriados y sin bloqueos puntuales. **Lo que hoy no se puede
>   expresar**: "el 25 de diciembre no atiendo" y "este martes me tomo la tarde".
>   Se agregan cuando alguien los necesite.
>
> **Sobre `Booking`**, respecto del borrador de arriba:
>
> - **Sin `deletedAt`**: cancelar es un `status`. Una reserva cancelada es
>   historia que hay que conservar, y un soft delete sería un quinto estado que
>   no significa nada distinto de `CANCELLED`.
> - **`contactId` es NOT NULL** (y su FK es `RESTRICT`, no `NO ACTION`): una
>   reserva sin contacto no es una reserva. Es la diferencia con
>   `Opportunity`/`Activity`, donde `contactId` es opcional porque aquellas
>   pueden colgar de una `Company` — la regla de FKs del proyecto deriva la
>   acción de la nulabilidad, no del caso.
> - **`endsAt` no lo manda el cliente**: sale de `ServiceType.durationMin`.
>   Aceptarlo permitiría reservar dos horas de un servicio de treinta minutos y
>   romper la grilla para todos los demás.
> - **`googleEventId` en `NULL` es un estado NORMAL**, no un error: la sucursal
>   puede no tener Google conectado, o la llamada puede haber fallado.
>
> Se agregó además el `@@unique([organizationId, id])` a `ServiceType` que el
> PR #41 había dejado pendiente: ahora la FK compuesta de `Booking` lo referencia.

```prisma
model GoogleCalendarConnection {
  id             String   @id @default(uuid())
  organizationId String
  branchId     String   @unique       // una conexión de Google Calendar por sucursal
  refreshToken   String                  // cifrado en reposo, igual criterio que ApiKey
  calendarId     String                  // calendario primario u otro elegido por el negocio
  connectedAt    DateTime @default(now())
  status         ConnectionStatus @default(ACTIVE) // ACTIVE | REVOKED | ERROR
}
```

> **Nota del 29/08/2026 — `GoogleCalendarConnection` ya existe, y el bloque de
> arriba tiene una premisa falsa.**
>
> Implementada en la migración `20260829120000`. Lo que cambió respecto de lo
> escrito arriba:
>
> - **"cifrado en reposo, igual criterio que `ApiKey`" no se pudo seguir, porque
>   ese criterio no existe.** Se verificó contra el repo antes de implementar:
>   `ApiKey` **no está cifrada, está hasheada** — SHA-256 sin sal
>   (`src/utils/apiKey.ts`), irreversible a propósito. Y no había ningún módulo
>   de cifrado en el proyecto (grep por `createCipheriv`/`decrypt`/`aes-256`
>   sobre `src/`, `prisma/` y `scripts/`: cero coincidencias).
>
>   La diferencia no es de implementación sino de problema: una API key solo hay
>   que **reconocerla** (comparar por igualdad contra lo que llega en un header),
>   así que un hash irreversible es la primitiva correcta. Un refresh token hay
>   que **recuperarlo** para mandárselo a Google, así que hashearlo lo volvería
>   inútil.
>
>   Se paró y se consultó antes de elegir, por ser una decisión de seguridad y no
>   de convención. Resultado: **AES-256-GCM** con `node:crypto`, clave maestra de
>   32 bytes por variable de entorno (`SECRET_ENCRYPTION_KEY`), en un módulo
>   **genérico** (`src/utils/encryption.ts`) y no atado a Google ni a "refresh
>   token" — cualquier otro secreto recuperable que aparezca lo va a necesitar
>   igual.
> - **`refreshToken` es NULLABLE**, no `String`. Una conexión `REVOKED` no tiene
>   token: se pone en `NULL` al desconectar, así que un volcado de la base no
>   arrastra credenciales de sucursales que ya se fueron. Un `CHECK` en la
>   migración sostiene la otra mitad del invariante: una fila `ACTIVE` sin token
>   es imposible.
> - **Se agregaron `lastErrorAt` y `lastErrorMessage`.** §4 pide "notificar al
>   admin de la sucursal para reconectar" y no hay ningún mecanismo de
>   notificación construido, así que **el registro en la fila es la
>   notificación**: sin él, `status = ERROR` no distingue "el usuario revocó el
>   acceso desde su cuenta de Google" de "el calendario se borró" de "Google
>   estaba caído" — tres cosas con tres respuestas distintas.
> - **El `@unique` es compuesto**, `@@unique([organizationId, branchId])`, por un
>   requisito de Prisma (el lado definidor de una relación 1-a-1 tiene que ser
>   único sobre los mismos campos que usa la relación). Garantiza exactamente lo
>   mismo: la FK compuesta obliga a que el `organizationId` de la fila sea el de
>   su sucursal, y `branches.id` es la PK.
> - **`connectedAt` y `createdAt` no son lo mismo.** Reconectar **actualiza la
>   fila existente** (nunca crea una segunda): `createdAt` sigue diciendo cuándo
>   esa sucursal conectó Google por primera vez, `connectedAt` cuándo vale el
>   token que hay guardado ahora.

Control de capacidad: al crear un `Booking`, el servicio cuenta `Booking`s activos con el mismo `serviceTypeId` + `resourceId` + horario, y rechaza si ya alcanzó `ServiceType.capacity`. Esto es lógica propia del CRM — Google Calendar solo recibe un evento por reserva (o un evento compartido con múltiples asistentes en el caso de clases, a definir en implementación) y lo que le importa a este sistema es su propio conteo, no lo que Google reporte como "libre/ocupado".

## 4. Integración con Google Calendar

- **Conexión por sucursal**: cada Sucursal conecta su propia cuenta de Google (OAuth 2.0, flujo estándar de autorización) — la mayoría de los negocios chicos usan Gmail personal, no Google Workspace, así que no hay delegación de dominio disponible como atajo. El `refreshToken` resultante se guarda cifrado ~~, mismo criterio de manejo de secretos que ya se usa para `ApiKey`~~ **con AES-256-GCM (`src/utils/encryption.ts`) — la comparación con `ApiKey` era falsa, ver la nota del 29/08/2026 en §3**. El flujo necesita además un parámetro `state` **firmado y expirable** (`src/utils/oauthState.ts`): el callback es el único camino de escritura del módulo que no puede estar autenticado —Google redirige el navegador y no reenvía el JWT— así que el `state` es lo único que prueba qué sucursal inició la conexión, y sin él cualquiera podría conectar su cuenta de Google a la sucursal de otra organización.
- **Scopes necesarios**: ~~`https://www.googleapis.com/auth/calendar.events` (crear/modificar/cancelar eventos) como mínimo; evaluar si hace falta `calendar.readonly` adicional para leer disponibilidad de calendarios que el negocio ya tenía en uso antes de conectar.~~ **Corregido el 29/08/2026 — las dos mitades de esa frase estaban mal.** Verificado contra la [referencia oficial de `freebusy.query`](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query): ese endpoint acepta **exactamente cuatro** scopes (`calendar.readonly`, `calendar`, `calendar.events.freebusy`, `calendar.freebusy`) y **`calendar.events` no es ninguno de ellos**. Pedir solo `calendar.events` habría compilado, desplegado, y fallado con un 403 recién la primera vez que alguien consultara disponibilidad. El par que se implementó es el **más acotado que cubre el módulo entero**: `calendar.events` (para `events.insert` del paso 3) + **`calendar.events.freebusy`** (solo busy/free, sin leer ningún detalle de ningún evento). **No** `calendar.readonly`, que también funcionaría pero da lectura completa de todos los calendarios —títulos, invitados, descripciones, adjuntos— para responder una pregunta que es "¿está ocupado a las 15?". Los dos se piden desde la primera autorización aunque el paso 2 solo consulte disponibilidad: el consentimiento OAuth se otorga una vez por cuenta, y agregar un scope después obliga a que **toda sucursal ya conectada vuelva a pasar por la pantalla de Google**.
- **`access_type=offline` y `prompt=consent` son obligatorios en la URL de autorización** (agregado el 29/08/2026, no estaba en el diseño). Sin `access_type=offline` Google no emite refresh token y la integración se muere sola en una hora. Sin `prompt=consent`, **reconectar** una sucursal que ya había autorizado devuelve un 200 impecable y **sin** `refresh_token` — Google lo emite una sola vez por combinación de cuenta y cliente. Como reconectar tras un `REVOKED`/`ERROR` es justo el caso que hay que soportar, es el error clásico de esta integración.
- **Consulta de disponibilidad**: usar el endpoint `freebusy.query` de Google Calendar API para saber qué horarios están ocupados dentro del rango de trabajo configurado por Resource (el rango de trabajo — días/horarios — se define en este CRM, no en Google).
- **Creación de reserva**: al confirmar un `Booking`, crear el evento correspondiente vía `events.insert` y guardar el `googleEventId` devuelto.
- **Sincronización inversa (cambios hechos directo en Google Calendar)**: suscribirse a notificaciones push de Google Calendar (`events.watch`) para detectar si alguien cancela o mueve un evento desde el calendario en vez de desde el CRM. Importante: los canales de notificación push de Google **expiran** (máximo ~7 días) y hay que renovarlos antes de que caduquen — esto necesita un worker periódico, similar en espíritu al `ingestionWorker.ts` que ya existe para la capa de ingesta.
- **Manejo de fallas**: si Google Calendar API no responde o el token fue revocado por el usuario, el `Booking` se guarda igual como fuente de verdad local (`GoogleCalendarConnection.status = ERROR`) y se notifica al admin de la sucursal para reconectar — el sistema no debe bloquear una reserva por una falla del proveedor externo.
- **Zona horaria**: cada Sucursal necesita su propia zona horaria configurada (no asumir la del servidor) — se pasa explícitamente en cada llamada a la API de Google.

## 5. API interna

Sigue el patrón controller → service → repository ya usado en el resto de `src/`:

- `POST /api/branches/:branchId/google-calendar/connect` — inicia la conexión: devuelve la URL de autorización de Google (con el `state` firmado). **Devuelve la URL en el cuerpo, no un 302**: el endpoint está detrás de `authenticate`, y un navegador siguiendo una redirección no reenvía el header `Authorization`. El frontend hace `window.location.href = authorizationUrl`. *(Implementado el 29/08/2026.)*
- `GET /api/integrations/google-calendar/callback` — receptor del redirect de Google. **Sin `authenticate`**, por lo dicho en §4; lo que sostiene la frontera de tenant es el `state` firmado, que se valida **antes de tocar la base**. Sin `:branchId` en el path a propósito: una sola fuente para el destino, la criptográfica — y una sola "Authorized redirect URI" que cargar en Google Cloud Console. *(Implementado el 29/08/2026.)*
- `GET /api/branches/:branchId/google-calendar` — estado de la conexión (`ACTIVE`/`REVOKED`/`ERROR` y el motivo del error). Nunca devuelve el `refreshToken`, ni cifrado. *(Implementado el 29/08/2026.)*
- `DELETE /api/branches/:branchId/google-calendar` — desconecta: revoca contra Google (best-effort — un Google caído no puede impedirle a un ADMIN desconectar) y deja la fila en `REVOKED` con el token en `NULL`. *(Implementado el 29/08/2026.)*
- `GET /api/availability?resourceId=&serviceTypeId=&from=&to=` — calcula horarios libres combinando el rango de trabajo configurado, el `freebusy` de Google, y la capacidad ya ocupada en `Booking` (para `ServiceType.capacity > 1`).

  > **Construido el 30/08/2026 (paso 3).** La cuenta que hace: el horario de
  > trabajo del recurso, **menos** los intervalos ocupados que reporta
  > `freebusy.query`, **menos** el cupo ya tomado por `Booking`s `CONFIRMED`.
  >
  > **La capacidad es la resta que Google no puede hacer**, y es exactamente lo
  > que §1 anticipaba: una clase de yoga aparece *ocupada* en Google desde la
  > primera inscripción, así que restar solo Google mostraría llena una clase con
  > un único inscripto. La respuesta incluye `availableSeats` por turno.
  >
  > **Un fallo de Google no rompe la disponibilidad**: se calcula igual con el
  > horario y las reservas locales, y queda registrado en el log. Se acepta el
  > riesgo de ofrecer un turno que en Google estaba ocupado — mostrar un turno de
  > más se resuelve al intentar reservarlo; un 500 deja la agenda inutilizable.
  >
  > **La validación "¿este horario está dentro del horario de trabajo?" es LA
  > MISMA función que usa `POST /api/bookings`** (`estaDentroDelHorario`, sobre
  > el contexto que resuelve `resolverContexto`). No es una refactorización
  > oportunista: si lo que se ofrece y lo que se acepta se calcularan por
  > separado, podrían divergir — y esa divergencia se manifiesta como un cliente
  > que reserva un turno que el sistema le ofreció y después le rechaza.
  >
  > *Lo que sigue es la nota del paso 2, conservada porque explica por qué esto
  > no se pudo construir antes:*
  >
  > **NO se construyó en el paso 2, y es una decisión explícita, no un olvido.**
  > Depende de dos piezas que no existen: el **rango de trabajo por `Resource`**
  > (días y horarios), que no está en el schema ni diseñado en ninguna parte de
  > este documento —es una frase suelta en este mismo bullet y en §4— y
  > `Booking`, que es el paso 3. Inventar un modelo de horarios para destrabarlo
  > habría sido tomar una decisión de producto de contrabando; queda para cuando
  > se aborde el paso 3.
  >
  > Lo que **sí** quedó construido y probado es la mitad que no depende de esa
  > decisión: `consultarDisponibilidad()` en
  > `googleCalendarConnection.service.ts` devuelve los intervalos **ocupados**
  > que Google reporta para el calendario de una sucursal, con el token
  > descifrado y renovado. Falta restar eso del rango de trabajo, que es
  > exactamente la parte que hay que diseñar.
- `POST /api/bookings` — crea la reserva: valida capacidad, crea el evento en Google, guarda el registro local, y ~~dispara las automatizaciones de la sección 6~~. *(Construido el 30/08/2026, **sin** las automatizaciones: emitir un evento al outbox hoy lo mandaría derecho a `DEAD_LETTER` porque no hay ningún handler registrado. Es el paso 5.)*

  > **El orden de las operaciones es la decisión, más que cualquier validación
  > suelta.** La llamada a Google va **afuera** de la transacción de base:
  >
  > 1. validaciones (400 barato, sin lock);
  > 2. **transacción corta**: lock del `Resource` + lock del `ServiceType` +
  >    revalidación de capacidad + `INSERT`; commit;
  > 3. **ya commiteado**: `events.insert` y, si funcionó, una segunda escritura
  >    con el `googleEventId`.
  >
  > El lock del recurso es lo que cierra la carrera de dos reservas simultáneas
  > por el mismo cupo. Sostenerlo durante una llamada HTTP a un tercero —hasta 10
  > segundos de timeout— **serializaría todas las reservas de ese recurso contra
  > la latencia de Google**, y un Google colgado bloquearía el recurso entero. Es
  > el mismo problema que `OUTBOX_HANDLER_TIMEOUT_MS` documenta para el worker de
  > eventos salientes.
  >
  > **Lo que se acepta a cambio**: entre el commit y la respuesta de Google hay
  > una ventana en la que la reserva existe acá y todavía no allá. Si el proceso
  > muere justo ahí queda un `Booking` con `googleEventId` en `NULL` — que es
  > **el mismo estado** que produce una sucursal sin Google conectado, o sea uno
  > ya soportado y no una anomalía nueva.
  >
  > **Un fallo de Google no bloquea la reserva** (§4), y eso incluye el caso de
  > una sucursal **sin conexión activa**: no es un error, la reserva se guarda
  > igual sin `googleEventId`.
  >
  > La capacidad cuenta reservas `CONFIRMED` que **se superponen** con el horario
  > pedido, no solo las que coinciden exacto: dos turnos que se pisan
  > parcialmente compiten por el mismo recurso. Se cuenta **por recurso**, porque
  > dos servicios distintos del mismo recurso compiten por él igual.

- ~~`PATCH /api/bookings/:id` — cancela o reprograma; refleja el cambio en Google Calendar.~~ **Partido en dos el 30/08/2026, y solo se construyó la cancelación:**
  - `PATCH /api/bookings/:id/cancel` — pasa la reserva a `CANCELLED`, libera el cupo y borra el evento en Google (best-effort: un Google caído no puede impedir cancelar, porque el cupo tiene que liberarse sí o sí). El verbo va en el path porque es una **transición de estado** acotada, no una actualización parcial arbitraria. No es un `DELETE` porque no borra nada: la reserva queda como historia.
  - **Reprogramar quedó fuera de alcance.** Cambiar `startsAt`/`endsAt` exige revalidar el horario de trabajo, la capacidad en el horario nuevo **y** mover el evento en Google — o sea, la creación completa otra vez más el manejo del estado anterior. Hoy el camino es cancelar y crear.
- `POST /api/webhooks/google-calendar` — receptor de notificaciones push de Google (cambios externos).

## 6. Automatizaciones disparadas por un Booking

Al confirmarse un `Booking` (trigger nuevo: "reserva creada"), según configuración del negocio:

- Crear o actualizar una `Activity` asociada al `Contact`.
- Si hay `opportunityId`, mover la `Opportunity` a la etapa configurada (ej. "Agendado").
- Programar el recordatorio de WhatsApp (ej. 24hs antes de `startsAt`) vía el motor de automatizaciones (trigger/condition/action) ya definido conceptualmente.

## 7. Tools del agente de IA

`get_availability()` y `create_booking()` (ya listadas en el catálogo de herramientas del documento de visión) se implementan como wrappers finos sobre los endpoints de la sección 5 — el agente no habla con Google Calendar directamente, siempre pasa por este módulo para que la validación de capacidad y permisos se aplique igual que si lo hiciera un humano desde el panel.

## 8. Costos

Google Calendar API: gratis dentro de las cuotas estándar (ver sección 1) — sin costo de suscripción por negocio conectado. Revisar si Google publica tarifas de excedente durante 2026 (avisan con 90 días de anticipación); a la escala esperada de este proyecto no debería ser relevante en el corto/mediano plazo.

## 9. Plan de implementación sugerido

1. CRUD de `Resource` y `ServiceType` (sin Google Calendar todavía) — permite probar el modelo de capacidad y multi-tenancy de forma aislada.
2. ~~Conexión OAuth con Google Calendar por sucursal + `freebusy.query` para disponibilidad real.~~ **Hecho el 29/08/2026** — modelo `GoogleCalendarConnection` + migración, flujo OAuth completo (iniciar / callback / desconectar), `state` firmado y expirable, cifrado genérico de secretos en reposo, y el wrapper de `freebusy.query` con su test unitario. **`GET /api/availability` quedó fuera a propósito**: ver la nota en §5.
3. ~~`POST /api/bookings` con creación de evento en Google + control de capacidad propio.~~ **Hecho el 30/08/2026** — más el prerrequisito que este documento nunca modeló: **`WorkingHours`** (el "rango de trabajo" que §4 y §5 daban por existente). Incluye `GET /api/availability`, que el paso 2 no pudo construir por eso mismo, la cancelación, y los tres pendientes que el PR #41 había dejado anotados en `serviceType.service.ts`. **Sin reprogramar** y **sin automatizaciones** (paso 5): ver §5.
4. Webhook de sincronización inversa + worker de renovación de canales push.
5. Conectar automatizaciones (Activity, Opportunity, recordatorio WhatsApp).
6. Implementar `get_availability()` / `create_booking()` como tools del agente de IA.

## 10. Decisiones abiertas / pendientes

- Qué pasa si un negocio no quiere conectar Google Calendar (¿fallback sin sincronización externa, solo agenda interna?) — no decidido.
- Si en el Pack Turnos se prioriza cobrar una seña al reservar, cómo se relaciona con la decisión ya tomada de pausar pagos propios del lado de Resea — evaluar si el pago de seña vive en el CRM directamente o se posterga junto con el resto de la discusión de facturación consolidada.
- Represenación exacta en Google Calendar de una clase con cupo (un evento con múltiples asistentes vs. N eventos superpuestos) — a definir en la etapa 3 del plan de implementación.
