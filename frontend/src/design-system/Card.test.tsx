import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("es una <section> con el aria-label del consumidor y un h2 con el heading", () => {
    render(
      <Card aria-label="Pipeline" heading="Pipeline">
        <p>contenido</p>
      </Card>,
    );
    const card = screen.getByLabelText("Pipeline");
    expect(card.tagName).toBe("SECTION");
    expect(card).toHaveClass("ds-card");
    expect(screen.getByRole("heading", { level: 2, name: "Pipeline" })).toBeInTheDocument();
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("sin heading no renderiza ningún h2", () => {
    render(
      <Card aria-label="x">
        <p>c</p>
      </Card>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it('as="div" cambia el elemento y conserva className extra', () => {
    render(
      <Card as="div" className="extra" data-testid="kpi">
        <p>c</p>
      </Card>,
    );
    const card = screen.getByTestId("kpi");
    expect(card.tagName).toBe("DIV");
    expect(card).toHaveClass("ds-card", "extra");
  });
});
