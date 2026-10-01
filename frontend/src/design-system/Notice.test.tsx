import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Notice } from "./Notice";

describe("Notice", () => {
  it("es info por defecto y no lleva rol: es contexto, no interrumpe", () => {
    const { container } = render(<Notice>Las filas se procesan en segundo plano.</Notice>);
    expect(container.firstChild).toHaveClass("ds-notice", "ds-notice--info");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["warning", "danger"] as const)("%s se anuncia con role=alert", (tone) => {
    render(<Notice tone={tone}>Esta fuente está pausada.</Notice>);
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveClass(`ds-notice--${tone}`);
    expect(aviso).toHaveTextContent("Esta fuente está pausada.");
  });

  it("alert={false} saca el rol aunque el tono sea warning", () => {
    render(
      <Notice tone="warning" alert={false}>
        Falta agregar un dominio.
      </Notice>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("muestra el título arriba del texto, y el ícono queda oculto al lector", () => {
    const { container } = render(
      <Notice tone="warning" title="Fuente pausada">
        Reactivala antes de subir un archivo.
      </Notice>,
    );
    expect(screen.getByText("Fuente pausada")).toHaveClass("ds-notice-title");
    expect(container.querySelector(".ds-notice-icon")).toHaveAttribute("aria-hidden", "true");
  });
});
