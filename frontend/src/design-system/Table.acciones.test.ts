import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// UX-11: toda tabla con una columna "Acciones" fija esa columna a la derecha
// (<Table accionesFijas>), así el "⋮" se ve aunque la tabla no entre en una
// laptop. Se busca en el código de las pantallas, como la suite "automotora
// sin cambios" de useModulo.test.tsx: una pantalla nueva que se olvida la
// prop rompe este test, no la vista de un cliente.
// ---------------------------------------------------------------------------

const FUENTES = import.meta.glob<string>(["../**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

interface ColumnaDeAcciones {
  archivo: string;
  linea: number;
  // La etiqueta <Table …> que envuelve a esa cabecera.
  tabla: string;
}

function columnasDeAcciones(): ColumnaDeAcciones[] {
  const columnas: ColumnaDeAcciones[] = [];
  for (const [archivo, fuente] of Object.entries(FUENTES)) {
    for (const match of fuente.matchAll(/<th[^>]*>\s*Acciones\s*<\/th>/g)) {
      const inicio = fuente.lastIndexOf("<Table", match.index);
      const tabla = inicio < 0 ? "" : fuente.slice(inicio, fuente.indexOf(">", inicio) + 1);
      columnas.push({
        archivo,
        linea: fuente.slice(0, match.index).split("\n").length,
        tabla,
      });
    }
  }
  return columnas;
}

describe("<Table accionesFijas> en toda columna de Acciones (UX-11)", () => {
  it("encuentra las columnas de Acciones de las pantallas (el test no corre en el vacío)", () => {
    expect(columnasDeAcciones().length).toBeGreaterThanOrEqual(30);
  });

  it("cada <th>Acciones</th> está dentro de un <Table accionesFijas>", () => {
    const sinFijar = columnasDeAcciones()
      .filter(({ tabla }) => !/^<Table\b[^>]*\baccionesFijas\b/.test(tabla))
      .map(({ archivo, linea, tabla }) => `${archivo}:${linea} (${tabla || "sin <Table>"})`);
    expect(sinFijar).toEqual([]);
  });
});
