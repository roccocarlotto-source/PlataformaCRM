import type { Booking } from "../booking/types";

// Los estados de un turno de clínica: "el turno" es masculino (docs/rubros.md
// §3), y lo marcado se dice como en la agenda (§4.8, R10).
export const ROTULO_DE_ESTADO_DE_CLINICA: Record<Booking["status"], string> = {
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
  COMPLETED: "Atendido",
  NO_SHOW: "No vino",
};

// Cómo se muestra un turno de clínica ya marcado.
export const ROTULO_DE_ESTADO: Partial<Record<Booking["status"], string>> = {
  COMPLETED: ROTULO_DE_ESTADO_DE_CLINICA.COMPLETED,
  NO_SHOW: ROTULO_DE_ESTADO_DE_CLINICA.NO_SHOW,
};
