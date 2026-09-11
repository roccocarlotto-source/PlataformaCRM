import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { IntegerInput } from "./IntegerInput";
import { formatInteger, isDigit, parseInteger } from "./integerFormat";

// Ítem 23 de docs/frontend-cambios-pendientes.md. Mismo esquema que
// CurrencyInput.test.tsx: funciones puras directo, y el componente con un
// padre controlado real para cubrir el contrato canónico (lo que sale por
// onChange nunca lleva puntos) y la resincronización con el padre.

describe("integerFormat", () => {
  it("parseInteger: texto tipeado o formateado → canónico solo con dígitos", () => {
    expect(parseInteger("")).toBe("");
    expect(parseInteger("150000")).toBe("150000");
    expect(parseInteger("150.000")).toBe("150000");
    expect(parseInteger("1.234.567")).toBe("1234567");
    // Coma o punto tipeados por costumbre: no son decimales, se descartan.
    expect(parseInteger("150,5")).toBe("1505");
    expect(parseInteger("150.5")).toBe("1505");
    // Ceros a la izquierda: se van. Basura: se descarta.
    expect(parseInteger("007")).toBe("7");
    expect(parseInteger("abc")).toBe("");
    expect(parseInteger("1a2b3c")).toBe("123");
  });

  it("formatInteger: puntos de miles, sin coma ni decimales nunca", () => {
    expect(formatInteger("")).toBe("");
    expect(formatInteger("7")).toBe("7");
    expect(formatInteger("1500")).toBe("1.500");
    expect(formatInteger("150000")).toBe("150.000");
    expect(formatInteger("1234567")).toBe("1.234.567");
    // Acepta texto ya formateado o con basura: parsea primero.
    expect(formatInteger("150.000")).toBe("150.000");
    expect(formatInteger("150,")).toBe("150");
  });

  it("isDigit: solo los dígitos son significativos para el cursor", () => {
    expect(isDigit("5")).toBe(true);
    expect(isDigit(".")).toBe(false);
    expect(isDigit(",")).toBe(false);
  });
});

function Harness({ initial = "", onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [amount, setAmount] = useState(initial);
  return (
    <label>
      Kilometraje
      <IntegerInput
        value={amount}
        onChange={(next) => {
          setAmount(next);
          onChange?.(next);
        }}
      />
      <output data-testid="canonical">{amount}</output>
      <button type="button" onClick={() => setAmount("")}>
        vaciar
      </button>
    </label>
  );
}

describe("IntegerInput", () => {
  it("arranca con el valor cargado ya formateado, y es un input de texto con teclado numérico", () => {
    render(<Harness initial="150000" />);
    const input = screen.getByLabelText("Kilometraje");
    expect(input).toHaveValue("150.000");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("formatea en vivo al tipear y entrega el canónico por onChange; al salir queda igual", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Kilometraje");

    await user.type(input, "150000");
    expect(input).toHaveValue("150.000");
    expect(screen.getByTestId("canonical")).toHaveTextContent("150000");
    // Nunca sale con formato: ni puntos de miles ni nada que no sea dígito.
    for (const [value] of onChange.mock.calls) {
      expect(value).toMatch(/^\d*$/);
    }

    await user.tab();
    expect(input).toHaveValue("150.000");
  });

  it("una coma o un punto tipeados se descartan: nunca hay decimales", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Kilometraje");

    await user.type(input, "150,5");
    expect(input).toHaveValue("1.505");
    expect(screen.getByTestId("canonical")).toHaveTextContent("1505");

    await user.type(input, ".");
    expect(input).toHaveValue("1.505");
    expect(screen.getByTestId("canonical")).toHaveTextContent("1505");
  });

  it("tipear en el medio de un número ya formateado deja el cursor detrás del dígito tipeado", async () => {
    const user = userEvent.setup();
    render(<Harness initial="1234567" />);
    const input = screen.getByLabelText("Kilometraje") as HTMLInputElement;
    expect(input).toHaveValue("1.234.567");

    // Insertar "9" justo después del "1" inicial: el formato agrega un punto
    // de miles nuevo delante y correría el cursor si no se compensara.
    await user.type(input, "9", { initialSelectionStart: 1, initialSelectionEnd: 1 });
    expect(input).toHaveValue("19.234.567");
    expect(input.selectionStart).toBe(2);
    expect(screen.getByTestId("canonical")).toHaveTextContent("19234567");
  });

  it("una coma tipeada en el medio se descarta sin correr el cursor", async () => {
    const user = userEvent.setup();
    render(<Harness initial="1500" />);
    const input = screen.getByLabelText("Kilometraje") as HTMLInputElement;
    expect(input).toHaveValue("1.500");

    await user.type(input, ",", { initialSelectionStart: 1, initialSelectionEnd: 1 });
    expect(input).toHaveValue("1.500");
    expect(input.selectionStart).toBe(1);
  });

  it("si el padre cambia el valor por su cuenta, el texto se rehace desde ese valor", async () => {
    const user = userEvent.setup();
    render(<Harness initial="150000" />);
    const input = screen.getByLabelText("Kilometraje");

    await user.click(screen.getByRole("button", { name: "vaciar" }));
    expect(input).toHaveValue("");

    await user.type(input, "42");
    expect(input).toHaveValue("42");
    expect(screen.getByTestId("canonical")).toHaveTextContent("42");
  });
});
