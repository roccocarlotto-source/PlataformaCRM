import { z } from "zod";
import { mensajesDeTipo } from "../../utils/erroresDeZod";
import { sumarMesesAUnaFecha } from "../proximoService";

// ---------------------------------------------------------------------------
// El aviso de recambio (docs/servicios.md §7, S13): constantes, schema y
// fechas. Puro, sin base: lo importa el catálogo de triggers.
//
//   - Fecha de recambio = fecha de compra + monthsAfterPurchase (default 48).
//   - Fecha de aviso = fecha de recambio − daysBefore (default 60).
//   - Las dos son fechas sin hora (@db.Date, medianoche UTC): se suman meses
//     en UTC (sumarMesesAUnaFecha, S10), nunca pasando por la zona.
//   - Sin fecha de compra no hay recambio (D12).
// ---------------------------------------------------------------------------

export const TRIGGER_RECAMBIO = "service.replacement_due";

export const MESES_HASTA_EL_RECAMBIO = 48;
export const DIAS_ANTES_DEL_RECAMBIO = 60;
// La ventana del barrido, como la del próximo service (§6.2): cubre un día sin
// barrido sin avisar recambios de hace meses.
export const MARGEN_DEL_RECAMBIO = 7;

export const configDelRecambioSchema = z.object({
  monthsAfterPurchase: z
    .number(mensajesDeTipo({ tipo: "monthsAfterPurchase debe ser un número entero" }))
    .int("monthsAfterPurchase debe ser un número entero")
    .min(12, "monthsAfterPurchase no puede ser menor que 12")
    .max(120, "monthsAfterPurchase no puede superar 120")
    .default(MESES_HASTA_EL_RECAMBIO),
  daysBefore: z
    .number(mensajesDeTipo({ tipo: "daysBefore debe ser un número entero" }))
    .int("daysBefore debe ser un número entero")
    .min(0, "daysBefore no puede ser negativo")
    .max(180, "daysBefore no puede superar 180")
    .default(DIAS_ANTES_DEL_RECAMBIO),
});

export type ConfigDelRecambio = z.infer<typeof configDelRecambioSchema>;

export const CONFIG_DEL_RECAMBIO_POR_DEFECTO: ConfigDelRecambio = {
  monthsAfterPurchase: MESES_HASTA_EL_RECAMBIO,
  daysBefore: DIAS_ANTES_DEL_RECAMBIO,
};

const DIA_MS = 24 * 60 * 60 * 1000;

export function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * DIA_MS);
}

export function fechaDeRecambio(compra: Date, config: ConfigDelRecambio): Date {
  return sumarMesesAUnaFecha(compra, config.monthsAfterPurchase);
}

export function fechaDeAviso(compra: Date, config: ConfigDelRecambio): Date {
  return sumarDias(fechaDeRecambio(compra, config), -config.daysBefore);
}

/** Las fechas de compra que pueden caer en la ventana del barrido, con un
 *  margen de 3 días para los fines de mes (sumar meses no es invertible: 31/01
 *  + 1 mes = 28/02). El filtro exacto lo hace laFechaDeAvisoCae. */
export function comprasPosibles(
  hoy: Date,
  config: ConfigDelRecambio,
): { desde: Date; hasta: Date } {
  const avisoDesde = sumarDias(hoy, -MARGEN_DEL_RECAMBIO);
  return {
    desde: sumarDias(
      sumarMesesAUnaFecha(sumarDias(avisoDesde, config.daysBefore), -config.monthsAfterPurchase),
      -3,
    ),
    hasta: sumarDias(
      sumarMesesAUnaFecha(sumarDias(hoy, config.daysBefore), -config.monthsAfterPurchase),
      3,
    ),
  };
}

/** ¿La fecha de aviso de esta compra cae en [hoy − 7, hoy]? */
export function laFechaDeAvisoCae(compra: Date, hoy: Date, config: ConfigDelRecambio): boolean {
  const aviso = fechaDeAviso(compra, config).getTime();
  return aviso >= sumarDias(hoy, -MARGEN_DEL_RECAMBIO).getTime() && aviso <= hoy.getTime();
}

/** "15/10/2022" */
export function textoDeLaFechaDeCompra(fecha: Date): string {
  const [anio, mes, dia] = fecha.toISOString().slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

/** El título de la tarea de §7.3 (la de la lista, y la regla sin título). */
export function asuntoDelRecambio(cliente: string, vehiculo: string, compra: Date): string {
  return `Contactar a ${cliente}: se acerca el recambio de su ${vehiculo} (comprado el ${textoDeLaFechaDeCompra(compra)})`.slice(
    0,
    255,
  );
}
