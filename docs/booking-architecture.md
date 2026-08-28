# Arquitectura del módulo de Agenda/Booking

Documento de diseño — 28/08/2026. Sigue la misma convención que `authentication-architecture.md` e `ingestion-architecture.md`: describe el diseño antes de implementarlo, se actualiza a medida que se construye.

## 1. Contexto y decisión

El sistema necesita agendar turnos y clases (packs Turnos, Clínica/Salud, Fitness/Clases — ver `sistema_saas_definicion_funcional.md` en la carpeta "Sistema Saas", sección 22). Se evaluó construir un motor de disponibilidad propio vs. integrar un proveedor externo. Decisión: **integrar Google Calendar API**, no construir un motor de calendario propio.

Motivo: Google Calendar API es gratis para uso estándar dentro de cuotas muy altas (10.000 req/min por proyecto, 600 req/min por usuario, 1.000.000 de requests/día antes de que Google considere facturar), sin costo de suscripción por negocio conectado. Se evaluó también Cal.com; sus planes públicos (Free / Teams USD 12 por usuario/mes / Organizations USD 28 por usuario/mes) son para uso de un equipo con la página de reservas de Cal.com, no para embeber agenda multi-tenant dentro de este producto — el producto que serviría para eso ("Cal.com Platform/Atoms") no tiene precio público y requiere hablar con ventas. Google Calendar no soporta nativamente "evento con cupos" (necesario para el Pack Fitness/Clases), pero esto no es un problema real: el control de capacidad vive en este CRM (ver sección 3), no en el proveedor de calendario — Google solo necesita reflejar si un horario está ocupado o no.

## 2. Alcance de este módulo

Incluye: gestión de recursos agendables por sucursal, tipos de servicio con duración y capacidad, creación/cancelación de reservas, sincronización con Google Calendar, disparo de automatizaciones asociadas, y las tools de IA `get_availability()` / `create_booking()`.

No incluye (por ahora, fuera de alcance): motor de disponibilidad propio sin proveedor externo, soporte a otros proveedores de calendario (Outlook, Apple Calendar), pago de seña al momento de reservar (evaluar por separado si/cuando se prioriza un pack donde se justifique, ej. Pack Turnos).

## 3. Modelo de datos

Nuevas entidades, todas bajo el mismo patrón de aislamiento multi-tenant ya usado en el resto del schema (`organizationId` + `sucursalId`, FKs compuestas, soft delete donde aplica):

```prisma
model Resource {
  id             String   @id @default(uuid())
  organizationId String
  sucursalId     String
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
  sucursalId     String
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
  sucursalId     String
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

model GoogleCalendarConnection {
  id             String   @id @default(uuid())
  organizationId String
  sucursalId     String   @unique       // una conexión de Google Calendar por sucursal
  refreshToken   String                  // cifrado en reposo, igual criterio que ApiKey
  calendarId     String                  // calendario primario u otro elegido por el negocio
  connectedAt    DateTime @default(now())
  status         ConnectionStatus @default(ACTIVE) // ACTIVE | REVOKED | ERROR
}
```

Control de capacidad: al crear un `Booking`, el servicio cuenta `Booking`s activos con el mismo `serviceTypeId` + `resourceId` + horario, y rechaza si ya alcanzó `ServiceType.capacity`. Esto es lógica propia del CRM — Google Calendar solo recibe un evento por reserva (o un evento compartido con múltiples asistentes en el caso de clases, a definir en implementación) y lo que le importa a este sistema es su propio conteo, no lo que Google reporte como "libre/ocupado".

## 4. Integración con Google Calendar

- **Conexión por sucursal**: cada Sucursal conecta su propia cuenta de Google (OAuth 2.0, flujo estándar de autorización) — la mayoría de los negocios chicos usan Gmail personal, no Google Workspace, así que no hay delegación de dominio disponible como atajo. El `refreshToken` resultante se guarda cifrado, mismo criterio de manejo de secretos que ya se usa para `ApiKey`.
- **Scopes necesarios**: `https://www.googleapis.com/auth/calendar.events` (crear/modificar/cancelar eventos) como mínimo; evaluar si hace falta `calendar.readonly` adicional para leer disponibilidad de calendarios que el negocio ya tenía en uso antes de conectar.
- **Consulta de disponibilidad**: usar el endpoint `freebusy.query` de Google Calendar API para saber qué horarios están ocupados dentro del rango de trabajo configurado por Resource (el rango de trabajo — días/horarios — se define en este CRM, no en Google).
- **Creación de reserva**: al confirmar un `Booking`, crear el evento correspondiente vía `events.insert` y guardar el `googleEventId` devuelto.
- **Sincronización inversa (cambios hechos directo en Google Calendar)**: suscribirse a notificaciones push de Google Calendar (`events.watch`) para detectar si alguien cancela o mueve un evento desde el calendario en vez de desde el CRM. Importante: los canales de notificación push de Google **expiran** (máximo ~7 días) y hay que renovarlos antes de que caduquen — esto necesita un worker periódico, similar en espíritu al `ingestionWorker.ts` que ya existe para la capa de ingesta.
- **Manejo de fallas**: si Google Calendar API no responde o el token fue revocado por el usuario, el `Booking` se guarda igual como fuente de verdad local (`GoogleCalendarConnection.status = ERROR`) y se notifica al admin de la sucursal para reconectar — el sistema no debe bloquear una reserva por una falla del proveedor externo.
- **Zona horaria**: cada Sucursal necesita su propia zona horaria configurada (no asumir la del servidor) — se pasa explícitamente en cada llamada a la API de Google.

## 5. API interna

Sigue el patrón controller → service → repository ya usado en el resto de `src/`:

- `GET /api/availability?resourceId=&serviceTypeId=&from=&to=` — calcula horarios libres combinando el rango de trabajo configurado, el `freebusy` de Google, y la capacidad ya ocupada en `Booking` (para `ServiceType.capacity > 1`).
- `POST /api/bookings` — crea la reserva: valida capacidad, crea el evento en Google, guarda el registro local, y dispara las automatizaciones de la sección 6.
- `PATCH /api/bookings/:id` — cancela o reprograma; refleja el cambio en Google Calendar.
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
2. Conexión OAuth con Google Calendar por sucursal + `freebusy.query` para disponibilidad real.
3. `POST /api/bookings` con creación de evento en Google + control de capacidad propio.
4. Webhook de sincronización inversa + worker de renovación de canales push.
5. Conectar automatizaciones (Activity, Opportunity, recordatorio WhatsApp).
6. Implementar `get_availability()` / `create_booking()` como tools del agente de IA.

## 10. Decisiones abiertas / pendientes

- Qué pasa si un negocio no quiere conectar Google Calendar (¿fallback sin sincronización externa, solo agenda interna?) — no decidido.
- Si en el Pack Turnos se prioriza cobrar una seña al reservar, cómo se relaciona con la decisión ya tomada de pausar pagos propios del lado de Resea — evaluar si el pago de seña vive en el CRM directamente o se posterga junto con el resto de la discusión de facturación consolidada.
- Represenación exacta en Google Calendar de una clase con cupo (un evento con múltiples asistentes vs. N eventos superpuestos) — a definir en la etapa 3 del plan de implementación.
