import { findQrCodePublicState, type QrPublicState } from "../repositories/qrCode.repository";

// ---------------------------------------------------------------------------
// Resolución pública de un QR — la lógica detrás de GET /qr/resolve/:qrId
// (puerto de resolve/index.ts + get_qr_public_state del original;
// docs/qr-integration.md, Fase 2).
//
// Este service no sabe de HTML ni de HTTP: devuelve un estado y el controller
// decide qué página o qué redirect corresponde.
//
// HASTA 20260904120000_remove_qr_claim_and_single_use este archivo también
// tenía consumeSingleUseQr (el POST del botón "Continuar" de un QR de un solo
// uso). Se eliminó junto con el resto del single-use — ver
// docs/qr-integration.md, sección "Qué se desvió".
// ---------------------------------------------------------------------------

// Mismo regex que _shared/validation.ts del original. Un id que no es UUID se
// trata como "no encontrado" ANTES de tocar la base: Prisma tiraría un error
// de conversión sobre una columna @db.Uuid, y un 500 revelaría que el formato
// importa. Nunca 400, nunca decir por qué (DEC-007).
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

// Lectura pura — la única función que llama el GET público. NUNCA escribe, bajo
// ningún input: esa es toda la base de la seguridad frente a los bots de
// preview de WhatsApp/email (Cycle 27 §3 original) — la garantía es que este
// camino no puede alcanzar una escritura, no que reconozca bots.
export async function getQrPublicState(qrId: string): Promise<QrPublicState | null> {
  if (!isUuid(qrId)) {
    return null;
  }
  return findQrCodePublicState(qrId);
}
