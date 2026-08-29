import { Router } from "express";
import {
  cancelBookingHandler,
  createBookingHandler,
  getAvailabilityHandler,
  getBookingHandler,
  listBookingsHandler,
} from "../controllers/booking.controller";
import {
  getWorkingHoursHandler,
  replaceWorkingHoursHandler,
} from "../controllers/workingHours.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const bookingRouter = Router();

// ---------------------------------------------------------------------------
// Agenda: horario de trabajo, disponibilidad y reservas (P2.1, paso 3).
//
// PERMISOS — hay una asimetría deliberada acá que conviene leer entera:
//
//   - El HORARIO DE TRABAJO es configuración del negocio, como Branch/Resource/
//     ServiceType: lectura para cualquier autenticado, escritura solo ADMIN.
//   - Las RESERVAS no. Crear y cancelar un turno es la operación cotidiana de
//     quien atiende el mostrador, no una decisión de configuración: exigir
//     ADMIN obligaría a que el dueño sea la única persona que puede agendar,
//     que es justo lo contrario de para qué sirve el módulo.
//
// Role hoy tiene ADMIN y USER y nada más — no se inventa un rol nuevo acá. Si
// algún día hace falta distinguir "recepcionista" de "vendedor", es una decisión
// del modelo de permisos, no de este router.
// ---------------------------------------------------------------------------

// --- Horario de trabajo, colgado del recurso al que pertenece ---

bookingRouter.get("/resources/:resourceId/working-hours", authenticate, getWorkingHoursHandler);

// PUT y no POST: reemplaza la semana entera y es idempotente. Ver el comentario
// de replaceWorkingHours en el repositorio sobre por qué el endpoint tiene esta
// forma y no un CRUD por franja.
bookingRouter.put(
  "/resources/:resourceId/working-hours",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  replaceWorkingHoursHandler,
);

// --- Disponibilidad ---

// GET y sin ADMIN: es una lectura, y es la que va a consumir el futuro widget de
// reservas además del panel. No escribe nada.
//
// Es el endpoint que el paso 2 dejó explícitamente afuera por falta del horario
// de trabajo; con WorkingHours y Booking ya existentes, se puede calcular.
bookingRouter.get("/availability", authenticate, getAvailabilityHandler);

// --- Reservas ---

bookingRouter.get("/bookings", authenticate, listBookingsHandler);
bookingRouter.get("/bookings/:id", authenticate, getBookingHandler);

bookingRouter.post("/bookings", authenticate, businessWriteRateLimiter, createBookingHandler);

// PATCH /:id/cancel y no DELETE /:id: cancelar no borra: transiciona el status a
// CANCELLED y la reserva queda como historia. Un DELETE prometería un borrado
// que no ocurre.
//
// La ruta lleva el verbo en el path porque es una TRANSICIÓN DE ESTADO acotada,
// no una actualización parcial arbitraria: no existe (todavía) reprogramar, así
// que un PATCH /bookings/:id genérico no tendría ningún otro campo que aceptar.
bookingRouter.patch(
  "/bookings/:id/cancel",
  authenticate,
  businessWriteRateLimiter,
  cancelBookingHandler,
);
