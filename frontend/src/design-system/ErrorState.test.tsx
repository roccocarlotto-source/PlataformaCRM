import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("sin onRetry es el <p role=alert> de siempre", () => {
    render(<ErrorState>No pudimos cargar.</ErrorState>);
    const alerta = screen.getByRole("alert");
    expect(alerta.tagName).toBe("P");
    expect(alerta).toHaveClass("ds-error");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("con onRetry el alert sigue siendo solo el mensaje, y el botón reintenta", async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry}>No pudimos cargar.</ErrorState>);
    expect(screen.getByRole("alert")).toHaveTextContent(/^No pudimos cargar\.$/);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("acepta otro rótulo y deshabilita el botón mientras reintenta", () => {
    render(
      <ErrorState onRetry={() => {}} retryLabel="Volver a probar" retrying>
        Falló.
      </ErrorState>,
    );
    expect(screen.getByRole("button", { name: "Volver a probar" })).toBeDisabled();
  });
});
