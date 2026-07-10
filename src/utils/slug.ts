// Normaliza un nombre a un slug: minusculas, sin acentos, solo [a-z0-9-].
// Sin logica de sufijo por colision -- una colision de slug se resuelve como
// error (409), no generando una variante (ver docs/authentication-architecture.md
// seccion 1, decision explicita distinta al diseno original).
//
// \p{M} (Unicode "Mark" category) matches the combining diacritical marks
// that NFD normalization splits accented letters into (e.g. "é" -> "e" + "´").
const COMBINING_MARKS_PATTERN = /\p{M}/gu;

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
