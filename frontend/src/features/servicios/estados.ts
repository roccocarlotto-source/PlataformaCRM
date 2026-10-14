import type { EstadoDeOrden } from "./types";

// Los estados de la orden y sus transiciones (docs/servicios.md §3.2). Copia de
// src/servicios/config/estados.ts del backend: estados.test.ts compara las dos,
// así que no pueden separarse sin que falle un test. El backend decide; acá
// solo se eligen los botones y las columnas del tablero donde se puede soltar.

export const ESTADOS_ABIERTOS: readonly EstadoDeOrden[] = [
  "AGENDADO",
  "RECIBIDO",
  "EN_TRABAJO",
  "ESPERANDO_APROBACION",
  "LISTO_PARA_RETIRAR",
];

export const TRANSICIONES: Readonly<Record<EstadoDeOrden, readonly EstadoDeOrden[]>> = {
  AGENDADO: ["RECIBIDO", "CANCELADO"],
  RECIBIDO: ["EN_TRABAJO", "ESPERANDO_APROBACION", "LISTO_PARA_RETIRAR", "CANCELADO"],
  EN_TRABAJO: ["ESPERANDO_APROBACION", "LISTO_PARA_RETIRAR", "CANCELADO"],
  ESPERANDO_APROBACION: ["EN_TRABAJO", "LISTO_PARA_RETIRAR", "CANCELADO"],
  LISTO_PARA_RETIRAR: ["ENTREGADO", "EN_TRABAJO"],
  ENTREGADO: [],
  CANCELADO: [],
};

export function puedePasar(desde: EstadoDeOrden, hacia: EstadoDeOrden): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export function esAbierto(estado: EstadoDeOrden): boolean {
  return ESTADOS_ABIERTOS.includes(estado);
}

/** El texto del botón que lleva a cada estado, según desde dónde. */
export function accionHacia(desde: EstadoDeOrden, hacia: EstadoDeOrden): string {
  switch (hacia) {
    case "RECIBIDO":
      return "Recibir el auto";
    case "EN_TRABAJO":
      return desde === "RECIBIDO" ? "Empezar el trabajo" : "Volver a trabajo";
    case "ESPERANDO_APROBACION":
      return "Esperar aprobación";
    case "LISTO_PARA_RETIRAR":
      return "Listo para retirar";
    case "ENTREGADO":
      return "Entregar";
    case "CANCELADO":
      return "Cancelar la orden";
    default:
      return hacia;
  }
}
