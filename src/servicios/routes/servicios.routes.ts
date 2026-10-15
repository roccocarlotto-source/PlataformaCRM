import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { businessWriteRateLimiter } from "../../middlewares/rateLimit";
import {
  actualizarTipoHandler,
  borrarTipoHandler,
  crearTipoHandler,
  guardarConfiguracionHandler,
  leerConfiguracionHandler,
  listarTiposHandler,
} from "../controllers/configuracion.controller";
import {
  actualizarOrdenHandler,
  cambiarEstadoHandler,
  crearOrdenHandler,
  listarOrdenesHandler,
  listarTurnosHandler,
  listarUsuariosHandler,
  obtenerOrdenHandler,
  registrarAprobacionHandler,
} from "../controllers/ordenes.controller";
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

// La configuración (S2 la lectura; S4a la edición, solo ADMIN, §4.8).
serviciosRouter.get("/servicios/configuracion", authenticate, leerConfiguracionHandler);
serviciosRouter.put(
  "/servicios/configuracion",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  guardarConfiguracionHandler,
);

// S4a: tipos de service (§2.6). Leer, cualquiera (se eligen en la orden);
// escribir, solo ADMIN.
serviciosRouter.get("/servicios/tipos", authenticate, listarTiposHandler);
serviciosRouter.post(
  "/servicios/tipos",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  crearTipoHandler,
);
serviciosRouter.patch(
  "/servicios/tipos/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  actualizarTipoHandler,
);
serviciosRouter.delete(
  "/servicios/tipos/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  borrarTipoHandler,
);

// S4a: órdenes de servicio (§2.3–§2.5, §3). ADMIN y USER operan todas (D9).
serviciosRouter.get("/servicios/ordenes", authenticate, listarOrdenesHandler);
serviciosRouter.get("/servicios/turnos", authenticate, listarTurnosHandler);
serviciosRouter.post(
  "/servicios/ordenes",
  authenticate,
  businessWriteRateLimiter,
  crearOrdenHandler,
);
serviciosRouter.get("/servicios/ordenes/:id", authenticate, obtenerOrdenHandler);
serviciosRouter.patch(
  "/servicios/ordenes/:id",
  authenticate,
  businessWriteRateLimiter,
  actualizarOrdenHandler,
);
serviciosRouter.post(
  "/servicios/ordenes/:id/estado",
  authenticate,
  businessWriteRateLimiter,
  cambiarEstadoHandler,
);
serviciosRouter.post(
  "/servicios/ordenes/:id/aprobaciones",
  authenticate,
  businessWriteRateLimiter,
  registrarAprobacionHandler,
);
// Para elegir el encargado: id y nombre de los usuarios activos (D9).
serviciosRouter.get("/servicios/usuarios", authenticate, listarUsuariosHandler);

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
