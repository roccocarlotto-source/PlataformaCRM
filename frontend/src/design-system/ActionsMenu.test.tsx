import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ActionsMenu, type ActionsMenuAction } from "./ActionsMenu";

// MemoryRouter porque una acción con `to` es un Link de react-router, como
// en cualquier ListPage.
function renderMenu(actions: ActionsMenuAction[], label?: string) {
  return render(
    <MemoryRouter>
      <p>afuera</p>
      <ActionsMenu actions={actions} label={label} />
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByRole("button", { name: "Más acciones" });

describe("ActionsMenu", () => {
  it("cerrado por defecto: trigger con nombre accesible, aria-expanded=false y sin menú en el DOM", () => {
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("label reemplaza a 'Más acciones'", () => {
    renderMenu([{ label: "Editar", to: "/x/edit" }], "Más acciones de Acme");
    expect(screen.getByRole("button", { name: "Más acciones de Acme" })).toBeInTheDocument();
  });

  it("click en el trigger abre: menú rotulado por el trigger, un menuitem por acción, foco en el primero", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Más acciones" });
    expect(trigger()).toHaveAttribute("aria-controls", menu.id);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Editar", "Eliminar"]);
    expect(items[0]).toHaveFocus();
  });

  it("una acción con `to` es un link con href real; una con onClick es un botón", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());

    const editar = screen.getByRole("menuitem", { name: "Editar" });
    expect(editar.tagName).toBe("A");
    expect(editar).toHaveAttribute("href", "/x/edit");
    expect(screen.getByRole("menuitem", { name: "Eliminar" }).tagName).toBe("BUTTON");
  });

  it("un segundo click en el trigger cierra", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(trigger());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("un click afuera cierra", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());
    await user.click(screen.getByText("afuera"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Escape cierra y devuelve el foco al trigger", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("elegir una acción llama a su onClick, cierra el menú y devuelve el foco al trigger", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: onDelete },
    ]);

    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("keepOpen: elegir la acción la ejecuta pero deja el menú abierto", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    renderMenu([
      { label: "Copiar link", onClick: onCopy, keepOpen: true },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Copiar link" }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("la acción destructiva lleva la marca visual --danger; las demás no", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn(), destructive: true },
    ]);

    await user.click(trigger());

    expect(screen.getByRole("menuitem", { name: "Eliminar" })).toHaveClass(
      "ds-actions-menu-item--danger",
    );
    expect(screen.getByRole("menuitem", { name: "Editar" })).not.toHaveClass(
      "ds-actions-menu-item--danger",
    );
  });

  it("una acción disabled queda en el menú, deshabilitada, y no responde al click", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderMenu([
      { label: "Desactivar", onClick: onToggle, disabled: true },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());
    const desactivar = screen.getByRole("menuitem", { name: "Desactivar" });
    expect(desactivar).toBeDisabled();
    // El foco inicial salta la deshabilitada.
    expect(screen.getByRole("menuitem", { name: "Eliminar" })).toHaveFocus();
    await user.click(desactivar);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("navegación por teclado: flechas con vuelta, Home/End, ArrowUp desde el trigger abre en el último", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Ver claves", to: "/x/keys" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);
    const item = (name: string) => screen.getByRole("menuitem", { name });

    trigger().focus();
    await user.keyboard("{ArrowUp}");
    expect(item("Eliminar")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(item("Editar")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Ver claves")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("Editar")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("Eliminar")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("Editar")).toHaveFocus();
    await user.keyboard("{End}");
    expect(item("Eliminar")).toHaveFocus();
  });

  it("ArrowDown desde el trigger abre con el foco en el primero; Tab cierra", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    trigger().focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveFocus();

    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("los ítems no entran en el orden de tabulación (tabIndex -1)", async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: "Editar", to: "/x/edit" },
      { label: "Eliminar", onClick: vi.fn() },
    ]);

    await user.click(trigger());
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }
  });
});
