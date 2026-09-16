import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PERIODS, periodOption } from "./period";
import { PeriodToggle } from "./PeriodToggle";

// El selector de período, extraído de RevenueByMonthChart en el §35. Los
// tests que había sobre él vivían en el archivo del gráfico y probaban de
// paso el estado interno de aquel componente; acá se prueba el control solo, y
// el wiring con el estado de la página queda en DashboardPage.test.tsx.

describe("PeriodToggle", () => {
  it("un botón por período, con el activo marcado con aria-pressed", () => {
    render(<PeriodToggle value="week" onChange={vi.fn()} />);

    const grupo = screen.getByRole("group", { name: "Período" });
    expect(
      within(grupo)
        .getAllByRole("button")
        .map((boton) => boton.textContent),
    ).toEqual(["Mensual", "Semanal", "Diario"]);
    expect(within(grupo).getByRole("button", { name: "Semanal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(grupo).getByRole("button", { name: "Mensual" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(grupo).getByRole("button", { name: "Semanal" })).toHaveClass("is-active");
  });

  it("avisa el valor elegido, incluso si es el que ya estaba activo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PeriodToggle value="month" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Diario" }));
    expect(onChange).toHaveBeenCalledWith("day");

    await user.click(screen.getByRole("button", { name: "Mensual" }));
    expect(onChange).toHaveBeenLastCalledWith("month");
  });

  it("los tres botones son type=button: el toggle puede vivir dentro de un <form> sin enviarlo", () => {
    render(<PeriodToggle value="month" onChange={vi.fn()} />);
    for (const boton of screen.getAllByRole("button")) {
      expect(boton).toHaveAttribute("type", "button");
    }
  });
});

describe("periodOption", () => {
  it("devuelve los textos de la granularidad pedida", () => {
    expect(periodOption("week")).toEqual(PERIODS[1]);
    expect(periodOption("day").noun).toBe("día");
    expect(periodOption("month").window).toBe("los últimos 6 meses");
  });
});
