// Presentación de Stage.probability, compartida por StageListPage (la
// pantalla de etapas de siempre) y StageEditor (el editor integrado en el
// formulario de Pipeline, docs/frontend-cambios-pendientes.md §11). Nacieron
// en StageListPage y se extrajeron acá, sin cambios, cuando apareció el
// segundo consumidor.

// probability siempre llega como string desde la API (Prisma.Decimal,
// ver types.ts) — Number() antes de formatear, nunca .toFixed() directo
// sobre el valor crudo.
//
// Un 0 se muestra como guión, no como "0%" (docs/frontend-cambios-pendientes.md
// §14): desde que el campo está oculto por defecto (§13), la mayoría de los 0
// son etapas donde nunca se abrió Probabilidad, no un 0% cargado a propósito.
// Limitación aceptada: el modelo de datos no distingue los dos casos (los dos
// guardan probability: 0), así que el guión aplica a cualquier 0. Solo cambia
// el texto; la barra (probabilityWidth) sigue dibujándose vacía con 0.
export function formatProbability(probability: string): string {
  const value = Number(probability);
  if (value === 0) return "-";
  return `${value}%`;
}

// Ancho de la barra de probabilidad: el dato real acotado a 0–100. El
// backend ya lo valida en ese rango; el clamp solo evita que un valor
// fuera de rango (o NaN) dibuje una barra rota.
export function probabilityWidth(probability: string): number {
  const value = Number(probability);
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
