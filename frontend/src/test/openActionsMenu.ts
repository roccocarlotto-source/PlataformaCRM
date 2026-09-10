import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

// Abre el menú de 3 puntos (design-system/ActionsMenu) de una fila de
// listado. Las acciones (Editar, Eliminar, Ver claves…) NO están en el DOM
// hasta que se abre, así que todo test que interactúe con una acción de fila
// pasa primero por acá. Sin `row` toma el único trigger de la pantalla: los
// tests de listado suelen renderizar una sola fila. findByRole espera a que
// la fila exista, así que reemplaza también al waitFor previo sobre la
// acción. El nombre se matchea por prefijo porque algunos consumidores lo
// especializan ("Más acciones de Beto Gómez"). Nació con
// docs/frontend-cambios-pendientes.md §8, cuando nueve *ListPage.test.tsx
// necesitaron lo mismo.
export async function openActionsMenu(user: UserEvent, row?: HTMLElement | null) {
  const scope = row ? within(row) : screen;
  await user.click(await scope.findByRole("button", { name: /^Más acciones/ }));
}
