// "30 min", "1 h", "1 h 30 min". Los minutos crudos se leen mal a partir de
// una hora ("90 min"), y el tope del backend es un día entero.
export function formatDuracion(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}
