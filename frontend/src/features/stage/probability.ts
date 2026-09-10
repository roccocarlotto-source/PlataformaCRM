// Presentación de Stage.probability, compartida por StageListPage (la
// pantalla de etapas de siempre) y StageEditor (el editor integrado en el
// formulario de Pipeline, docs/frontend-cambios-pendientes.md §11). Nacieron
// en StageListPage y se extrajeron acá, sin cambios, cuando apareció el
// segundo consumidor.

// probability siempre llega como string desde la API (Prisma.Decimal,
// ver types.ts) — Number() antes de formatear, nunca .toFixed() directo
// sobre el valor crudo.
export function formatProbability(probability: string): string {
  return `${Number(probability)}%`;
}

// Ancho de la barra de probabilidad: el dato real acotado a 0–100. El
// backend ya lo valida en ese rango; el clamp solo evita que un valor
// fuera de rango (o NaN) dibuje una barra rota.
export function probabilityWidth(probability: string): number {
  const value = Number(probability);
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
