import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import {
  completarConexion,
  desconectar,
  iniciarConexion,
  obtenerConexion,
} from "../services/googleCalendarConnection.service";
import type { AuthenticatedRequest } from "../types/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const branchIdParamSchema = z.string().uuid("branchId inválido");

// ---------------------------------------------------------------------------
// Los tres endpoints autenticados (ADMIN) + el callback público.
// ---------------------------------------------------------------------------

export const iniciarConexionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const branchId = parseOrThrow(branchIdParamSchema, req.params.branchId);
    const resultado = await iniciarConexion(req.auth.organizationId, branchId);
    res.status(200).json(resultado);
  },
);

export const obtenerConexionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const branchId = parseOrThrow(branchIdParamSchema, req.params.branchId);
    const conexion = await obtenerConexion(req.auth.organizationId, branchId);
    res.status(200).json(conexion);
  },
);

export const desconectarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const branchId = parseOrThrow(branchIdParamSchema, req.params.branchId);
  await desconectar(req.auth.organizationId, branchId);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// El callback de Google.
//
// SIN authenticate Y SIN AuthenticatedRequest — Request a secas. No es un
// descuido: Google redirige el navegador del usuario acá y no reenvía el header
// Authorization, así que no hay JWT que verificar. Lo único que prueba quién es
// esta sucursal es el `state` firmado, y lo valida el service ANTES de tocar
// nada (ver utils/oauthState.ts).
//
// LA VALIDACIÓN DE LA QUERY ES DELIBERADAMENTE LAXA: se acepta cualquier string
// y el service decide. Un schema estricto acá devolvería un 400 de Zod para un
// state manipulado, que es información sobre el formato interno del token; y
// además Google puede sumar parámetros a esta redirección (scope, authuser,
// prompt) sin avisar, así que nada de acá puede ser exhaustivo.
//
// LA RESPUESTA ES text/plain, y es la decisión más simple disponible: la carpeta
// frontend/ está vacía (es P3), así que NO HAY A DÓNDE REDIRIGIR. Del otro lado
// de este request hay un navegador con una persona mirando, no un cliente de
// API — por eso texto legible y no JSON. El día que exista el frontend, esto
// pasa a ser un 302 a una pantalla suya y el contrato de arriba no cambia.
// ---------------------------------------------------------------------------

const queryDeCallbackSchema = z.object({
  state: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
});

export const callbackHandler = asyncHandler<Request>(async (req, res: Response) => {
  const query = parseOrThrow(queryDeCallbackSchema, req.query);

  try {
    const conexion = await completarConexion(query);

    res
      .status(200)
      .type("text/plain")
      .send(
        `Google Calendar quedó conectado.\n\n` +
          `Sucursal: ${conexion.branchId}\n` +
          `Calendario: ${conexion.calendarId}\n\n` +
          `Ya podés cerrar esta pestaña y volver al CRM.`,
      );
  } catch (err) {
    // SE ATRAPA ACÁ EN VEZ DE DEJARLO CAER A errorHandler, y por un motivo
    // concreto: errorHandler responde JSON, y quien está mirando esta pantalla
    // es una persona en un navegador. Un `{"message":"..."}` crudo sería la peor
    // forma de decirle que la conexión falló.
    //
    // El status y el texto salen del AppError que ya construyó el service, así
    // que la clasificación de errores no se duplica: acá solo cambia el formato.
    // Un error inesperado (no AppError) sale como 500 genérico y sin detalles,
    // mismo criterio que errorHandler — nada de mensajes internos hacia un
    // endpoint público.
    const esOperacional = err instanceof AppError;
    const status = esOperacional ? err.statusCode : 500;
    const mensaje = esOperacional
      ? err.message
      : "No se pudo completar la conexión con Google Calendar.";

    // SE LOGUEA ACÁ Y NO SE RELANZA. Relanzar después de responder llevaría el
    // error a errorHandler, que hace res.status().json() sin mirar
    // res.headersSent — o sea que intentaría escribir headers sobre una
    // respuesta ya enviada y tiraría ERR_HTTP_HEADERS_SENT encima del error
    // original. Este es el único handler del proyecto que responde por su
    // cuenta, así que es el único que tiene que resolver su propio logueo.
    logger.error({ err, path: req.originalUrl }, "Falló el callback de Google Calendar");

    res
      .status(status)
      .type("text/plain")
      .send(`No se pudo conectar Google Calendar.\n\n${mensaje}`);
  }
});
