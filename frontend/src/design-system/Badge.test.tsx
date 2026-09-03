import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("es neutral por defecto y muestra el texto", () => {
    render(<Badge>Lead</Badge>);
    const badge = screen.getByText("Lead");
    expect(badge).toHaveClass("ds-badge", "ds-badge--neutral");
  });

  it.each(["neutral", "info", "success", "danger"] as const)(
    "aplica la clase de la variante %s",
    (variant) => {
      render(<Badge variant={variant}>x</Badge>);
      expect(screen.getByText("x")).toHaveClass(`ds-badge--${variant}`);
    },
  );

  it("conserva className y otros atributos del consumidor", () => {
    render(
      <Badge className="extra" data-testid="b" title="Etapa">
        SQL
      </Badge>,
    );
    const badge = screen.getByTestId("b");
    expect(badge).toHaveClass("ds-badge", "extra");
    expect(badge).toHaveAttribute("title", "Etapa");
  });
});
