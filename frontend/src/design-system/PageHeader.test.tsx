import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageHeader } from "./PageHeader";
import { OrganizacionDeLaPestana } from "./tituloDeLaPestana";

function renderHeader(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("PageHeader", () => {
  it("el título es el h1 de la página", () => {
    renderHeader(<PageHeader title="Contactos" />);
    expect(screen.getByRole("heading", { level: 1, name: "Contactos" })).toBeInTheDocument();
  });

  it("sin back ni actions no dibuja ni el link ni el contenedor de acciones", () => {
    const { container } = renderHeader(<PageHeader title="Nueva empresa" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector(".ds-page-header-actions")).toBeNull();
  });

  it("back es un link al destino, con el nombre del destino", () => {
    renderHeader(
      <PageHeader title="Etapas" back={{ to: "/pipelines", label: "Procesos de venta" }} />,
    );
    expect(screen.getByRole("link", { name: "Procesos de venta" })).toHaveAttribute(
      "href",
      "/pipelines",
    );
  });

  it("muestra subtítulo y acciones", () => {
    renderHeader(
      <PageHeader
        title="Mis tareas"
        subtitle="Actividades asignadas a vos."
        actions={<button>Nueva tarea</button>}
      />,
    );
    expect(screen.getByText("Actividades asignadas a vos.")).toHaveClass("ds-page-subtitle");
    expect(screen.getByRole("button", { name: "Nueva tarea" })).toBeInTheDocument();
  });
});

// UX-08: la pestaña dice qué pantalla es y de qué organización.
describe("PageHeader — título de la pestaña", () => {
  it("'<pantalla> · <organización>' dentro de AppLayout, y vuelve al genérico al salir", () => {
    const { unmount } = renderHeader(
      <OrganizacionDeLaPestana.Provider value="Automotora Centro">
        <PageHeader title="Contactos" />
      </OrganizacionDeLaPestana.Provider>,
    );
    expect(document.title).toBe("Contactos · Automotora Centro");
    unmount();
    expect(document.title).toBe("Plataforma CRM");
  });

  it("sin organización (fuera de AppLayout): '<pantalla> · Plataforma CRM'", () => {
    renderHeader(<PageHeader title="Ayuda" />);
    expect(document.title).toBe("Ayuda · Plataforma CRM");
  });

  it("con tituloDePestana, la pestaña no repite el encabezado (que puede llevar datos de alguien)", () => {
    renderHeader(
      <OrganizacionDeLaPestana.Provider value="Taller Ficticio">
        <PageHeader title="OS-0042 · Gol ABC 1234" tituloDePestana="Orden de servicio" />
      </OrganizacionDeLaPestana.Provider>,
    );
    expect(document.title).toBe("Orden de servicio · Taller Ficticio");
  });
});
