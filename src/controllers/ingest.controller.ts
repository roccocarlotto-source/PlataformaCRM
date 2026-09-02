import type { Response } from "express";
import { ingestEvent } from "../services/ingest.service";
import type { IngestRequest } from "../types/ingest";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { EXTERNAL_ID_MAX_LENGTH } from "../utils/externalId";
import { countRawHeaderOccurrences } from "../utils/rawHeaders";

// El externalId provisto por la fuente viaja en su propio header, fuera del
// payload: así el cuerpo queda crudo e intacto (§1) y ninguna de sus claves
// significa nada para nosotros — eso es territorio de fieldMapping, que el ítem
// 5 definió y que solo consumen las fuentes FILE_IMPORT.
const EXTERNAL_ID_HEADER = "x-external-id";

// Sin zod: no hay un objeto que parsear, es un header opcional con dos reglas.
// Nada de trim y nada de normalizar — a diferencia de la clave, acá no es una
// cuestión de seguridad sino de fidelidad: el externalId es el identificador
// que la fuente eligió, y si lo tocáramos dejaría de coincidir con el que ella
// va a mandar en el reintento, que es todo el punto de la idempotencia.
//
// B-25: recibe el req entero, no el valor ya normalizado, porque la
// repetición del header NO es observable en req.headers: Node une los valores
// repetidos con ", " en un solo string (el array que este código esperaba
// antes solo existe para set-cookie), así que "X-External-Id: a" +
// "X-External-Id: b" llegaba como el string "a, b", pasaba todos los chequeos
// y se usaba tal cual como externalId — matching de idempotencia incluido. La
// única evidencia del wire es req.rawHeaders (ver utils/rawHeaders.ts).
function parseExternalIdHeader(req: IngestRequest): string | undefined {
  // Header repetido -> 400. No se elige uno: dos identificadores distintos
  // para el mismo evento no tienen resolución correcta, y quedarse con el
  // primero (o con la concatenación que arma Node) significaría deduplicar
  // contra algo que el emisor no eligió.
  if (countRawHeaderOccurrences(req.rawHeaders, EXTERNAL_ID_HEADER) > 1) {
    throw new AppError(`${EXTERNAL_ID_HEADER} no puede repetirse`, 400);
  }

  // Con 0 o 1 ocurrencia garantizada arriba, el valor normalizado es siempre
  // string o undefined — el cast documenta lo que el tipo genérico de
  // req.headers no sabe (string[] existe solo para set-cookie).
  const valor = req.headers[EXTERNAL_ID_HEADER] as string | undefined;

  if (valor === undefined) {
    return undefined;
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
export const ingestHandler = asyncHandler<IngestRequest>(async (req, res: Response) => {
  const externalId = parseExternalIdHeader(req);
  const result = await ingestEvent(req.ingest, req.body, externalId);
  res.status(202).json(result);
});
