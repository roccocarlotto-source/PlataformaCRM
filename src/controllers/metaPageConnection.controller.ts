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
import { asyncHandler } from "../utils/asyncHandler";
import { leerOrganizacionSinVerificar } from "../utils/metaOauthState";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Conexión de la página de Facebook de la organización (ítem 170). Mismo
// esqueleto que googleCalendarConnection.controller.ts, sin :branchId.
//
// DESDE EL 02/10/2026 CONECTAR Y DESCONECTAR SON DE PLATFORM ADMIN, sobre una
// organización elegida (:organizationId), no del ADMIN del tenant: el diálogo
// de Meta le muestra a quien conecta los portfolios y negocios de su cuenta de
// Facebook, y para un cliente eso es confuso y riesgoso. El cliente le da
// acceso a su página al portfolio de la plataforma y la plataforma la conecta
// (docs/meta-alta-de-cliente.md). Al tenant le queda solo leer el estado.
//
// Factory con el cliente de Meta inyectable SOLO para el test de integración
// (mismo patrón que createWhatsappTemplateHandlers); producción no pasa nada.
// ---------------------------------------------------------------------------

// El callback vuelve al frontend con un 302 (ítem 173): al primer origen de
// CORS_ORIGIN, a la pantalla de plataforma donde vive la conexión
// (RUTA_DE_VUELTA), con ?organizationId= de la organización que se estaba
// conectando para que vuelva seleccionada.
//
// DESDE A-07 (docs-privados/auditoria-2026-09-30-corta.md, local) EL CALLBACK
// NO CANJEA NADA: vuelve con el `code` y el `state` en el FRAGMENTO de la URL
// (#metaCode=…&metaState=…), y el CRM los manda a POST
// /admin/organizations/:organizationId/integrations/meta/complete con la
// sesión de quien esté logueado. El
// fragmento no viaja en ningún request, así que no queda en el log de Vercel
// ni en el Referer. Los errores que Meta devuelve en la redirección (la
// persona canceló) siguen yendo en ?metaError=<mensaje>.
//
// El text/plain queda como fallback cuando no hay un origen utilizable: del
// otro lado hay una persona en un navegador, y un 302 a ninguna parte sería
// peor que un texto legible.

// Tope del mensaje que viaja en la URL, mismo criterio que Google: el que se
// arma con el `error` de Meta sale de la query string y podría ser cualquier
// cosa.
const MAX_MENSAJE_EN_URL = 200;

// La ruta real de AgentFacebookPagePage (frontend/src/app/router.tsx).
export const RUTA_DE_VUELTA = "/admin/agents/facebook-page";

// organizationId: la organización que dice el state, SIN VERIFICAR (ver
// leerOrganizacionSinVerificar). Solo elige qué organización abre la pantalla;
// null si el state no se pudo leer.
export type VueltaDelCallbackMeta = { organizationId: string | null } & (
  { error: string } | { code: string; state: string }
);

// La URL del frontend a la que vuelve el navegador, o undefined si no hay un
// origen utilizable (y entonces el handler responde text/plain). Pura y
// exportada para probarla sin HTTP ni base.
export function urlDeVueltaAlFrontend(
  corsOrigin: string | undefined,
  vuelta: VueltaDelCallbackMeta,
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

  const destino = new URL(RUTA_DE_VUELTA, origen.origin);
  if (vuelta.organizationId) {
    destino.searchParams.set("organizationId", vuelta.organizationId);
  }
  if ("error" in vuelta) {
    destino.searchParams.set("metaError", vuelta.error.slice(0, MAX_MENSAJE_EN_URL));
  } else {
    destino.hash = new URLSearchParams({
      metaCode: vuelta.code,
      metaState: vuelta.state,
    }).toString();
  }
  return destino.toString();
}

