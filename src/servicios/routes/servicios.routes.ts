import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { leerConfiguracionHandler } from "../controllers/configuracion.controller";

// ---------------------------------------------------------------------------
// El módulo Servicios, el taller de postventa (docs/servicios.md). Todas sus
// rutas están en RUTAS_POR_MODULO.servicios de src/config/ediciones.ts: el
// gate (dentro de `authenticate`) responde 403 MODULO_NO_INCLUIDO a una
// organización que no tiene el módulo activado (motivo NO_ACTIVADO) o cuyo
// rubro no lo admite (motivo RUBRO).
// ---------------------------------------------------------------------------

export const serviciosRouter = Router();

// S2: la configuración, de lectura. La edición (PUT, solo ADMIN) llega con S4.
serviciosRouter.get("/servicios/configuracion", authenticate, leerConfiguracionHandler);
