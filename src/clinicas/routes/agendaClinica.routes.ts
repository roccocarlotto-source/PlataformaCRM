import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { businessWriteRateLimiter } from "../../middlewares/rateLimit";
import {
  asignarCalendarioHandler,
  listarCalendariosHandler,
  borrarBloqueoHandler,
  configurarSobreturnosHandler,
  crearBloqueoHandler,
  listarBloqueosHandler,
  crearTurnoDeClinicaHandler,
  definirProfesionalesHandler,
  disponibilidadDeClinicaHandler,
  listarPrestacionesHandler,
  profesionalesDePrestacionHandler,
} from "../controllers/agendaClinica.controller";

// ---------------------------------------------------------------------------
// Agenda de clínica (docs/rubros.md §4.3, R5). Módulo agenda_clinica en
// src/config/ediciones.ts: el gate (dentro de authenticate) responde 403
// MODULO_NO_INCLUIDO con motivo RUBRO a cualquier organización que no sea una
// clínica, en cualquier edición.
//
// Mismos roles que las rutas de la agenda que ya existen: leer, la
// disponibilidad y reservar, `authenticate` a secas (como /api/availability y
// POST /api/bookings); definir quién atiende una prestación es configuración,
// solo ADMIN (como /api/service-types).
// ---------------------------------------------------------------------------

export const agendaClinicaRouter = Router();

agendaClinicaRouter.get("/clinica/prestaciones", authenticate, listarPrestacionesHandler);

agendaClinicaRouter.get(
  "/clinica/prestaciones/:serviceTypeId/profesionales",
  authenticate,
  profesionalesDePrestacionHandler,
);

agendaClinicaRouter.put(
  "/clinica/prestaciones/:serviceTypeId/profesionales",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  definirProfesionalesHandler,
);

agendaClinicaRouter.get("/clinica/disponibilidad", authenticate, disponibilidadDeClinicaHandler);

agendaClinicaRouter.post(
  "/clinica/turnos",
  authenticate,
  businessWriteRateLimiter,
  crearTurnoDeClinicaHandler,
);

// R6 (docs/rubros.md §4.4, §4.5, §11.2): los bloqueos los cargan ADMIN y
// Recepción (dentro de sus sedes: el service da 404 fuera de ellas); el permiso
// de sobreturnos y su tope son configuración del profesional, solo ADMIN.
agendaClinicaRouter.get(
  "/clinica/profesionales/:resourceId/bloqueos",
  authenticate,
  authorize("ADMIN", "RECEPCION"),
  listarBloqueosHandler,
);

agendaClinicaRouter.post(
  "/clinica/profesionales/:resourceId/bloqueos",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN", "RECEPCION"),
  crearBloqueoHandler,
);

agendaClinicaRouter.delete(
  "/clinica/bloqueos/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN", "RECEPCION"),
  borrarBloqueoHandler,
);

agendaClinicaRouter.put(
  "/clinica/profesionales/:resourceId/sobreturnos",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  configurarSobreturnosHandler,
);

// R8 (docs/rubros.md §4.6): el calendario de Google de cada profesional. Es
// configuración: solo ADMIN. Del módulo agenda_clinica, así que una automotora
// recibe 403 con motivo RUBRO.
agendaClinicaRouter.get(
  "/branches/:branchId/google-calendar/calendars",
  authenticate,
  authorize("ADMIN"),
  listarCalendariosHandler,
);

agendaClinicaRouter.put(
  "/clinica/profesionales/:resourceId/google-calendar",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  asignarCalendarioHandler,
);
