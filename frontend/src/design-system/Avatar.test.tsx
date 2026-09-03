import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";
import { getInitials } from "./initials";

describe("getInitials", () => {
  it.each([
    ["Rocco Carlotto", "RC"],
    ["Valentina Rossi", "VR"],
    // minúsculas y espacios de más
    ["  maría   cabrera ", "MC"],
    // nombre compuesto: primera palabra + ÚLTIMA palabra
    ["Juan Pablo de la Cruz", "JC"],
    // un solo nombre → una sola letra
    ["Rocco", "R"],
    ["rocco", "R"],
    // inicial acentuada, sin partir el carácter
    ["Ángel Pérez", "ÁP"],
    // vacío / solo espacios
    ["", ""],
    ["   ", ""],
  ])("%j → %j", (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });
});

describe("Avatar", () => {
  it("muestra las iniciales y se anuncia con el nombre completo", () => {
    render(<Avatar name="Rocco Carlotto" />);
    const avatar = screen.getByRole("img", { name: "Rocco Carlotto" });
    expect(avatar).toHaveTextContent("RC");
    expect(avatar).toHaveClass("ds-avatar", "ds-avatar--md");
  });

  it("aplica la clase del tamaño pedido", () => {
    render(<Avatar name="Paula Nin" size="sm" />);
    expect(screen.getByRole("img", { name: "Paula Nin" })).toHaveClass("ds-avatar--sm");
  });

  it("decorative lo oculta al lector de pantalla", () => {
    render(<Avatar name="Rocco Carlotto" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    // Sigue en el DOM con las iniciales, solo que aria-hidden.
    const hidden = screen.getByText("RC");
    expect(hidden).toHaveAttribute("aria-hidden", "true");
    expect(hidden).not.toHaveAttribute("aria-label");
  });
});
