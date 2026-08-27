import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

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
});
