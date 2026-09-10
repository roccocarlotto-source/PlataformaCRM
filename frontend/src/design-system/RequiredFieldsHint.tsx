// ---------------------------------------------------------------------------
// Referencia genérica al pie de un formulario: qué significa el "*" que
// .ds-required dibuja junto al rótulo de un campo obligatorio (ítem 10 de
// docs/frontend-cambios-pendientes.md). Es un .ds-hint con texto fijo — el
// mismo trato visual (chico, mutado) que los demás textos auxiliares del
// sistema — y es componente y no texto suelto porque nace con once
// consumidores y la frase tiene que ser idéntica en todos.
//
// Va UNA sola vez por formulario, junto al botón de guardar, nunca repetida
// por tarjeta. Sin props a propósito: la frase es única; si un formulario
// necesitara otra, sería otro componente.
// ---------------------------------------------------------------------------
export function RequiredFieldsHint() {
  return <p className="ds-hint">Los campos con asterisco (*) son obligatorios.</p>;
}
