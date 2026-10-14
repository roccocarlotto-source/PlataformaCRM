// ---------------------------------------------------------------------------
// Los estados de una orden de servicio y sus transiciones (docs/servicios.md
// §3). La tabla vive en un solo objeto: la usan el service (qué cambio se
// acepta), la pantalla (qué botones y qué columnas del tablero se ofrecen; el
// frontend tiene su copia en features/servicios/estados.ts, que un test
// compara con esta) y estados.test.ts, que recorre todas las combinaciones.
//
// SIN imports a propósito: el test del frontend importa este archivo, y el job
// de frontend del CI no tiene @prisma/client instalado cuando corre el
// typecheck. La unión de abajo es el enum ServiceOrderStatus de Prisma;
// estados.test.ts verifica que sean el mismo en los dos sentidos.
// ---------------------------------------------------------------------------

export type ServiceOrderStatus =
  | "AGENDADO"
  | "RECIBIDO"
  | "EN_TRABAJO"
  | "ESPERANDO_APROBACION"
  | "LISTO_PARA_RETIRAR"
  | "ENTREGADO"
  | "CANCELADO";

export const ESTADOS: readonly ServiceOrderStatus[] = [
  "AGENDADO",
  "RECIBIDO",
  "EN_TRABAJO",
  "ESPERANDO_APROBACION",
  "LISTO_PARA_RETIRAR",
  "ENTREGADO",
  "CANCELADO",
];

/** De Agendado a Listo para retirar: el vehículo tiene una orden abierta. */
export const ESTADOS_ABIERTOS: readonly ServiceOrderStatus[] = [
  "AGENDADO",
  "RECIBIDO",
  "EN_TRABAJO",
  "ESPERANDO_APROBACION",
  "LISTO_PARA_RETIRAR",
];

/** Entregado y Cancelado: finales, no se reabren (D11). */
export const ESTADOS_FINALES: readonly ServiceOrderStatus[] = ["ENTREGADO", "CANCELADO"];

/** Con qué estado puede nacer una orden: Agendado, o Recibido para un auto que
 *  llega sin turno. */
export const ESTADOS_INICIALES: readonly ServiceOrderStatus[] = ["AGENDADO", "RECIBIDO"];

/** §3.2. Desde un estado final no sale nada. */
export const TRANSICIONES: Readonly<Record<ServiceOrderStatus, readonly ServiceOrderStatus[]>> = {
  AGENDADO: ["RECIBIDO", "CANCELADO"],
  RECIBIDO: ["EN_TRABAJO", "ESPERANDO_APROBACION", "LISTO_PARA_RETIRAR", "CANCELADO"],
  EN_TRABAJO: ["ESPERANDO_APROBACION", "LISTO_PARA_RETIRAR", "CANCELADO"],
  ESPERANDO_APROBACION: ["EN_TRABAJO", "LISTO_PARA_RETIRAR", "CANCELADO"],
  LISTO_PARA_RETIRAR: ["ENTREGADO", "EN_TRABAJO"],
  ENTREGADO: [],
  CANCELADO: [],
};

export function puedePasar(desde: ServiceOrderStatus, hacia: ServiceOrderStatus): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export function esAbierto(estado: ServiceOrderStatus): boolean {
  return ESTADOS_ABIERTOS.includes(estado);
}
