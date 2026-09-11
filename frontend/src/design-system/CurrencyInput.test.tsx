import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CurrencyInput } from "./CurrencyInput";
import {
  countSignificantBefore,
  formatAmount,
  formatAmountWhileTyping,
  parseAmount,
  positionAfterSignificant,
} from "./currencyFormat";

// Ítem 18.A de docs/frontend-cambios-pendientes.md. Las funciones puras se
// prueban directo; el componente, con un padre controlado real para cubrir
// el contrato canónico (lo que sale por onChange nunca lleva formato) y la
// resincronización cuando el padre cambia el valor por su cuenta.

describe("currencyFormat", () => {
  it("parseAmount: texto tipeado o formateado → canónico con punto decimal y sin miles", () => {
    expect(parseAmount("")).toBe("");
    expect(parseAmount("20000")).toBe("20000");
    expect(parseAmount("20.000")).toBe("20000");
    expect(parseAmount("20.000,5")).toBe("20000.5");
    expect(parseAmount("20.000,50")).toBe("20000.50");
    expect(parseAmount("1.234.567,89")).toBe("1234567.89");
    // Un punto solo es de miles, nunca decimal: es lo que queda al borrar
    // los decimales de "20.000,50" con backspace.
    expect(parseAmount("20.000")).toBe("20000");
    expect(parseAmount("2.0000")).toBe("20000");
    // Separador colgado: es el entero. Ceros a la izquierda: se van. Coma
    // sola: cero. Más de 2 decimales: se truncan. Basura: se descarta.
    expect(parseAmount("20.000,")).toBe("20000");
    expect(parseAmount("007")).toBe("7");
    expect(parseAmount(",5")).toBe("0.5");
    expect(parseAmount("1,999")).toBe("1.99");
    expect(parseAmount("abc")).toBe("");
    expect(parseAmount("1a2b,3c")).toBe("12.3");
  });

  it("formatAmount: canónico → siempre con miles y 2 decimales", () => {
    expect(formatAmount("")).toBe("");
    expect(formatAmount("7")).toBe("7,00");
    expect(formatAmount("1234.5")).toBe("1.234,50");
    expect(formatAmount("20000.5")).toBe("20.000,50");
    expect(formatAmount("1234567.89")).toBe("1.234.567,89");
  });

  it("formatAmountWhileTyping: miles en vivo, decimales como se tipearon, coma colgada preservada", () => {
    expect(formatAmountWhileTyping("")).toBe("");
    expect(formatAmountWhileTyping("2")).toBe("2");
    expect(formatAmountWhileTyping("2000")).toBe("2.000");
    expect(formatAmountWhileTyping("20000,")).toBe("20.000,");
    expect(formatAmountWhileTyping("20000,5")).toBe("20.000,5");
    expect(formatAmountWhileTyping("20.000,5")).toBe("20.000,5");
    expect(formatAmountWhileTyping(",")).toBe("0,");
    expect(formatAmountWhileTyping("1,999")).toBe("1,99");
  });

  it("cursor: los puntos de miles no cuentan, la coma y los dígitos sí", () => {
    expect(countSignificantBefore("1.234,5", 0)).toBe(0);
    expect(countSignificantBefore("1.234,5", 2)).toBe(1);
    expect(countSignificantBefore("1.234,5", 5)).toBe(4);
    expect(countSignificantBefore("1.234,5", 7)).toBe(6);
    expect(positionAfterSignificant("1.234,5", 0)).toBe(0);
    expect(positionAfterSignificant("1.234,5", 1)).toBe(1);
    expect(positionAfterSignificant("1.234,5", 2)).toBe(3);
    expect(positionAfterSignificant("1.234,5", 6)).toBe(7);
    expect(positionAfterSignificant("1.234,5", 99)).toBe(7);
  });

  it("cursor: con un predicado propio (ítem 23, IntegerInput) la coma deja de contar", () => {
    const onlyDigits = (char: string) => /\d/.test(char);
    expect(countSignificantBefore("1,.500", 2, onlyDigits)).toBe(1);
    expect(positionAfterSignificant("1.500", 1, onlyDigits)).toBe(1);
    expect(positionAfterSignificant("1.500", 2, onlyDigits)).toBe(3);
  });
});

// Padre controlado mínimo: guarda el canónico y lo muestra aparte para poder
// afirmarlo sin espiar el estado interno del componente.
function Harness({ initial = "", onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [amount, setAmount] = useState(initial);
  return (
    <label>
      Monto
      <CurrencyInput
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

describe("CurrencyInput", () => {
  it("arranca con el valor cargado ya formateado, y es un input de texto con teclado decimal", () => {
    render(<Harness initial="1234.5" />);
    const input = screen.getByLabelText("Monto");
    expect(input).toHaveValue("1.234,50");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });

  it("formatea en vivo al tipear y entrega el canónico por onChange; al salir completa 2 decimales", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Monto");

    await user.type(input, "20000,5");
    expect(input).toHaveValue("20.000,5");
    expect(screen.getByTestId("canonical")).toHaveTextContent("20000.5");
    // Nunca sale con formato: ni puntos de miles ni coma.
    for (const [value] of onChange.mock.calls) {
      expect(value).toMatch(/^\d*(\.\d{0,2})?$/);
    }

    await user.tab();
    expect(input).toHaveValue("20.000,50");
    expect(screen.getByTestId("canonical")).toHaveTextContent("20000.5");
  });

  it("un punto tipeado se toma como coma decimal", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Monto");

    await user.type(input, "2500.75");
    expect(input).toHaveValue("2.500,75");
    expect(screen.getByTestId("canonical")).toHaveTextContent("2500.75");
  });

  it("tipear en el medio de un número ya formateado deja el cursor detrás del dígito tipeado", async () => {
    const user = userEvent.setup();
    render(<Harness initial="1234567" />);
    const input = screen.getByLabelText("Monto") as HTMLInputElement;
    expect(input).toHaveValue("1.234.567,00");

    // Insertar "9" justo después del "1" inicial: el formato agrega un punto
    // de miles nuevo delante y correría el cursor si no se compensara.
    await user.type(input, "9", { initialSelectionStart: 1, initialSelectionEnd: 1 });
    expect(input).toHaveValue("19.234.567,00");
    expect(input.selectionStart).toBe(2);
    expect(screen.getByTestId("canonical")).toHaveTextContent("19234567.00");
  });

  it("borrar hacia atrás no pelea con el relleno de decimales", async () => {
    const user = userEvent.setup();
    render(<Harness initial="20000.5" />);
    const input = screen.getByLabelText("Monto");
    expect(input).toHaveValue("20.000,50");

    await user.type(input, "{backspace}{backspace}{backspace}");
    expect(input).toHaveValue("20.000");
    expect(screen.getByTestId("canonical")).toHaveTextContent("20000");
  });

  it("si el padre cambia el valor por su cuenta, el texto se rehace desde ese valor", async () => {
    const user = userEvent.setup();
    render(<Harness initial="1234.5" />);
    const input = screen.getByLabelText("Monto");

    await user.click(screen.getByRole("button", { name: "vaciar" }));
    expect(input).toHaveValue("");

    await user.type(input, "42");
    expect(input).toHaveValue("42");
    expect(screen.getByTestId("canonical")).toHaveTextContent("42");
  });
});
