import { createHash } from "node:crypto";
import { AppError } from "./AppError";

// ---------------------------------------------------------------------------
// externalId — la clave de idempotencia de la ingesta
// (docs/ingestion-architecture.md §4).
//
// §4 dice que cada evento trae "un externalId provisto por la fuente o
// derivado determinísticamente del payload (hash estable del contenido)", y §8
// advierte explícitamente contra "confiar en que el externalId viene siempre".
//
// Decidido en el ítem 4:
//   - Provisto: header X-External-Id. Fuera del payload a propósito — el
//     cuerpo queda crudo e intacto (§1) y ninguna de sus claves adquiere un
//     significado especial para nosotros, que es territorio de `fieldMapping`
//     (ítem 4c/5, todavía sin forma definida).
//   - Derivado: SHA-256 sobre el JSON CANÓNICO del payload (claves ordenadas
//     recursivamente), no sobre los bytes crudos del request.
//
// POR QUÉ CANÓNICO Y NO BYTES CRUDOS. El caso que la idempotencia existe para
// cubrir es el reintento de un webhook, y un reintento puede reserializar el
// mismo contenido con otro orden de claves o distinto espaciado. Sobre bytes
// crudos eso daría otro hash y entraría como evento nuevo: la garantía se
// rompería justo en el escenario que la motiva. Además `rawPayload` es jsonb,
// que YA normaliza espacios y orden al almacenar — hashear bytes crudos
// afirmaría una precisión que la columna de destino no conserva.
//
// CONSECUENCIA QUE HAY QUE TENER PRESENTE, no es un efecto secundario oculto:
// como el fallback siempre produce un valor, externalId NUNCA es null por este
// camino, así que el único parcial `(source_id, external_id) WHERE external_id
// IS NOT NULL` aplica SIEMPRE. Dos envíos con contenido byte-equivalente y sin
// X-External-Id colapsan en UN evento, incluso si de verdad fueran dos
// personas distintas cargando exactamente los mismos datos. Es lo que pide §4;
// una fuente que necesite distinguirlos tiene que mandar su propio
// X-External-Id.
// ---------------------------------------------------------------------------

// external_id es VarChar(255) en ingestion_events. Un SHA-256 hex son 64
// caracteres, así que el derivado entra siempre; el límite solo acota lo que
// puede mandar una fuente.
export const EXTERNAL_ID_MAX_LENGTH = 255;

// Tope de anidamiento para la canonicalización. No es una regla de negocio: es
// una defensa contra el desborde de pila. `canonicalize` es recursiva, y un
// payload de 64 KB permitido por el límite de body puede tener decenas de
// miles de niveles de `[[[[...]]]]`. 32 niveles es holgado para cualquier
// formulario real y convierte un stack overflow (500, proceso comprometido) en
// un 400 con mensaje.
export const MAX_PAYLOAD_DEPTH = 32;

// Devuelve una copia con las claves de todo objeto ordenadas lexicográficamente
// y en cualquier otro aspecto idéntica. Los arrays CONSERVAN su orden: en un
// array el orden es contenido, no presentación.
//
// Solo ve la salida de JSON.parse, así que los únicos tipos posibles son
// null/boolean/number/string/array/objeto plano — no hay Date, Map, undefined
// ni referencias circulares que contemplar.
function canonicalize(value: unknown, depth: number): unknown {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new AppError(
      `El payload excede los ${MAX_PAYLOAD_DEPTH} niveles de anidamiento permitidos`,
      400,
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const entrada = value as Record<string, unknown>;
    const ordenado: Record<string, unknown> = {};
    for (const clave of Object.keys(entrada).sort()) {
      ordenado[clave] = canonicalize(entrada[clave], depth + 1);
    }
    return ordenado;
  }

  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, 0));
}

// SHA-256 hex (64 caracteres). El mismo primitivo que hashApiKey pero con otro
// propósito y sin ninguna propiedad de seguridad detrás: acá no hay secreto que
// proteger, solo un identificador estable y de longitud fija para el contenido.
export function deriveExternalId(payload: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(payload), "utf8")
    .digest("hex");
}
