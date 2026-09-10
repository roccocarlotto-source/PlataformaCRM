import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toast, ToastProvider, TOAST_DURATION_MS } from "./Toast";
import { useToast } from "./useToast";

// Ítem 12 de docs/frontend-cambios-pendientes.md. Timers falsos para no
// esperar los 4 segundos reales; los clicks van con fireEvent (síncrono) y
// no con userEvent, que bajo timers falsos necesita su propio avance de
// tiempo y acá no aporta nada: los botones no tienen ninguna interacción más
// que el click.
describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("muestra el mensaje y el cierre explícito", () => {
    render(<Toast message="Guardado" onDismiss={vi.fn()} />);

    expect(screen.getByText("Guardado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar aviso" })).toBeInTheDocument();
  });

  it("pide desaparecer solo al vencerse la duración por defecto, no antes", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("respeta una duración propia", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" onDismiss={onDismiss} duration={500} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("la × pide desaparecer de inmediato", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("al desmontarse cancela el temporizador (no llama a onDismiss después)", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toast message="Guardado" onDismiss={onDismiss} />);

    unmount();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

function Trigger({ message }: { message: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show(message)}>
      Mostrar {message}
    </button>
  );
}

function show(message: string) {
  fireEvent.click(screen.getByRole("button", { name: `Mostrar ${message}` }));
}

describe("ToastProvider + useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("la región role=status existe siempre, vacía hasta que alguien llama a show()", () => {
    render(
      <ToastProvider>
        <Trigger message="Guardado" />
      </ToastProvider>,
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("show() muestra el toast dentro de la región y se va solo pasada la duración", () => {
    render(
      <ToastProvider>
        <Trigger message="Guardado" />
      </ToastProvider>,
    );

    show("Guardado");
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("la × del toast lo cierra antes de tiempo", () => {
    render(
      <ToastProvider>
        <Trigger message="Guardado" />
      </ToastProvider>,
    );

    show("Guardado");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("un show() nuevo reemplaza al toast visible y reinicia su tiempo (no se apilan)", () => {
    render(
      <ToastProvider>
        <Trigger message="Pipeline guardado" />
        <Trigger message="Etapa guardada" />
      </ToastProvider>,
    );

    show("Pipeline guardado");
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 100);
    });
    show("Etapa guardada");

    expect(screen.queryByText("Pipeline guardado")).not.toBeInTheDocument();
    expect(screen.getByText("Etapa guardada")).toBeInTheDocument();

    // El tiempo arrancó de nuevo con el segundo: 100ms después del primero
    // ya no alcanza para que se vaya.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText("Etapa guardada")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 100);
    });
    expect(screen.queryByText("Etapa guardada")).not.toBeInTheDocument();
  });

  it("el mismo mensaje dos veces seguidas también reinicia el tiempo", () => {
    render(
      <ToastProvider>
        <Trigger message="Etapa guardada" />
      </ToastProvider>,
    );

    show("Etapa guardada");
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 100);
    });
    show("Etapa guardada");
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText("Etapa guardada")).toBeInTheDocument();
  });

  it("useToast fuera del provider falla ruidosamente", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger message="x" />)).toThrow(
      "useToast debe usarse dentro de <ToastProvider>",
    );
    consoleError.mockRestore();
  });
});
