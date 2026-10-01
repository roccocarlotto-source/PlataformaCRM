import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider } from "./ConfirmDialog";
import { useConfirm, type ConfirmOptions } from "./useConfirm";

function Pantalla({ message, options }: { message: string; options?: ConfirmOptions }) {
  const confirm = useConfirm();
  const [resultado, setResultado] = useState<string>("sin responder");
  return (
    <>
      <button onClick={async () => setResultado(String(await confirm(message, options)))}>
        Eliminar empresa
      </button>
      <p>Resultado: {resultado}</p>
    </>
  );
}

function renderConProvider(message: string, options?: ConfirmOptions) {
  return render(
    <ConfirmProvider>
      <Pantalla message={message} options={options} />
    </ConfirmProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ConfirmDialog", () => {
  it("abre un diálogo con la pregunta como título y el resto como cuerpo", async () => {
    renderConProvider("¿Cancelar esta reserva? El turno queda libre y no se puede deshacer.");
    await userEvent.click(screen.getByRole("button", { name: "Eliminar empresa" }));

    const dialogo = screen.getByRole("dialog", { name: "¿Cancelar esta reserva?" });
    expect(dialogo).toHaveTextContent("El turno queda libre y no se puede deshacer.");
  });

  it("con la pregunta al final, el título es la pregunta y el cuerpo lo de antes", async () => {
    renderConProvider("Este resumen lo editó una persona. ¿Seguir?");
    await userEvent.click(screen.getByRole("button", { name: "Eliminar empresa" }));

    const dialogo = screen.getByRole("dialog", { name: "¿Seguir?" });
    expect(dialogo).toHaveTextContent("Este resumen lo editó una persona.");
  });

  it("cancelLabel cambia el rótulo del botón que no confirma", async () => {
    renderConProvider("¿Cancelar esta reserva?", {
      confirmLabel: "Cancelar reserva",
      cancelLabel: "Volver",
    });
    await userEvent.click(screen.getByRole("button", { name: "Eliminar empresa" }));

    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar reserva" })).toBeInTheDocument();
  });

  it("confirmar resuelve true y cierra el diálogo", async () => {
    renderConProvider("¿Eliminar esta empresa?", { confirmLabel: "Eliminar", danger: true });
    await userEvent.click(screen.getByRole("button", { name: "Eliminar empresa" }));

    const confirmar = screen.getByRole("button", { name: "Eliminar" });
    expect(confirmar).toHaveClass("ds-button--danger");
    await userEvent.click(confirmar);

    expect(await screen.findByText("Resultado: true")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["Cancelar", async () => userEvent.click(screen.getByRole("button", { name: "Cancelar" }))],
    ["la ×", async () => userEvent.click(screen.getByRole("button", { name: "Cerrar diálogo" }))],
    ["Escape", async () => userEvent.keyboard("{Escape}")],
  ])("cerrar con %s resuelve false", async (_, cerrar) => {
    renderConProvider("¿Eliminar esta empresa?");
    await userEvent.click(screen.getByRole("button", { name: "Eliminar empresa" }));
    await cerrar();

    expect(await screen.findByText("Resultado: false")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sin provider cae en window.confirm con el mismo mensaje", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Pantalla message="¿Eliminar esta empresa?" />);
    await userEvent.click(screen.getByRole("button", { name: "Eliminar empresa" }));

    expect(confirmSpy).toHaveBeenCalledWith("¿Eliminar esta empresa?");
    expect(await screen.findByText("Resultado: true")).toBeInTheDocument();
  });
});
