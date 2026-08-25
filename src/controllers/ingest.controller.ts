import type { Response } from "express";
import { ingestEvent } from "../services/ingest.service";
import type { IngestRequest } from "../types/ingest";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { EXTERNAL_ID_MAX_LENGTH } from "../utils/externalId";

// El externalId provisto por la fuente viaja en su propio header, fuera del
// payload: así el cuerpo queda crudo e intacto (§1) y ninguna de sus claves
// significa nada para nosotros — eso es territorio de fieldMapping, que define
// el ítem 4c/5.
const EXTERNAL_ID_HEADER = "x-external-id";

// Sin zod: no hay un objeto que parsear, es un header opcional con dos reglas.
// Nada de trim y nada de normalizar — a diferencia de la clave, acá no es una
// cuestión de seguridad sino de fidelidad: el externalId es el identificador
// que la fuente eligió, y si lo tocáramos dejaría de coincidir con el que ella
// va a mandar en el reintento, que es todo el punto de la idempotencia.
function parseExternalIdHeader(valor: string | string[] | undefined): string | undefined {
  if (valor === undefined) {
    return undefined;
  }

  // Header repetido -> array. No se elige uno: dos identificadores distintos
  // para el mismo evento no tienen resolución correcta, y quedarse con el
  // primero significaría deduplicar contra algo que el emisor no eligió.
  if (typeof valor !== "string") {
    throw new AppError(`${EXTERNAL_ID_HEADER} no puede repetirse`, 400);
  }

  // Vacío se trata como ausente, no como error: mandar el header en blanco es
  // lo que hace un cliente que arma sus headers a partir de una variable sin
  // valor, y el fallback derivado del contenido cubre ese caso exactamente
  // igual de bien.
  if (valor.length === 0) {
    return undefined;
  }

  // external_id es VarChar(255). Sin este chequeo el error sería un 500 de
  // Postgres al insertar, con un mensaje que no le dice nada al emisor.
  if (valor.length > EXTERNAL_ID_MAX_LENGTH) {
    throw new AppError(
      `${EXTERNAL_ID_HEADER} no puede superar los ${EXTERNAL_ID_MAX_LENGTH} caracteres`,
      400,
    );
  }

  return valor;
}

// 202 ACCEPTED, NO 201: no se creó ningún recurso de negocio. Se aceptó un
// evento para procesarlo después, y el emisor no debe interpretar esta
// respuesta como "el contacto existe". La promoción es el ítem 4c y puede
// terminar en FAILED (§5).
//
// EL MISMO 202 PARA UN externalId REPETIDO, con el id del evento que YA estaba
// y `duplicate: true`. Es la definición de idempotente: la segunda llamada deja
// el sistema en el mismo estado que la primera y lo reporta igual.
//
// Por qué no 409: el reintento de webhook es EL caso que la idempotencia existe
// para cubrir (§4), no un caso borde. Un emisor que recibe 4xx concluye que
// falló y vuelve a intentar — un 409 lo dejaría reintentando en loop contra
// algo que ya había funcionado a la primera. `duplicate` está para que igual
// pueda distinguirlo y dejar de insistir, sin que nada se rompa si lo ignora.
//
// La respuesta NUNCA echoea la clave, ni entera ni en parte: son tres campos y
// ninguno deriva de ella.
export const ingestHandler = asyncHandler<IngestRequest>(
  async (req, res: Response) => {
    const externalId = parseExternalIdHeader(req.headers[EXTERNAL_ID_HEADER]);
    const result = await ingestEvent(req.ingest, req.body, externalId);
    res.status(202).json(result);
  },
);
