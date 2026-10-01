import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("sin title es la forma compacta de siempre: un <p> con el texto", () => {
    render(<EmptyState>No hay empresas para mostrar.</EmptyState>);
    const vacio = screen.getByText("No hay empresas para mostrar.");
    expect(vacio.tagName).toBe("P");
    expect(vacio).toHaveClass("ds-empty");
  });

  it("con title muestra el título y la descripción en la forma completa", () => {
    const { container } = render(
      <EmptyState title="Todavía no hay empresas">Cargá la primera.</EmptyState>,
    );
    expect(container.firstChild).toHaveClass("ds-empty-state");
    expect(screen.getByText("Todavía no hay empresas")).toHaveClass("ds-empty-state-title");
    expect(screen.getByText("Cargá la primera.")).toHaveClass("ds-empty-state-text");
  });

  it("con title y sin children no dibuja el párrafo de descripción", () => {
    const { container } = render(<EmptyState title="Sin resultados" />);
    expect(container.querySelector(".ds-empty-state-text")).toBeNull();
  });

  it("dibuja la acción y el ícono, este último oculto al lector de pantalla", () => {
    const { container } = render(
      <EmptyState title="Sin agentes" icon={Inbox} action={<button>Nuevo agente</button>} />,
    );
    expect(screen.getByRole("button", { name: "Nuevo agente" })).toBeInTheDocument();
    expect(container.querySelector(".ds-empty-state-icon")).toHaveAttribute("aria-hidden", "true");
  });

  it("en la forma compacta ignora la acción", () => {
    render(<EmptyState action={<button>Nuevo</button>}>Vacío.</EmptyState>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
