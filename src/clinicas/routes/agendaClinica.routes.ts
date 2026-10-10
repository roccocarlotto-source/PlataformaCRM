import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { businessWriteRateLimiter } from "../../middlewares/rateLimit";
import {
  marcarAtendidoHandler,
  marcarNoVinoHandler,
  reprogramarTurnoHandler,
  turnosFuturosHandler,
  asignarCalendarioHandler,
  configuracionDeSedeHandler,
  configurarSedeHandler,
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

// R9 (docs/rubros.md §4.7, §11.2): reprogramar lo hacen ADMIN y Recepción, en
// sus sedes (el service da 404 fuera de ellas). Del módulo agenda_clinica: una
// automotora recibe 403 con motivo RUBRO. Los turnos futuros de un profesional
// (el aviso antes de archivarlo) son de configuración: ADMIN.
agendaClinicaRouter.patch(
  "/bookings/:id/reschedule",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN", "RECEPCION"),
  reprogramarTurnoHandler,
);

agendaClinicaRouter.get(
  "/clinica/profesionales/:resourceId/turnos-futuros",
  authenticate,
  authorize("ADMIN"),
  turnosFuturosHandler,
);

// R10 (docs/rubros.md §4.8, §11.2): atendido / no vino lo marcan ADMIN y
// Recepción, en sus sedes. Del módulo agenda_clinica: una automotora recibe 403
// con motivo RUBRO. El agente no marca nada.
agendaClinicaRouter.patch(
  "/bookings/:id/attended",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN", "RECEPCION"),
  marcarAtendidoHandler,
);

agendaClinicaRouter.patch(
  "/bookings/:id/no-show",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN", "RECEPCION"),
  marcarNoVinoHandler,
);

// R11 (docs/rubros.md §5.1, D10): la configuración de clínica de una sede (el
// plazo mínimo para que el asistente cambie un turno). Configuración: solo
// ADMIN. Del módulo agenda_clinica: una automotora recibe 403 con motivo RUBRO.
agendaClinicaRouter.get(
  "/clinica/sedes/:branchId/configuracion",
  authenticate,
  authorize("ADMIN"),
  configuracionDeSedeHandler,
);

agendaClinicaRouter.put(
  "/clinica/sedes/:branchId/configuracion",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  configurarSedeHandler,
);
