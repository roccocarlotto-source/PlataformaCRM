import type { DeliveryChecklistItem } from "./types";

// El texto del window.confirm de "Confirmar entrega" (§40): qué implica y
// cuántos ítems del checklist quedan sin marcar. El checklist NO bloquea (a
// veces se entrega sin el manual), pero quien confirma tiene que verlo antes
// de cerrar el ciclo de la unidad. En archivo aparte para que
// DeliverySection.tsx exporte solo el componente (react-refresh).
export function confirmQuestion(checklist: readonly DeliveryChecklistItem[]): string {
  const pending = checklist.filter((item) => !item.checked).length;
  const base =
    "¿Confirmar la entrega? La unidad pasa a Entregado y la entrega ya no se va a poder modificar.";
  if (pending === 0) return base;
  return `${base} Quedan ${pending} ${pending === 1 ? "ítem" : "ítems"} del checklist sin marcar.`;
}
