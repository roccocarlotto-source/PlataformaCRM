import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { businessWriteRateLimiter } from "../../middlewares/rateLimit";
import {
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
