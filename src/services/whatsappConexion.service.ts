import { env } from "../config/env";
import { logger } from "../lib/logger";
import { findWabaPropio } from "../repositories/whatsappBusinessConnection.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// LA conexión de WhatsApp de una organización: el ÚNICO punto que decide en
// qué WABA se crean, consultan y borran sus plantillas
// (docs/whatsapp-alta-clinica.md).
//
//   - Con un WABA propio ACTIVE (whatsapp_business_connections): ese WABA.
//   - Sin fila: el WABA global de la plataforma (WHATSAPP_BUSINESS_ACCOUNT_ID),
//     como hasta ahora. Una automotora (AutoMax incluida) no tiene fila.
//
// El token es SIEMPRE el de la plataforma (WHATSAPP_ACCESS_TOKEN): la clínica
// nos agrega como socio de su WABA y nuestro System User lo opera. Los envíos
// no cambian: salen del número de la sede (Agent.whatsappPhoneNumberId) con
// ese token, y una plantilla se manda por su nombre desde cualquier número de
// su WABA.
// ---------------------------------------------------------------------------

export interface DepsDeConexion {
  // El WABA global del entorno.
  wabaId: () => string | undefined;
  accessToken: () => string | undefined;
  // El WABA propio ACTIVE de la organización, o null. Sin pasarlo, ninguna
  // organización tiene uno (los tests de siempre).
  wabaPropio?: (organizationId: string) => Promise<string | null>;
}

export const depsDeConexionReales: Required<DepsDeConexion> = {
  wabaId: () => env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  accessToken: () => env.WHATSAPP_ACCESS_TOKEN,
  wabaPropio: (organizationId) => findWabaPropio(organizationId),
};

export interface ConexionDeWhatsapp {
  wabaId: string;
  accessToken: string;
  // true = el WABA propio de la organización; false = el global.
  propio: boolean;
}

export const MENSAJE_SIN_CONEXION =
  "La conexión con WhatsApp no está configurada en la plataforma. Avisale al soporte.";

/** El WABA propio de la organización, o null. */
export async function wabaPropioDe(
  organizationId: string,
  deps: Pick<DepsDeConexion, "wabaPropio">,
): Promise<string | null> {
  return deps.wabaPropio ? deps.wabaPropio(organizationId) : null;
}

// Sin WABA o sin token, ninguna operación con Meta tiene sentido. 503
// operacional con un mensaje para el negocio (no es un error suyo y no lo
// puede arreglar), y el nombre de la variable que falta en el log. El string
// vacío cuenta como ausente. Con un WABA propio, el global no hace falta.
export async function conexionDeWhatsapp(
  organizationId: string,
  deps: DepsDeConexion,
): Promise<ConexionDeWhatsapp> {
  const propio = await wabaPropioDe(organizationId, deps);
  const wabaId = propio ?? deps.wabaId()?.trim();
  const accessToken = deps.accessToken()?.trim();
  if (!wabaId || !accessToken) {
    logger.error(
      {
        faltan: [
          ...(wabaId ? [] : ["WHATSAPP_BUSINESS_ACCOUNT_ID"]),
          ...(accessToken ? [] : ["WHATSAPP_ACCESS_TOKEN"]),
        ],
      },
      "Plantilla de WhatsApp: falta configuración de la conexión con Meta",
    );
    throw new AppError(MENSAJE_SIN_CONEXION, 503);
  }
  return { wabaId, accessToken, propio: propio !== null };
}

/** El WABA donde vive una plantilla ya creada: el suyo, o el global si es
 *  anterior al WABA propio (waba_id NULL). undefined si no hay global. */
export function wabaDeLaPlantilla(
  plantilla: { wabaId: string | null },
  deps: Pick<DepsDeConexion, "wabaId">,
): string | undefined {
  return plantilla.wabaId ?? (deps.wabaId()?.trim() || undefined);
}
