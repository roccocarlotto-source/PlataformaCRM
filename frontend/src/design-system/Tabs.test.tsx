import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "./Tabs";

const OPCIONES = [
  { value: "clientes", label: "Clientes" },
  { value: "consultas", label: "Consultas sin identificar" },
] as const;

describe("Tabs", () => {
  it("es un tablist con la elegida marcada y la única en el orden de tabulación", () => {
    render(<Tabs label="Vistas" value="consultas" options={[...OPCIONES]} onChange={() => {}} />);

    expect(screen.getByRole("tablist", { name: "Vistas" })).toBeInTheDocument();
    const clientes = screen.getByRole("tab", { name: "Clientes" });
    const consultas = screen.getByRole("tab", { name: "Consultas sin identificar" });
    expect(consultas).toHaveAttribute("aria-selected", "true");
    expect(consultas).toHaveAttribute("tabindex", "0");
    expect(clientes).toHaveAttribute("aria-selected", "false");
    expect(clientes).toHaveAttribute("tabindex", "-1");
  });

  it("click en otra pestaña avisa; click en la elegida no", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Tabs label="Vistas" value="clientes" options={[...OPCIONES]} onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Clientes" }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Consultas sin identificar" }));
    expect(onChange).toHaveBeenCalledWith("consultas");
  });

  it("flechas, Inicio y Fin cambian de pestaña con el foco (activación automática, circular)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Tabs label="Vistas" value="clientes" options={[...OPCIONES]} onChange={onChange} />);

    screen.getByRole("tab", { name: "Clientes" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("consultas");
    expect(screen.getByRole("tab", { name: "Consultas sin identificar" })).toHaveFocus();

    // Desde la última, la flecha derecha vuelve a la primera.
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("clientes");
    expect(screen.getByRole("tab", { name: "Clientes" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("consultas");
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("clientes");
  });
});
