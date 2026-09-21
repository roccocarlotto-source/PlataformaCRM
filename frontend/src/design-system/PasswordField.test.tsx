import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordField } from "./PasswordField";

// Ítem 82 de docs/frontend-cambios-pendientes.md. El contrato: arranca oculto,
// el botón alterna el type y su propio nombre, no dispara el submit del form
// que lo contiene, y el input sigue siendo un input controlado nombrado por el
// rótulo (que es como lo buscan los tests de las pantallas de auth).

function Controlado({ onSubmit = vi.fn() }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <PasswordField
        label="Contraseña"
        value={value}
        onChange={setValue}
        autoComplete="new-password"
        required
        minLength={8}
      />
      <output>{value}</output>
    </form>
  );
}

describe("PasswordField", () => {
  it("arranca oculto: type password y botón 'Mostrar contraseña'", () => {
    render(<Controlado />);

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeInTheDocument();
  });

  it("el botón pasa a texto plano y cambia su aria-label; un segundo click vuelve a ocultar", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeInTheDocument();
  });

  it("es un input controlado: lo tipeado llega por onChange y se conserva al alternar", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.type(screen.getByLabelText("Contraseña"), "secreto123");
    expect(screen.getByRole("status")).toHaveTextContent("secreto123");

    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveValue("secreto123");
  });

  it("conserva los atributos que le pasa cada pantalla", () => {
    render(<Controlado />);

    const input = screen.getByLabelText("Contraseña");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("minlength", "8");
  });

  it("el botón es type=button: alternar no envía el formulario", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Controlado onSubmit={onSubmit} />);

    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(toggle).toHaveAttribute("type", "button");
    await user.click(toggle);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("el botón está en el recorrido de Tab, justo después del input", async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.tab();
    expect(screen.getByLabelText("Contraseña")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toHaveFocus();
  });

  it("dos campos en la misma pantalla alternan cada uno por su cuenta", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PasswordField label="Contraseña" value="" onChange={vi.fn()} />
        <PasswordField label="Confirmar contraseña" value="" onChange={vi.fn()} />
      </>,
    );

    const [primero] = screen.getAllByRole("button", { name: "Mostrar contraseña" });
    await user.click(primero);

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirmar contraseña")).toHaveAttribute("type", "password");
  });
});
