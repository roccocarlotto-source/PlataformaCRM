import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhoneNumber } from "./PhoneNumber";

describe("PhoneNumber", () => {
  it("renderiza un span por grupo dentro de .ds-phone cuando el valor es uruguayo sin espacios", () => {
    const { container } = render(<PhoneNumber value="+59899000004" />);
    const wrapper = container.querySelector(".ds-phone");
    expect(wrapper).not.toBeNull();
    const groups = Array.from(wrapper!.children).map((child) => child.textContent);
    expect(groups).toEqual(["+598", "990", "000", "04"]);
    expect(wrapper!.textContent).toBe("+59899000004");
  });

  it("muestra el texto crudo sin envolver cuando el formato no aplica", () => {
    const { container } = render(<PhoneNumber value="+54 9 11 1234-5678" />);
    expect(container.querySelector(".ds-phone")).toBeNull();
    expect(screen.getByText("+54 9 11 1234-5678")).toBe(container);
  });

  it("no renderiza nada con null ni undefined", () => {
    const { container } = render(<PhoneNumber value={null} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector(".ds-phone")).toBeNull();
    const { container: undefinedContainer } = render(<PhoneNumber />);
    expect(undefinedContainer.textContent).toBe("");
  });
});
