import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeySecretDialog } from "./ApiKeySecretDialog";

const CLAVE = "crm_secreto_de_prueba";

// EL ORDEN IMPORTA: userEvent.setup() instala su propio stub de
// navigator.clipboard, así que el mock tiene que ponerse DESPUÉS de setup() o
// lo pisa. Con el orden invertido los tests pasan por la razón equivocada —
// copiando de verdad con el stub de user-event en vez de con nuestro doble.
function mockClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  // El objeto se redefine por test; se saca para no filtrar el mock al siguiente.
  Reflect.deleteProperty(navigator, "clipboard");
  vi.useRealTimers();
});

describe("ApiKeySecretDialog", () => {
  it("muestra la clave, la fuente y la advertencia de una sola vez", () => {
    render(<ApiKeySecretDialog apiKey={CLAVE} sourceName="Landing" onClose={vi.fn()} />);

    expect(screen.getByLabelText("Clave")).toHaveValue(CLAVE);
    expect(screen.getByText("Landing")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/única vez/);
  });

  it("el campo de la clave es readOnly pero NO disabled — seleccionarlo es el respaldo", () => {
    render(<ApiKeySecretDialog apiKey={CLAVE} sourceName="Landing" onClose={vi.fn()} />);

    const campo = screen.getByLabelText("Clave");
    expect(campo).toHaveAttribute("readonly");
    expect(campo).not.toBeDisabled();
  });

  it("Copiar manda la clave al portapapeles y confirma con un cambio de texto", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    mockClipboard(writeText);
    render(<ApiKeySecretDialog apiKey={CLAVE} sourceName="Landing" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(writeText).toHaveBeenCalledWith(CLAVE);
    expect(await screen.findByRole("button", { name: "¡Copiada!" })).toBeInTheDocument();
  });

  it("si el portapapeles falla no se muestra ningún error: el campo seleccionable alcanza", async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn(async () => Promise.reject(new Error("denied"))));
    render(<ApiKeySecretDialog apiKey={CLAVE} sourceName="Landing" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copiar" }));

    // El botón no confirma…
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    });
    // …y el único alert sigue siendo la advertencia, no un error nuevo.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/única vez/);
    // Y la clave sigue ahí para copiarla a mano.
    expect(screen.getByLabelText("Clave")).toHaveValue(CLAVE);
  });

  it("el botón de cierre dice que la acción es una confirmación, no un descarte", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ApiKeySecretDialog apiKey={CLAVE} sourceName="Landing" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Listo, ya la guardé" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