// Qué hacer con lo que trajo Meta. Pura y exportada para el test. No verifica
// el state: eso lo hace el endpoint autenticado, que es el único que escribe.
export function vueltaDelCallback(query: {
  state?: string;
  code?: string;
  error?: string;
}): VueltaDelCallbackMeta {
  // Meta devuelve el state también cuando la persona cancela: así la pantalla
  // vuelve con la misma organización seleccionada y el error a la vista.
  const organizationId = query.state ? leerOrganizacionSinVerificar(query.state) : null;
  if (query.error) {
    // Meta manda error=access_denied (con error_reason=user_denied) cuando la
    // persona cancela en su pantalla. Es un camino normal.
    return {
      organizationId,
      error:
        query.error === "access_denied"
          ? "Se canceló la autorización en Facebook. La página quedó sin conectar."
          : `Facebook rechazó la autorización (${query.error})`,
    };
  }
  if (!query.state) return { organizationId, error: "Falta el parámetro state" };
  if (!query.code) return { organizationId, error: "Falta el parámetro code" };
  return { organizationId, code: query.code, state: query.state };
}

const queryDeCallbackSchema = z.object({
  state: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
});

// Topes generosos: un code de Meta ronda los 300-400 caracteres y el state es
// un JWT corto. Existen para que un cuerpo arbitrario no llegue a jose ni a Meta.
const cuerpoDeCompletarSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(4096),
});

const organizationIdParamSchema = z.string().uuid("organizationId inválido");

// La organización sobre la que actúa el platform admin: la del path, NUNCA la
// de su sesión (req.auth.organizationId es la organización propia del platform
// admin, que no tiene nada que ver con la que está configurando).
function organizacionDelPath(req: AuthenticatedRequest): string {
  return parseOrThrow(organizationIdParamSchema, req.params.organizationId);
}

export function createMetaPageConnectionHandlers(cliente?: ClienteMetaOAuth) {
  // El tenant lee el estado de SU organización (la del JWT), para el aviso de
  // Configuración → Organización. Nunca devuelve el token.
  const obtener = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    res.status(200).json(await obtenerConexion(req.auth.organizationId));
  });

  // Los cuatro de platform admin, sobre la organización del path.
  const obtenerDeOrganizacion = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    res.status(200).json(await obtenerConexion(organizacionDelPath(req)));
  });

  // El state queda firmado para la organización del path y el platform admin
  // que tocó "Conectar": solo él la termina, y solo para esa organización.
  const conectar = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const organizationId = organizacionDelPath(req);
    res
      .status(200)
      .json(await iniciarConexion({ organizationId, userId: req.auth.userId }, cliente));
  });

  // El segundo tramo del flujo (A-07): el CRM, ya logueado, manda lo que el
  // callback le rebotó. Los errores salen por errorHandler como JSON con el
  // mensaje del service, que es el que el CRM muestra.
  const completar = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const organizationId = organizacionDelPath(req);
    const cuerpo = parseOrThrow(cuerpoDeCompletarSchema, req.body);
    res
      .status(200)
      .json(await completarConexion(cuerpo, { organizationId, userId: req.auth.userId }, cliente));
  });

  const desconectarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    await desconectar(organizacionDelPath(req), cliente);
    res.status(204).send();
  });

  // SIN authenticate Y SIN AuthenticatedRequest — Request a secas, mismo
  // motivo que el callback de Google: Meta redirige el navegador y no reenvía
  // el JWT. Desde A-07 no toca la base ni habla con Meta: solo rebota.
  //
  // Validación de la query LAXA a propósito, como en Google: Meta suma
  // parámetros propios a esta redirección (error_reason, error_description,
  // y un fragmento #_=_ que el navegador no manda).
  const callback = asyncHandler<Request>(async (req, res: Response) => {
    const query = parseOrThrow(queryDeCallbackSchema, req.query);
    const vuelta = vueltaDelCallback(query);

    const destino = urlDeVueltaAlFrontend(env.CORS_ORIGIN, vuelta);
    if (destino) {
      res.redirect(302, destino);
      return;
    }

    // Sin frontend no hay dónde terminar la conexión: el canje necesita la
    // sesión del CRM. req.path y no req.originalUrl: la URL lleva el code y el
    // state.
    if ("error" in vuelta) {
      res.status(400).type("text/plain").send(`No se pudo conectar Facebook.\n\n${vuelta.error}`);
      return;
    }
    logger.error(
      { path: req.path },
      "Callback de Meta sin un origen de frontend utilizable en CORS_ORIGIN",
    );
    res
      .status(500)
      .type("text/plain")
      .send("No se pudo conectar Facebook.\n\nNo hay una pantalla del CRM a la cual volver.");
  });

  return {
    obtener,
    obtenerDeOrganizacion,
    conectar,
    completar,
    desconectar: desconectarHandler,
    callback,
  };
}
