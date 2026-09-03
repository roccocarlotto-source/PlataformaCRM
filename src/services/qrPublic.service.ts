import {
  consumeSingleUseQrCode,
  findQrCodePublicState,
  type QrPublicState,
} from "../repositories/qrCode.repository";

// ---------------------------------------------------------------------------
// Resolución pública de un QR — la lógica detrás de GET/POST /qr/resolve/:qrId
// (puerto de resolve/index.ts + get_qr_public_state + consume_single_use_qr
// del original; docs/qr-integration.md, Fase 2).
//
// Este service no sabe de HTML ni de HTTP: devuelve un estado y el controller
// decide qué página o qué redirect corresponde. Así el "árbol de estados" que
// la guía enumera vive en UN lugar (renderizado) y la lectura/escritura contra
// la base en otro.
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

// Consumo de un single-use (el POST del botón "Continuar"). Devuelve la URL de
// destino si consumió, o null si no había nada que consumir — reusable, ya
// usado, organización inactiva, borrado o inexistente, todos iguales: el
// controller relee el estado real con getQrPublicState para renderizar lo que
// corresponda, exactamente como el original.
export async function consumeSingleUseQr(qrId: string): Promise<string | null> {
  if (!isUuid(qrId)) {
    return null;
  }
  return consumeSingleUseQrCode(qrId);
}
