-- ---------------------------------------------------------------------------
-- M-7 de docs/auditoria-2026-08-29.md — índice para bookings.google_event_id.
--
-- findBookingByGoogleEventId (booking.repository.ts) filtra por
-- (google_event_id, organization_id), y aplicarCambio
-- (googleCalendarSync.service.ts) lo llama UNA VEZ POR CADA EVENTO CAMBIADO de
-- cada notificación de Google — y la inmensa mayoría de esos eventos son
-- ajenos al CRM. Los cuatro índices de bookings empiezan por organization_id
-- y ninguno incluye google_event_id, así que cada uno de esos lookups era un
-- scan de todas las reservas del tenant: una peluquería con tres años de
-- reservas que usa el mismo Google Calendar para todo pagaba ese scan por cada
-- edición de cualquier evento ajeno.
--
-- PARCIAL sobre google_event_id IS NOT NULL: la columna es nullable (una
-- reserva sin evento en Google no tiene nada que buscar), y el predicado deja
-- afuera exactamente las filas que nunca van a matchear la consulta. El DSL de
-- Prisma no expresa el predicado, por eso vive acá y no en schema.prisma —
-- mismo criterio que outbox_events_claimable_idx (20260828150000). Lo afirma
-- la fila 17 de docs/auditoria-2026-08-21-diagnostico.sql.
-- ---------------------------------------------------------------------------
CREATE INDEX "bookings_organization_id_google_event_id_idx"
    ON "bookings" ("organization_id", "google_event_id")
    WHERE "google_event_id" IS NOT NULL;
