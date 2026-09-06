import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

// El pie del panel (.ds-modal-actions) es el único lugar donde importa cuántos
// botones hay y en qué orden: por eso estos tests lo acotan con within en vez
// de contar botones en todo el diálogo (el cuerpo puede traer los suyos).
function pie(container: HTMLElement) {
  const actions = container.querySelector(".ds-modal-actions");
  expect(actions).not.toBeNull();
  return within(actions as HTMLElement);
}

describe("Modal", () => {
  it("expone role=dialog, aria-modal y el título asociado", () => {
    render(
      <Modal title="Clave creada" onClose={vi.fn()}>
        <p>contenido</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // El título accesible sale del aria-labelledby, no de un hardcode.
    expect(dialog).toHaveAccessibleName("Clave creada");
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("lleva el foco al diálogo al montarse", () => {
    render(
      <Modal title="T" onClose={vi.fn()}>
        <p>c</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("NO se cierra al hacer click afuera — el secreto no se puede recuperar", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Modal title="T" onClose={onClose}>
        <p>c</p>
      </Modal>,
    );

    const overlay = container.querySelector(".ds-modal-overlay");
    expect(overlay).not.toBeNull();
    await user.click(overlay!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("NO se cierra con Escape, por el mismo motivo", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={onClose}>
        <p>c</p>
      </Modal>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("se cierra SOLO con el botón explícito", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={onClose} closeLabel="Listo">
        <p>c</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Listo" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --- Panel: encabezado con "×" y pie de uno o dos botones -----------------

  it("el × del encabezado también llama a onClose: es un tercer click explícito, no un gesto", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={onClose}>
        <p>c</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Cerrar panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sin primaryAction el pie tiene un solo botón, el de cierre", () => {
    const { container } = render(
      <Modal title="T" onClose={vi.fn()} closeLabel="Listo">
        <p>c</p>
      </Modal>,
    );

    const botones = pie(container).getAllByRole("button");
    expect(botones).toHaveLength(1);
    expect(botones[0]).toHaveTextContent("Listo");
  });

  it("con primaryAction.onClick el pie muestra cierre + primario, en ese orden, y el primario dispara onClick sin cerrar", async () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Modal
        title="T"
        onClose={onClose}
        closeLabel="Cancelar"
        primaryAction={{ label: "Abrir WhatsApp", onClick }}
      >
        <p>c</p>
      </Modal>,
    );

    const botones = pie(container).getAllByRole("button");
    expect(botones.map((boton) => boton.textContent)).toEqual(["Cancelar", "Abrir WhatsApp"]);
    // Sin formId no es un submit: no hay <form> al que disparar.
    expect(botones[1]).toHaveAttribute("type", "button");

    await user.click(botones[1]);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("con primaryAction.formId el primario es un submit asociado por form= al <form> del cuerpo y dispara su onSubmit", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={vi.fn()} primaryAction={{ label: "Crear", formId: "f-test" }}>
        <form id="f-test" onSubmit={onSubmit} noValidate>
          <label>
            Nombre
            <input type="text" />
          </label>
        </form>
      </Modal>,
    );

    const primario = screen.getByRole("button", { name: "Crear" });
    expect(primario).toHaveAttribute("type", "submit");
    expect(primario).toHaveAttribute("form", "f-test");
    // El botón NO está dentro del <form> en el DOM…
    expect(primario.closest("form")).toBeNull();

    // …pero el atributo form= lo asocia igual y el click dispara el submit.
    await user.click(primario);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("primaryAction.disabled deshabilita solo el primario; cerrar sigue disponible", () => {
    const { container } = render(
      <Modal
        title="T"
        onClose={vi.fn()}
        closeLabel="Cancelar"
        primaryAction={{ label: "Guardando…", formId: "f", disabled: true }}
      >
        <form id="f" />
      </Modal>,
    );

    const acciones = pie(container);
    expect(acciones.getByRole("button", { name: "Guardando…" })).toBeDisabled();
    expect(acciones.getByRole("button", { name: "Cancelar" })).toBeEnabled();
  });
});
