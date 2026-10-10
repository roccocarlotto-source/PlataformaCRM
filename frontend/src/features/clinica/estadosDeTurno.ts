import type { Booking } from "../booking/types";

// Cómo se muestra un turno de clínica ya marcado (docs/rubros.md §4.8, R10).
export const ROTULO_DE_ESTADO: Partial<Record<Booking["status"], string>> = {
  COMPLETED: "Atendido",
  NO_SHOW: "No vino",
};
