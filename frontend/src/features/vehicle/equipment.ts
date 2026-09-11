// ---------------------------------------------------------------------------
// Códigos de equipamiento de un vehículo (docs/frontend-cambios-pendientes.md
// §21). El backend (equipmentSchema, src/controllers/vehicle.controller.ts)
// valida la FORMA de cada código —^[A-Z0-9_]{1,50}$, sin repetidos, hasta 100
// ítems— y no su pertenencia a un catálogo, que no existe. Acá se garantiza
// que lo que la persona tipea cumpla esa forma sin que tenga que pensar en
// ella: "Aire acondicionado" -> "AIRE_ACONDICIONADO".
// ---------------------------------------------------------------------------

export const EQUIPMENT_CODE_MAX = 50;
export const EQUIPMENT_MAX_ITEMS = 100;

// Normalización EN VIVO, tecla a tecla, del texto de un chip:
//
//   - NFD separa cada letra acentuada en letra + marca diacrítica y el rango
//     U+0300-U+036F borra esas marcas ("Cámara" -> "Camara"). Misma técnica
//     que normalizarEncabezado (features/source/fieldMapping.ts) y que
//     utils/slug.ts en el backend.
//   - Mayúsculas.
//   - Espacios y guiones pasan a "_" (son los separadores que la gente
//     escribe); cualquier otro carácter fuera de [A-Z0-9_] se descarta.
//   - Sin "_" al principio (un espacio inicial no deja rastro).
//   - Tope de 50 caracteres, el mismo del backend.
//
// A PROPÓSITO no colapsa "__" ni recorta el "_" del final: "AIRE_" es el
// estado natural entre "AIRE" y "AIRE_A" mientras se tipea, y el backend lo
// acepta. Eso se limpia recién al agregar (finalizeEquipmentCode).
export function normalizeEquipmentCode(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "")
    .replace(/^_+/, "")
    .slice(0, EQUIPMENT_CODE_MAX);
}

// Lo que queda guardado al confirmar un chip: lo tipeado, normalizado, sin
// "_" sobrantes en los extremos ("AIRE_ACONDICIONADO_" -> "AIRE_ACONDICIONADO").
// Devuelve "" si no quedó nada con sentido.
export function finalizeEquipmentCode(raw: string): string {
  return normalizeEquipmentCode(raw).replace(/^_+|_+$/g, "");
}
