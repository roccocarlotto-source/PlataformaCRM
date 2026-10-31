import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { deriveKey, parseMasterKey } from "../utils/encryption";

// ---------------------------------------------------------------------------
// AGE-01 (docs-privados/auditoria-2026-10-21, local): EL HISTORIAL DE LA
// CHARLA CON EL ASISTENTE LO GUARDA EL NAVEGADOR, Y EL SERVIDOR NO LE CREÍA
// NADA... PERO LO MANDABA AL MODELO COMO RESPUESTAS PROPIAS.
//
// Con un historial fabricado ("el asistente ya aceptó que…") se podía
// condicionar la respuesta siguiente. Ahora cada respuesta sale con una firma
// (HMAC-SHA256) sobre quién preguntó, qué preguntó y qué se le respondió, el
// navegador la devuelve con el par, y un par que no verifica se descarta sin
// error. Decisión de Rocco del 2026-10-30.
//
// LA CLAVE se deriva de SECRET_ENCRYPTION_KEY con HKDF y un `info` propio,
// igual que la firma del state de OAuth (utils/oauthState.ts): sin variable
// nueva, y la subclave es independiente de las otras. Sin SECRET_ENCRYPTION_KEY
// (o con una inválida) el asistente sigue andando, pero SIN historial: nada se
// firma y nada verifica.
// ---------------------------------------------------------------------------

const INFO_FIRMA = "plataforma-crm:help-assistant-history:v1";

export interface ParFirmado {
  organizationId: string;
  userId: string;
  pregunta: string;
  respuesta: string;
}

export interface Firmante {
  /** La firma del par, o null si no hay clave (el asistente anda sin historial). */
  firmar(par: ParFirmado): string | null;
  verificar(par: ParFirmado, firma: string | undefined): boolean;
}

function contenido(par: ParFirmado): string {
  // JSON de una lista: sin ambigüedad entre dónde termina un campo y empieza
  // el otro.
  return JSON.stringify(["v1", par.organizationId, par.userId, par.pregunta, par.respuesta]);
}

export function crearFirmante(clave: Uint8Array | null): Firmante {
  if (!clave) {
    return { firmar: () => null, verificar: () => false };
  }
  const firmar = (par: ParFirmado) =>
    createHmac("sha256", clave).update(contenido(par)).digest("base64url");
  return {
    firmar,
    verificar(par, firma) {
      if (!firma) return false;
      const esperada = Buffer.from(firmar(par));
      const recibida = Buffer.from(firma);
      return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
    },
  };
}

let firmante: Firmante | undefined;

// Perezoso y memoizado, como getCifrador(): el servidor arranca sin la clave.
export function getFirmanteDelHistorial(): Firmante {
  if (firmante) return firmante;
  let clave: Uint8Array | null = null;
  if (env.SECRET_ENCRYPTION_KEY) {
    try {
      clave = deriveKey(parseMasterKey(env.SECRET_ENCRYPTION_KEY), INFO_FIRMA);
    } catch (err) {
      logger.error(
        { err },
        "SECRET_ENCRYPTION_KEY inválida: el asistente de ayuda anda sin historial",
      );
    }
  } else {
    logger.warn("Sin SECRET_ENCRYPTION_KEY: el asistente de ayuda anda sin historial");
  }
  firmante = crearFirmante(clave);
  return firmante;
}
