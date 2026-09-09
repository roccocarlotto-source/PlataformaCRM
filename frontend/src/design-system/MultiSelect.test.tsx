import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiSelect, type MultiSelectOption } from "./MultiSelect";

type Estado = "AVAILABLE" | "RESERVED" | "SOLD";

const OPCIONES: MultiSelectOption<Estado>[] = [
  { value: "AVAILABLE", label: "Disponible" },
  { value: "RESERVED", label: "Reservado" },
  { value: "SOLD", label: "Vendido" },
];

// El componente es controlado: para probar una secuencia de clicks hace falta
// un dueño del estado, como lo tendría cualquier ListPage.
function Controlado({
  initial = [],
  onChange,
}: {
  initial?: Estado[];
  onChange?: (value: Estado[]) => void;
}) {
  const [value, setValue] = useState<Estado[]>(initial);
  return (
    <MultiSelect
      id="estado"
      label="Estado"
      options={OPCIONES}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

// El botón y la lista abierta comparten rótulo ("Estado"): el selector
// desambigua, igual que lo haría un consumidor.
const boton = () => screen.getByLabelText("Estado", { selector: "button" });

describe("MultiSelect", () => {
  it("cerrado por defecto: muestra 'Todos', aria-expanded=false y sin checkboxes en el DOM", () => {
    render(<Controlado />);

    expect(boton()).toHaveTextContent("Todos");
    expect(boton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    // El nombre accesible incluye el valor, no solo el rótulo.
    expect(boton()).toHaveAccessibleName("Estado Todos");
  });

  it("emptyLabel reemplaza a 'Todos'", () => {
    render(
      <MultiSelect
        label="Sucursal"
        options={[]}
        value={[]}
        onChange={vi.fn()}
        emptyLabel="Todas"
      />,
    );
    expect(screen.getByLabelText("Sucursal", { selector: "button" })).toHaveTextContent("Todas");
  });

  it("al abrir lista un checkbox por opción, reflejando la selección actual", async () => {
    const user = userEvent.setup();
    render(<Controlado initial={["RESERVED"]} />);

    await user.click(boton());

    expect(boton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Estado" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Disponible" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Reservado" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Vendido" })).not.toBeChecked();
  });

  it("tildar devuelve la selección en el orden de las opciones, no en el de los clicks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await user.click(boton());
    await user.click(screen.getByRole("checkbox", { name: "Vendido" }));
    await user.click(screen.getByRole("checkbox", { name: "Disponible" }));

    expect(onChange).toHaveBeenLastCalledWith(["AVAILABLE", "SOLD"]);
    // La lista sigue abierta después de tildar: se eligen varias sin reabrir.
    expect(boton()).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("checkbox", { name: "Vendido" }));
    expect(onChange).toHaveBeenLastCalledWith(["AVAILABLE"]);
  });

  it("el botón cerrado dice el nombre del único elegido, o cuántos hay", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.click(boton());
    await user.click(screen.getByRole("checkbox", { name: "Reservado" }));
    expect(boton()).toHaveTextContent("Reservado");
    expect(boton()).toHaveAccessibleName("Estado Reservado");

    await user.click(screen.getByRole("checkbox", { name: "Vendido" }));
    expect(boton()).toHaveTextContent("2 seleccionados");
  });

  it("Escape cierra, conserva la selección y devuelve el foco al botón", async () => {
    const user = userEvent.setup();
    render(<Controlado initial={["SOLD"]} />);

    await user.click(boton());
    await user.click(screen.getByRole("checkbox", { name: "Disponible" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(boton()).toHaveAttribute("aria-expanded", "false");
    expect(boton()).toHaveFocus();
    expect(boton()).toHaveTextContent("2 seleccionados");
  });

  it("un click afuera cierra; un click adentro (en una opción) no", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p>afuera</p>
        <Controlado />
      </div>,
    );

    await user.click(boton());
    await user.click(screen.getByRole("checkbox", { name: "Disponible" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    await user.click(screen.getByText("afuera"));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(boton()).toHaveTextContent("Disponible");
  });

  it("un segundo click en el botón cierra la lista", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.click(boton());
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    await user.click(boton());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
