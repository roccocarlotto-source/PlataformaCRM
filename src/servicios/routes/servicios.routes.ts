import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { businessWriteRateLimiter } from "../../middlewares/rateLimit";
import { leerConfiguracionHandler } from "../controllers/configuracion.controller";
import {
  actualizarVehiculoHandler,
  borrarVehiculoHandler,
  cambiarDuenoHandler,
  crearVehiculoHandler,
  listarVehiculosHandler,
  obtenerVehiculoHandler,
  ordenesDelVehiculoHandler,
} from "../controllers/vehiculos.controller";

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

// S3: vehículos de clientes (§2.2). ADMIN y USER los crean y editan (D9);
// borrar, solo ADMIN (§10).
serviciosRouter.get("/servicios/vehiculos", authenticate, listarVehiculosHandler);
serviciosRouter.post(
  "/servicios/vehiculos",
  authenticate,
  businessWriteRateLimiter,
  crearVehiculoHandler,
);
serviciosRouter.get("/servicios/vehiculos/:id", authenticate, obtenerVehiculoHandler);
serviciosRouter.patch(
  "/servicios/vehiculos/:id",
  authenticate,
  businessWriteRateLimiter,
  actualizarVehiculoHandler,
);
serviciosRouter.delete(
  "/servicios/vehiculos/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  borrarVehiculoHandler,
);
serviciosRouter.get("/servicios/vehiculos/:id/ordenes", authenticate, ordenesDelVehiculoHandler);
serviciosRouter.post(
  "/servicios/vehiculos/:id/dueno",
  authenticate,
  businessWriteRateLimiter,
  cambiarDuenoHandler,
);
