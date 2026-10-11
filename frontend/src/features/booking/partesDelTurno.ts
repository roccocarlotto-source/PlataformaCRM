// ---------------------------------------------------------------------------
// Las partes que comparten los dos diálogos que dan un turno desde la agenda:
// el panel del click en la grilla (CreateBookingPanel, cualquier rubro) y
// "Nuevo turno" de una clínica (features/clinica/NuevoTurnoDialog, con el
// primero libre, docs/rubros.md §4.3). Mismo botón y mismo error en los dos.
// ---------------------------------------------------------------------------

/** El botón principal del Modal: "Reservar", y "Reservando…" mientras viaja. */
export function accionDeReservar({
  formId,
  puedeEnviar,
  enviando,
}: {
  formId: string;
  puedeEnviar: boolean;
  enviando: boolean;
}) {
  return {
    label: enviando ? "Reservando…" : "Reservar",
    formId,
    disabled: !puedeEnviar,
    loading: enviando,
  };
}
