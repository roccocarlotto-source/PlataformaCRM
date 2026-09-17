import { within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

// Elige una opción de un combobox del design system (design-system/Select),
// el reemplazo de `user.selectOptions` para los selectores migrados en
// docs/frontend-cambios-pendientes.md §44 (UserSelect, BranchSelect). El panel
// no está en el DOM hasta que se abre, así que primero se hace click en el
// input. La opción se busca dentro de la raíz del propio Select y por nombre
// accesible, que es solo el rótulo (el email de una persona es la
// descripción): así un formulario con dos selectores abiertos en sucesión no
// agarra la fila de otro.
export async function chooseSelectOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionName: string,
) {
  await user.click(combobox);
  const root = combobox.parentElement ?? document.body;
  await user.click(within(root).getByRole("option", { name: optionName }));
}

// Los nombres de las filas que ofrece el panel, en orden. Abre el panel y lo
// deja abierto: sirve para afirmar qué se ofrece (p. ej. que "Sin asignar" no
// está con clearable={false}), el equivalente a listar los <option>.
export async function listSelectOptions(user: UserEvent, combobox: HTMLElement) {
  await user.click(combobox);
  const root = combobox.parentElement ?? document.body;
  return within(root)
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-labelledby"))
    .map((labelId) => (labelId ? document.getElementById(labelId)?.textContent : null));
}
