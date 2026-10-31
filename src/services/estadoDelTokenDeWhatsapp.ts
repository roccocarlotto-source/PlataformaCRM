import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// OPS-03 (docs-privados/auditoria-2026-10-21, local): EL TOKEN DE WHATSAPP
// DEJÓ DE SERVIR.
//
// WHATSAPP_ACCESS_TOKEN es UNO para toda la plataforma: si Meta lo rechaza
// (código 190: vencido, revocado o con otra contraseña), no sale ningún
// WhatsApp de ninguna organización que use la conexión global, y antes nada
// lo decía salvo los envíos en FAILED.
//
// Ahora la primera respuesta 190 deja UNA línea de error y marca el token
// inválido; la primera respuesta buena de la Graph API lo da por bueno otra
// vez (y lo dice en el log). Plataforma y la configuración de la organización
// muestran el aviso mientras siga inválido.
//
// El estado vive en el proceso, no en la base (sin migración, decisión del
// 2026-10-30): después de un reinicio arranca "bueno" hasta el próximo envío
// que Meta rechace, que vuelve a marcarlo.
// ---------------------------------------------------------------------------

export const CODIGO_DE_TOKEN_INVALIDO = 190;

let invalidoDesde: Date | null = null;

export function anotarTokenDeWhatsappRechazado(detalle: string, ahora: Date = new Date()): void {
  if (invalidoDesde) return;
  invalidoDesde = ahora;
  logger.error(
    { detalle },
    "Meta rechazó WHATSAPP_ACCESS_TOKEN (código 190): no sale ningún WhatsApp de la conexión global hasta renovarlo (docs/deployment.md §2.3)",
  );
}

export function anotarTokenDeWhatsappAceptado(): void {
  if (!invalidoDesde) return;
  invalidoDesde = null;
  logger.info("Meta volvió a aceptar WHATSAPP_ACCESS_TOKEN");
}

/** Desde cuándo Meta rechaza el token, o null si anda (o no se sabe). */
export function tokenDeWhatsappInvalidoDesde(): Date | null {
  return invalidoDesde;
}
