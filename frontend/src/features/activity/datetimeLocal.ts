// dueDate/completedAt son DateTime reales en Prisma (con hora, sin @db.Date
// — a diferencia de Opportunity.expectedCloseDate/actualCloseDate). Viajan
// como ISO 8601 en UTC. <input type="datetime-local"> espera y produce un
// valor SIN sufijo de timezone, interpretado como hora local del
// navegador — no se puede reutilizar el patrón .slice(0,10) de Opportunity
// (perdería la hora) ni hidratar con un .slice(0,16) directo del ISO UTC
// (mostraría la hora en UTC, no en la hora local del usuario).

// ISO UTC -> valor de datetime-local (hora local del navegador). Resta el
// offset de timezone del instante antes de renderizarlo en notación UTC:
// el resultado, leído como dígitos, ya es la hora local — se descarta el
// sufijo "Z" con el slice.
export function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

// valor de datetime-local -> ISO UTC. Un string "YYYY-MM-DDTHH:mm" (con
// "T", sin sufijo de offset) se interpreta por spec como hora LOCAL del
// motor de JS — a diferencia de un string solo-fecha ("YYYY-MM-DD", sin
// "T"), que se interpreta como UTC y es la fuente real del bug que
// Opportunity evita con .slice(0,10) del lado de lectura. Acá no hace
// falta ese cuidado: el "T" ya garantiza la interpretación local correcta.
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}
