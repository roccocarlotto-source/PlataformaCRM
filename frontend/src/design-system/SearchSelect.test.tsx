import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchSelect, type SearchSelectProps } from "./SearchSelect";

interface Item {
  id: string;
  name: string;
}

function renderSelect(props: Partial<SearchSelectProps<Item>> = {}) {
  const onSelect = vi.fn();
  const onTermChange = vi.fn();
  render(
    <SearchSelect<Item>
      id="empresa"
      label="Empresa"
      placeholder="Buscar por nombre…"
      term=""
      onTermChange={onTermChange}
      open={false}
      selected={null}
      loading={false}
      error={null}
      results={undefined}
      getKey={(item) => item.id}
      renderItem={(item) => item.name}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect, onTermChange };
}

describe("SearchSelect", () => {
  it("asocia el rótulo al input y avisa cada tecla", async () => {
    const { onTermChange } = renderSelect();
    await userEvent.type(screen.getByLabelText("Empresa"), "a");
    expect(onTermChange).toHaveBeenCalledWith("a");
  });

  it("cerrado no muestra la lista", () => {
    renderSelect({ results: [{ id: "1", name: "Acme" }] });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("abierto lista los resultados como botones y elegir uno llama a onSelect", async () => {
    const acme = { id: "1", name: "Acme" };
    const { onSelect } = renderSelect({ open: true, results: [acme, { id: "2", name: "Beta" }] });
    await userEvent.click(screen.getByRole("button", { name: "Acme" }));
    expect(onSelect).toHaveBeenCalledWith(acme);
  });

  it("muestra cargando, error y vacío", () => {
    renderSelect({ open: true, loading: true, error: "No pudimos buscar empresas.", results: [] });
    expect(screen.getByText("Buscando…")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos buscar empresas.");
    expect(screen.getByText("Sin resultados.")).toBeInTheDocument();
  });

  it("muestra la selección con su prefijo y su acción", () => {
    renderSelect({
      selected: { prefix: "Seleccionada", content: "Acme", action: <button>Quitar</button> },
    });
    expect(screen.getByText(/Seleccionada:.*Acme/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar" })).toBeInTheDocument();
  });

  it("como filtro (onClear), muestra el valor en lugar del input y la ✕ lo quita", async () => {
    const onClear = vi.fn();
    renderSelect({
      selected: { prefix: "Seleccionada", content: "Acme" },
      onClear,
      clearLabel: "Quitar filtro de empresa",
    });
    const grupo = screen.getByRole("group", { name: "Empresa" });
    expect(grupo).toHaveTextContent("Seleccionada: Acme");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtro de empresa" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("al quitar con la ✕, el foco pasa al input que vuelve", async () => {
    function Filtro() {
      const [elegida, setElegida] = useState(true);
      return (
        <SearchSelect<Item>
          id="empresa"
          label="Empresa"
          placeholder="Buscar por nombre…"
          term=""
          onTermChange={() => {}}
          open={false}
          selected={elegida ? { prefix: "Seleccionada", content: "Acme" } : null}
          loading={false}
          error={null}
          results={undefined}
          getKey={(item) => item.id}
          renderItem={(item) => item.name}
          onSelect={() => {}}
          onClear={() => setElegida(false)}
          clearLabel="Quitar filtro de empresa"
        />
      );
    }
    render(<Filtro />);
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtro de empresa" }));
    expect(screen.getByLabelText("Empresa")).toHaveFocus();
  });

  it("como filtro sin valor elegido, es el input de siempre", () => {
    renderSelect({ onClear: vi.fn() });
    expect(screen.getByLabelText("Empresa")).toHaveAttribute("placeholder", "Buscar por nombre…");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
