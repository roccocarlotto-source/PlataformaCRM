import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileInputButton } from "./FileInputButton";

// Ítem 61 de docs/frontend-cambios-pendientes.md. Lo que se prueba acá es el
// contrato del componente, no el diálogo del sistema operativo: que el input
// real sigue existiendo y nombrado aunque no se vea, que el ÚNICO camino al
// explorador es el botón, y que elegir el mismo archivo dos veces seguidas
// vuelve a avisar (el reset del value, que es lo que el input nativo no hace
// solo).

const ETIQUETA = "Archivo (.csv o .xlsx, hasta 10 MB)";

function archivo(nombre = "muestra.csv"): File {
  return new File(["Nombre,Mail\n"], nombre, { type: "text/csv" });
}

function inputOculto(): HTMLInputElement {
  return screen.getByLabelText(ETIQUETA) as HTMLInputElement;
}

describe("FileInputButton", () => {
  it("el input real está en el DOM, oculto con .ds-sr-only y con nombre accesible", () => {
    render(<FileInputButton label={ETIQUETA} onFileSelected={vi.fn()} />);

    const input = inputOculto();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveClass("ds-sr-only");
    // Fuera del Tab: un foco en algo invisible no se ve. El botón es el que
    // para el recorrido de teclado.
    expect(input).toHaveAttribute("tabIndex", "-1");
  });

  it("sin rótulo visible el input toma el texto del botón como nombre accesible", () => {
    render(<FileInputButton buttonLabel="Elegir foto" onFileSelected={vi.fn()} />);

    expect(screen.getByLabelText("Elegir foto")).toHaveAttribute("type", "file");
  });

  it("clickear el botón dispara el click del input real (y nada más lo hace)", async () => {
    const user = userEvent.setup();
    render(<FileInputButton label={ETIQUETA} onFileSelected={vi.fn()} />);

    const input = inputOculto();
    const abrirExplorador = vi.fn();
    input.addEventListener("click", abrirExplorador);

    // El rótulo es un <span>, no un <label htmlFor>: clickearlo no reenvía
    // nada al input. Es el bug que este ítem vino a arreglar, así que se
    // afirma explícitamente.
    await user.click(screen.getByText(ETIQUETA));
    expect(abrirExplorador).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Elegir archivo" }));
    expect(abrirExplorador).toHaveBeenCalledTimes(1);
  });

  it("elegir un archivo llama a onFileSelected con el File", async () => {
    const user = userEvent.setup();
    const onFileSelected = vi.fn();
    render(<FileInputButton label={ETIQUETA} onFileSelected={onFileSelected} />);

    await user.upload(inputOculto(), archivo("contactos.csv"));

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected.mock.calls[0][0]).toBeInstanceOf(File);
    expect((onFileSelected.mock.calls[0][0] as File).name).toBe("contactos.csv");
  });

  it("el mismo archivo dos veces seguidas vuelve a avisar: el value se resetea", async () => {
    const user = userEvent.setup();
    const onFileSelected = vi.fn();
    render(<FileInputButton label={ETIQUETA} onFileSelected={onFileSelected} />);

    await user.upload(inputOculto(), archivo("contactos.csv"));
    // Sin el reset, el navegador no dispara un segundo change porque el value
    // no cambió, y reintentar obligaría a elegir otro archivo en el medio.
    expect(inputOculto().value).toBe("");

    await user.upload(inputOculto(), archivo("contactos.csv"));
    expect(onFileSelected).toHaveBeenCalledTimes(2);
  });

  it("muestra el nombre que le pasa el padre, y el placeholder cuando no hay ninguno", () => {
    const { rerender } = render(<FileInputButton label={ETIQUETA} onFileSelected={vi.fn()} />);
    expect(screen.getByText("Ningún archivo elegido")).toBeInTheDocument();

    rerender(
      <FileInputButton
        label={ETIQUETA}
        selectedFileName="contactos.csv"
        onFileSelected={vi.fn()}
      />,
    );
    expect(screen.getByText("contactos.csv")).toBeInTheDocument();
    expect(screen.queryByText("Ningún archivo elegido")).not.toBeInTheDocument();
  });

  it("disabled deshabilita el botón Y el input, no uno solo", () => {
    render(<FileInputButton label={ETIQUETA} disabled onFileSelected={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeDisabled();
    expect(inputOculto()).toBeDisabled();
  });

  it("pasa el accept tal cual al input real", () => {
    render(<FileInputButton label={ETIQUETA} accept=".csv,.xlsx" onFileSelected={vi.fn()} />);

    expect(inputOculto()).toHaveAttribute("accept", ".csv,.xlsx");
  });
});
