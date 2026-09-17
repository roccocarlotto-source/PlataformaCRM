import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, type SelectOption } from "./Select";

const PERSONAS: SelectOption<string>[] = [
  { value: "u1", label: "Ana Pérez", subtitle: "ana@example.com" },
  { value: "u2", label: "Beto Gómez", subtitle: "beto@acme.test" },
  { value: "u3", label: "Carla Díaz", subtitle: "carla@example.com" },
];

// Controlado, con un dueño del estado como lo tendría un formulario.
function Controlado({
  initial,
  onChange,
  options = PERSONAS,
  emptyOption,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  options?: SelectOption<string>[];
  emptyOption?: { label: string };
}) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <Select
      id="owner"
      label="Propietario"
      options={options}
      value={value}
      emptyOption={emptyOption}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const combobox = () => screen.getByRole("combobox", { name: "Propietario" });
const optionNames = () => screen.getAllByRole("option").map((option) => option.textContent);

describe("Select", () => {
  it("cerrado: muestra el rótulo de lo elegido, aria-expanded=false y sin panel en el DOM", () => {
    render(<Controlado initial="u2" />);

    expect(combobox()).toHaveValue("Beto Gómez");
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    expect(combobox()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Asociado por label[for]: lo que usan getByLabelText y la píldora.
    expect(screen.getByLabelText("Propietario")).toBe(combobox());
  });

  it("click abre el panel vacío para tipear, con todas las opciones y la elegida resaltada", async () => {
    const user = userEvent.setup();
    render(<Controlado initial="u2" />);

    await user.click(combobox());

    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox", { name: "Propietario" });
    expect(combobox()).toHaveAttribute("aria-controls", listbox.id);
    expect(combobox()).toHaveValue("");
    // El placeholder recuerda lo elegido mientras el input está vacío.
    expect(combobox()).toHaveAttribute("placeholder", "Beto Gómez");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    const beto = screen.getByRole("option", { name: "Beto Gómez" });
    expect(combobox()).toHaveAttribute("aria-activedescendant", beto.id);
  });

  it("el subtítulo es la descripción de la fila, no parte de su nombre", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.click(combobox());

    const ana = screen.getByRole("option", { name: "Ana Pérez" });
    expect(ana).toHaveAccessibleDescription("ana@example.com");
    expect(within(ana).getByText("ana@example.com")).toHaveClass("ds-select-option-subtitle");
  });

  it("sin subtítulo, la fila tiene una sola línea", async () => {
    const user = userEvent.setup();
    render(
      <Controlado
        options={[
          { value: "b1", label: "Casa Central" },
          { value: "b2", label: "Pocitos" },
        ]}
      />,
    );

    await user.click(combobox());

    const fila = screen.getByRole("option", { name: "Casa Central" });
    expect(fila.querySelector(".ds-select-option-subtitle")).toBeNull();
    expect(fila).not.toHaveAttribute("aria-describedby");
  });

  it("tipear filtra por rótulo sin distinguir mayúsculas ni acentos", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.click(combobox());
    await user.keyboard("PEREZ");

    expect(optionNames()).toEqual(["Ana Pérezana@example.com"]);
    // Tipear resalta la primera coincidencia.
    expect(combobox()).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Ana Pérez" }).id,
    );
  });

  it("tipear filtra también por subtítulo (buscar un usuario por su email)", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.click(combobox());
    await user.keyboard("acme");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Beto Gómez" })).toBeInTheDocument();
  });

  it("Enter elige la fila resaltada, cierra y deja el foco en el input con su rótulo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await user.click(combobox());
    await user.keyboard("carla{Enter}");

    expect(onChange).toHaveBeenCalledWith("u3");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    expect(combobox()).toHaveValue("Carla Díaz");
    expect(combobox()).toHaveFocus();
  });

  it("flechas mueven el resaltado y Enter elige esa fila", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado initial="u1" onChange={onChange} />);

    await user.click(combobox());
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");

    expect(onChange).toHaveBeenCalledWith("u2");
    expect(combobox()).toHaveValue("Beto Gómez");
  });

  it("click en una opción la elige y cierra", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await user.click(combobox());
    await user.click(screen.getByRole("option", { name: "Beto Gómez" }));

    expect(onChange).toHaveBeenCalledWith("u2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("Beto Gómez");
    expect(combobox()).toHaveFocus();
  });

  it("elegir la opción que ya estaba elegida no llama a onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado initial="u1" onChange={onChange} />);

    await user.click(combobox());
    await user.click(screen.getByRole("option", { name: "Ana Pérez" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape cierra sin cambiar el valor y restaura el rótulo mostrado", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado initial="u1" onChange={onChange} />);

    await user.click(combobox());
    await user.keyboard("bet{ArrowDown}{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("Ana Pérez");
    expect(combobox()).toHaveFocus();

    // Con el foco todavía en el input, un click lo vuelve a abrir.
    await user.click(combobox());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("click afuera cierra sin cambiar el valor y restaura el rótulo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <p>afuera</p>
        <Controlado initial="u1" onChange={onChange} />
      </div>,
    );

    await user.click(combobox());
    await user.keyboard("carl");
    await user.click(screen.getByText("afuera"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("Ana Pérez");
  });

  it("perder el foco con Tab cierra y no deja la búsqueda a medio escribir", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Controlado initial="u1" />
        <button type="button">siguiente</button>
      </div>,
    );

    await user.click(combobox());
    await user.keyboard("bet");
    await user.tab();

    expect(screen.getByRole("button", { name: "siguiente" })).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("Ana Pérez");
  });

  it("la fila elegida lleva el check y aria-selected; las demás no", async () => {
    const user = userEvent.setup();
    render(<Controlado initial="u2" />);

    await user.click(combobox());

    const beto = screen.getByRole("option", { name: "Beto Gómez" });
    expect(beto).toHaveAttribute("aria-selected", "true");
    expect(beto).toHaveClass("ds-select-option-selected");
    expect(beto.querySelector("svg.ds-select-check")).not.toBeNull();

    const ana = screen.getByRole("option", { name: "Ana Pérez" });
    expect(ana).toHaveAttribute("aria-selected", "false");
    expect(ana.querySelector("svg")).toBeNull();
  });

  it("sin coincidencias muestra 'Sin resultados.' fuera del listbox y Enter no elige nada", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await user.click(combobox());
    await user.keyboard("zzz");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    const vacio = screen.getByText("Sin resultados.");
    expect(within(screen.getByRole("listbox")).queryByText("Sin resultados.")).toBeNull();
    expect(vacio).toBeInTheDocument();
    expect(combobox()).not.toHaveAttribute("aria-activedescendant");

    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("emptyOption: fila primera, sin subtítulo, placeholder cerrado sin valor, y elegirla devuelve ''", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlado initial="u1" emptyOption={{ label: "Sin asignar" }} onChange={onChange} />);

    await user.click(combobox());
    const filas = screen.getAllByRole("option");
    expect(filas[0]).toHaveAccessibleName("Sin asignar");
    expect(filas[0]).not.toHaveAttribute("aria-describedby");
    expect(filas).toHaveLength(4);

    await user.click(screen.getByRole("option", { name: "Sin asignar" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(combobox()).toHaveValue("");
    expect(combobox()).toHaveAttribute("placeholder", "Sin asignar");

    // Sin valor, la fila vacía es la marcada.
    await user.click(combobox());
    expect(screen.getByRole("option", { name: "Sin asignar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("la fila vacía también se filtra", async () => {
    const user = userEvent.setup();
    render(<Controlado emptyOption={{ label: "Sin asignar" }} />);

    await user.click(combobox());
    await user.keyboard("ana");

    expect(screen.queryByRole("option", { name: "Sin asignar" })).not.toBeInTheDocument();
  });

  it("required: marca en el rótulo e input required; disabled no abre", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Select label="Sucursal" options={[]} value={undefined} onChange={vi.fn()} required />
        <Select label="Otra" options={PERSONAS} value="u1" onChange={vi.fn()} disabled />
      </>,
    );

    expect(screen.getByRole("combobox", { name: "Sucursal" })).toBeRequired();
    expect(screen.getByText("Sucursal")).toHaveClass("ds-required");

    await user.click(screen.getByRole("combobox", { name: "Otra" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Escape con el panel abierto no llega a un listener de document (un Modal descartable)", async () => {
    const user = userEvent.setup();
    const documentEscape = vi.fn();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") documentEscape();
    };
    document.addEventListener("keydown", listener);
    render(<Controlado />);

    await user.click(combobox());
    await user.keyboard("{Escape}");
    expect(documentEscape).not.toHaveBeenCalled();

    // Cerrado, Escape sigue su camino normal.
    await user.keyboard("{Escape}");
    expect(documentEscape).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", listener);
  });
});
