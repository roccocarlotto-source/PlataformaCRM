import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
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
import { verificarState } from "../utils/oauthState";
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
// LA RESPUESTA ES UN 302 AL FRONTEND (ítem 75 de
// docs/frontend-cambios-pendientes.md). Cuando esto se escribió la carpeta
// frontend/ estaba vacía y no había a dónde redirigir, así que respondía
// text/plain; desde que existe la sección "Google Calendar" en el formulario
// de la sucursal, el navegador vuelve ahí con ?calendarConnected=true o con
// ?calendarError=<mensaje>. El origen es el primero de CORS_ORIGIN — la misma
// variable que ya dice dónde vive el frontend propio.
//
// El text/plain de antes SIGUE como fallback, para el caso en que no hay un
// origen utilizable (CORS_ORIGIN vacío o que no es una URL http/https): del
// otro lado hay una persona en un navegador, y un 302 a ninguna parte sería
// peor que un texto legible.
// ---------------------------------------------------------------------------

// Tope del mensaje que viaja en la URL. Los mensajes del service son de una
// línea; el tope es para el que arma con el `error` de Google ("Google rechazó
// la autorización (...)"), que sale de la query string y podría ser cualquier
// cosa.
const MAX_MENSAJE_EN_URL = 200;

export interface VueltaDelCallback {
  // Solo si salió de un state VERIFICADO. Sin él se vuelve al listado.
  branchId?: string;
  // Presente = la conexión falló, con este mensaje para la persona.
  error?: string;
}

// La URL del frontend a la que vuelve el navegador, o undefined si no hay un
// origen utilizable (y entonces el handler responde el text/plain de siempre).
// Pura y exportada para poder probarla sin HTTP ni base.
export function urlDeVueltaAlFrontend(
  corsOrigin: string | undefined,
  vuelta: VueltaDelCallback,
): string | undefined {
  const primero = (corsOrigin ?? "").split(",")[0].trim();
  if (!primero) return undefined;

  let origen: URL;
  try {
    origen = new URL(primero);
  } catch {
    return undefined;
  }
  if (origen.protocol !== "http:" && origen.protocol !== "https:") return undefined;

  // /branches/:id/edit es la ruta real del formulario (frontend/src/app/
  // router.tsx). Sin sucursal verificada, el listado.
  const destino = new URL(
    vuelta.branchId ? `/branches/${encodeURIComponent(vuelta.branchId)}/edit` : "/branches",
    origen.origin,
  );
  if (vuelta.error !== undefined) {
    destino.searchParams.set("calendarError", vuelta.error.slice(0, MAX_MENSAJE_EN_URL));
  } else {
    destino.searchParams.set("calendarConnected", "true");
  }
  return destino.toString();
}

// La sucursal del flujo en el camino de ERROR, para volver a su formulario y no
// al listado. Solo sale de un state con firma válida —nunca de algo suelto en
// la query—, igual que en completarConexion. El state es un JWT sin nonce
// (utils/oauthState.ts), así que verificarlo de nuevo acá no consume nada. Si
// no verifica (falta, manipulado, vencido), undefined y se vuelve al listado.
async function branchIdVerificado(state: string | undefined): Promise<string | undefined> {
  if (!state) return undefined;
  try {
    return (await verificarState(state)).branchId;
  } catch {
    return undefined;
  }
}

const queryDeCallbackSchema = z.object({
  state: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
});

export const callbackHandler = asyncHandler<Request>(async (req, res: Response) => {
  const query = parseOrThrow(queryDeCallbackSchema, req.query);

  try {
    const conexion = await completarConexion(query);

    const destino = urlDeVueltaAlFrontend(env.CORS_ORIGIN, { branchId: conexion.branchId });
    if (destino) {
      res.redirect(302, destino);
      return;
    }

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

    // SE LOGUEA ACÁ Y NO SE RELANZA. Este es el único handler del proyecto que
    // responde por su cuenta (texto plano para un navegador, no JSON), así que
    // es el único que tiene que resolver su propio logueo y su propia
    // respuesta de error. Cuando se escribió esto, relanzar habría llevado el
    // error a un errorHandler que hacía res.status().json() sin mirar
    // res.headersSent (ERR_HTTP_HEADERS_SENT encima del error original); desde
    // B-24 errorHandler delega en next(err) si los headers ya salieron, pero
    // el finalhandler de Express respondería con SU formato, no con este
    // texto para personas — el motivo de resolverlo acá sigue en pie.
    logger.error({ err, path: req.originalUrl }, "Falló el callback de Google Calendar");

    const destino = urlDeVueltaAlFrontend(env.CORS_ORIGIN, {
      branchId: await branchIdVerificado(query.state),
      error: mensaje,
    });
    if (destino) {
      res.redirect(302, destino);
      return;
    }

    res
      .status(status)
      .type("text/plain")
      .send(`No se pudo conectar Google Calendar.\n\n${mensaje}`);
  }
});
