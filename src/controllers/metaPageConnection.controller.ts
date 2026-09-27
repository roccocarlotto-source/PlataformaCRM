import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import type { ClienteMetaOAuth } from "../services/metaOAuth.service";
import {
  completarConexion,
  desconectar,
  iniciarConexion,
  obtenerConexion,
} from "../services/metaPageConnection.service";
import type { AuthenticatedRequest } from "../types/auth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Conexión de la página de Facebook de la organización (ítem 170). Mismo
// esqueleto que googleCalendarConnection.controller.ts, sin :branchId: la
// organización sale de req.auth en los tres endpoints ADMIN, y del state
// firmado en el callback.
//
// Factory con el cliente de Meta inyectable SOLO para el test de integración
// (mismo patrón que createWhatsappTemplateHandlers); producción no pasa nada.
// ---------------------------------------------------------------------------

// El callback vuelve al frontend con un 302 (ítem 173), igual que el de Google
// Calendar desde el ítem 75: al primer origen de CORS_ORIGIN, a /organization
// (la pantalla donde vive la sección de Facebook) con ?metaConnected=true o
// ?metaError=<mensaje>. Sin :branchId hay un solo destino posible, así que el
// camino de error no necesita revalidar el state como hace Google.
//
// El text/plain de antes queda como fallback cuando no hay un origen
// utilizable: del otro lado hay una persona en un navegador, y un 302 a
// ninguna parte sería peor que un texto legible.

// Tope del mensaje que viaja en la URL, mismo criterio que Google: el que se
// arma con el `error` de Meta sale de la query string y podría ser cualquier
// cosa.
const MAX_MENSAJE_EN_URL = 200;

// La URL del frontend a la que vuelve el navegador, o undefined si no hay un
// origen utilizable (y entonces el handler responde text/plain). Pura y
// exportada para probarla sin HTTP ni base.
export function urlDeVueltaAlFrontend(
  corsOrigin: string | undefined,
  vuelta: { error?: string },
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

  // /organization es la ruta real de OrganizationSettingsPage
  // (frontend/src/app/router.tsx).
  const destino = new URL("/organization", origen.origin);
  if (vuelta.error !== undefined) {
    destino.searchParams.set("metaError", vuelta.error.slice(0, MAX_MENSAJE_EN_URL));
  } else {
    destino.searchParams.set("metaConnected", "true");
  }
  return destino.toString();
}

const queryDeCallbackSchema = z.object({
  state: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
});

export function createMetaPageConnectionHandlers(cliente?: ClienteMetaOAuth) {
  const obtener = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    res.status(200).json(await obtenerConexion(req.auth.organizationId));
  });

  const conectar = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    res.status(200).json(await iniciarConexion(req.auth.organizationId, cliente));
  });

  const desconectarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    await desconectar(req.auth.organizationId);
    res.status(204).send();
  });

  // SIN authenticate Y SIN AuthenticatedRequest — Request a secas, mismo
  // motivo que el callback de Google: Meta redirige el navegador y no reenvía
  // el JWT. Lo único que prueba de qué organización es esto es el state
  // firmado, y lo valida el service ANTES de tocar nada.
  //
  // Validación de la query LAXA a propósito, como en Google: Meta suma
  // parámetros propios a esta redirección (error_reason, error_description,
  // y un fragmento #_=_ que el navegador no manda) y el service decide.
  const callback = asyncHandler<Request>(async (req, res: Response) => {
    const query = parseOrThrow(queryDeCallbackSchema, req.query);

    try {
      const conexion = await completarConexion(query, cliente);

      const destino = urlDeVueltaAlFrontend(env.CORS_ORIGIN, {});
      if (destino) {
        res.redirect(302, destino);
        return;
      }

      res
        .status(200)
        .type("text/plain")
        .send(
          `La página de Facebook quedó conectada.\n\n` +
            `Página: ${conexion.pageId}\n` +
            `Instagram: ${conexion.instagramBusinessAccountId ?? "sin cuenta vinculada"}\n\n` +
            `Ya podés cerrar esta pestaña y volver al CRM.`,
        );
    } catch (err) {
      // Se atrapa y se loguea acá, sin relanzar, por el mismo motivo que el
      // callback de Google: errorHandler responde JSON, y quien mira esta
      // pantalla es una persona. Un error inesperado sale como 500 genérico,
      // sin detalles internos hacia un endpoint público.
      //
      // A DIFERENCIA DEL DE GOOGLE, un AppError con isOperational: false
      // tampoco muestra su mensaje: esos nombran variables de entorno ("Faltan:
      // META_APP_ID…", M-11 b) y son para el log, no para el navegador.
      const esOperacional = err instanceof AppError && err.isOperational;
      const status = err instanceof AppError ? err.statusCode : 500;
      const mensaje = esOperacional
        ? err.message
        : "No se pudo completar la conexión con Facebook.";

      // req.path y no req.originalUrl: la URL completa lleva el `code` y el
      // `state`, que no tienen por qué quedar en un log.
      logger.error({ err, path: req.path }, "Falló el callback de la conexión con Meta");

      const destino = urlDeVueltaAlFrontend(env.CORS_ORIGIN, { error: mensaje });
      if (destino) {
        res.redirect(302, destino);
        return;
      }

      res.status(status).type("text/plain").send(`No se pudo conectar Facebook.\n\n${mensaje}`);
    }
  });

  return { obtener, conectar, desconectar: desconectarHandler, callback };
}
