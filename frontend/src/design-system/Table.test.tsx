import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Table } from "./Table";

// jsdom no calcula layout: scrollWidth/clientWidth/scrollLeft dan 0. Se fijan
// a mano para simular una tabla de 1600 px dentro de un wrapper de 1000 px.
const medidas = { scrollWidth: 1600, clientWidth: 1000, scrollLeft: 0 };

function simularDesborde() {
  for (const prop of ["scrollWidth", "clientWidth", "scrollLeft"] as const) {
    vi.spyOn(HTMLElement.prototype, prop, "get").mockImplementation(() => medidas[prop]);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  medidas.scrollLeft = 0;
});

function renderTabla(accionesFijas?: boolean) {
  const { container } = render(
    <Table accionesFijas={accionesFijas}>
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Acme</td>
          <td>⋮</td>
        </tr>
      </tbody>
    </Table>,
  );
  return container.querySelector(".ds-table-wrap") as HTMLElement;
}

describe("Table", () => {
  it("sin accionesFijas: solo el wrapper de siempre, sin marca de desborde", () => {
    simularDesborde();
    const wrap = renderTabla();
    expect(wrap.className).toBe("ds-table-wrap");
    expect(wrap).not.toHaveAttribute("data-tapa-columnas");
  });

  it("con accionesFijas: clase de columna fija y marca mientras hay columnas tapadas", () => {
    simularDesborde();
    const wrap = renderTabla(true);
    expect(wrap).toHaveClass("ds-table-wrap--acciones-fijas");
    expect(wrap).toHaveAttribute("data-tapa-columnas");
  });

  it("al scrollear hasta el final la marca se va, y vuelve al scrollear para atrás", () => {
    simularDesborde();
    const wrap = renderTabla(true);

    medidas.scrollLeft = 600;
    fireEvent.scroll(wrap);
    expect(wrap).not.toHaveAttribute("data-tapa-columnas");

    medidas.scrollLeft = 200;
    fireEvent.scroll(wrap);
    expect(wrap).toHaveAttribute("data-tapa-columnas");
  });

  it("una tabla que entra entera no lleva la marca", () => {
    const wrap = renderTabla(true);
    expect(wrap).toHaveClass("ds-table-wrap--acciones-fijas");
    expect(wrap).not.toHaveAttribute("data-tapa-columnas");
  });
});
