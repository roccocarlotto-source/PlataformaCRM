import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequiredFieldsHint } from "./RequiredFieldsHint";

describe("RequiredFieldsHint", () => {
  it("muestra la frase fija con el trato visual de texto auxiliar (.ds-hint)", () => {
    render(<RequiredFieldsHint />);
    expect(screen.getByText("Los campos con asterisco (*) son obligatorios.")).toHaveClass(
      "ds-hint",
    );
  });
});
