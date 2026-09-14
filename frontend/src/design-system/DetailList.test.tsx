import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";
import { DetailList } from "./DetailList";
import { formatDateTime, yesNo } from "./detailFormat";

describe("DetailList", () => {
  it("renderiza cada sección como una lista de definiciones con su título", () => {
    render(
      <DetailList
        sections={[
          { heading: "Identificación", items: [{ label: "Marca", value: "Toyota" }] },
          { heading: "Comercial", items: [{ label: "Estado", value: <Badge>Disponible</Badge> }] },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Identificación" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Comercial" })).toBeInTheDocument();
    // Rótulo en <dt> y valor en <dd>: la semántica de lista de definiciones
    // es parte del contrato, no solo el texto.
    expect(screen.getByText("Marca").tagName).toBe("DT");
    expect(screen.getByText("Toyota").tagName).toBe("DD");
    // Un ReactNode (Badge) se muestra tal cual, no convertido a texto.
    expect(screen.getByText("Disponible")).toHaveClass("ds-badge");
  });

  it("sin título no dibuja el h3; una sección alcanza para una entidad chica", () => {
    render(<DetailList sections={[{ items: [{ label: "Nombre", value: "Acme" }] }]} />);

    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("null, undefined y '' se muestran como '—'; 0 y false NO son vacío", () => {
    render(
      <DetailList
        sections={[
          {
            items: [
              { label: "Nulo", value: null },
              { label: "Indefinido", value: undefined },
              { label: "Vacío", value: "" },
              { label: "Cero", value: 0 },
            ],
          },
        ]}
      />,
    );

    const valores = screen.getAllByRole("definition").map((dd) => dd.textContent);
    expect(valores).toEqual(["—", "—", "—", "0"]);
  });
});

describe("detailFormat", () => {
  it("yesNo traduce el booleano a Sí/No", () => {
    expect(yesNo(true)).toBe("Sí");
    expect(yesNo(false)).toBe("No");
  });

  it("formatDateTime usa el formato local del navegador y deja null como vacío", () => {
    const iso = "2026-03-15T10:30:00.000Z";
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
    expect(formatDateTime(null)).toBe("");
  });
});
