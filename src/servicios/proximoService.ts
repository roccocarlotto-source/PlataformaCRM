import { DateTime } from "luxon";
import { zonaValidaOUtc } from "../utils/zonedWindow";

// ---------------------------------------------------------------------------
// La fecha del próximo service al entregar una orden (docs/servicios.md §6.1).
//
//   1. Entre los tipos de la orden con intervalo, manda el MENOR.
//   2. Si ninguno tiene, el intervalo por defecto de la configuración.
//      Si también es null, no se propone fecha.
//   3. Fecha = la de entrega, en la zona de la organización, + N meses. Si el
//      día no existe en ese mes, el último día del mes (luxon lo hace así:
//      31 de enero + 1 mes = 28 o 29 de febrero).
//
// La persona que entrega la ve propuesta y la puede cambiar o dejar sin fecha.
// ---------------------------------------------------------------------------

/** Cuántos meses: el menor de los tipos, si alguno tiene; si no, el default. */
export function mesesHastaElProximoService(
  intervalosDeLosTipos: readonly (number | null)[],
  porDefecto: number | null,
): number | null {
  const conIntervalo = intervalosDeLosTipos.filter((m): m is number => m !== null);
  if (conIntervalo.length > 0) return Math.min(...conIntervalo);
  return porDefecto;
}

/** "AAAA-MM-DD": la fecha de entrega en la zona de la organización + N meses. */
export function fechaDelProximoService(entrega: Date, zona: string, meses: number): string {
  return DateTime.fromJSDate(entrega, { zone: zonaValidaOUtc(zona) })
    .plus({ months: meses })
    .toISODate() as string;
}

export function proponerProximoService(
  entrega: Date,
  zona: string,
  intervalosDeLosTipos: readonly (number | null)[],
  porDefecto: number | null,
): { fecha: string | null; meses: number | null } {
  const meses = mesesHastaElProximoService(intervalosDeLosTipos, porDefecto);
  return { meses, fecha: meses === null ? null : fechaDelProximoService(entrega, zona, meses) };
}
