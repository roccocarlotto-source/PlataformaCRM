// Filtro de texto de los desplegables del design system (Select y
// MultiSelect): coincidencia por substring sin distinguir mayúsculas ni
// acentos, así "perez" encuentra "Ana Pérez" y "ANA@" su email.
//
// NFD separa cada letra acentuada en letra + marca diacrítica, y el rango
// \u0300-\u036f son justamente esas marcas: al borrarlas queda la letra base.
// Mismo criterio que normalizeEquipmentCode (features/vehicle/equipment.ts),
// que además pasa a mayúsculas y reemplaza espacios porque normaliza códigos;
// acá solo se compara, así que alcanza con minúsculas y sin marcas.
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ¿Alguno de los textos contiene la búsqueda? Una búsqueda vacía (o solo
// espacios) coincide con todo: es la lista sin filtrar. Los textos ausentes
// (un subtítulo opcional) se ignoran.
export function matchesSearch(query: string, texts: (string | undefined)[]): boolean {
  const needle = normalizeSearchText(query.trim());
  if (needle === "") return true;
  return texts.some((text) => text !== undefined && normalizeSearchText(text).includes(needle));
}
