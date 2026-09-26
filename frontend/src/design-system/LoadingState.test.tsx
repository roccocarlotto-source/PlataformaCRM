import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingState, InlineLoading } from "./LoadingState";
import { Button } from "./Button";

// Lo que estos tests fijan es el contrato que hace que la animación sea
// segura de poner en las ~60 pantallas que ya usaban estos estados: el texto
// ("Cargando…" y compañía) sigue existiendo y en UN solo nodo —así
// getByText("Cargando…") sigue encontrando exactamente uno—, y el spinner y
// el esqueleto son decoración (aria-hidden), no parte del nombre accesible.
describe("LoadingState", () => {
  it("por defecto: spinner animado al lado del texto de siempre", () => {
    const { container } = render(<LoadingState />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(container.querySelectorAll(".ds-spinner")).toHaveLength(1);
    expect(container.querySelector(".ds-loading")).toHaveClass("ds-loading--spinner");
  });

  it("respeta el texto que le pasa la pantalla", () => {
    render(<LoadingState>Cargando etapas…</LoadingState>);
    expect(screen.getByText("Cargando etapas…")).toBeInTheDocument();
  });

  it("variante rows: esqueleto de filas y el texto oculto pero presente", () => {
    const { container } = render(<LoadingState variant="rows" count={4} />);
    expect(container.querySelectorAll(".ds-skeleton-row")).toHaveLength(4);
    expect(screen.getByText("Cargando…")).toHaveClass("ds-sr-only");
    expect(container.querySelector(".ds-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("variante lines: esqueleto de párrafo con el mismo trato del texto", () => {
    const { container } = render(<LoadingState variant="lines" count={2} />);
    expect(container.querySelectorAll(".ds-skeleton-lines .ds-skeleton")).toHaveLength(2);
    expect(screen.getByText("Cargando…")).toHaveClass("ds-sr-only");
  });

  // El rol status es de la región de avisos (Toast.tsx). Si LoadingState lo
  // reclamara, getByRole("status") pasaría a ser ambiguo en cada pantalla que
  // carga y avisa a la vez —que fue exactamente lo que rompió al agregarlo.
  it("no reclama role=status: se anuncia con aria-live", () => {
    render(<LoadingState />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Cargando…").parentElement).toHaveAttribute("aria-live", "polite");
  });
});

describe("InlineLoading", () => {
  it("es un span, para poder vivir dentro de una frase o un <li>", () => {
    const { container } = render(<InlineLoading>Buscando…</InlineLoading>);
    const raiz = container.querySelector(".ds-inline-loading");
    expect(raiz?.tagName).toBe("SPAN");
    expect(raiz?.querySelectorAll(".ds-spinner")).toHaveLength(1);
    expect(screen.getByText("Buscando…")).toBeInTheDocument();
  });
});

describe("Button loading", () => {
  it("muestra el spinner, queda deshabilitado y se marca aria-busy", () => {
    render(
      <Button variant="primary" loading>
        Guardando…
      </Button>,
    );
    const boton = screen.getByRole("button", { name: "Guardando…" });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("aria-busy", "true");
    expect(boton).toHaveClass("ds-button--loading");
    expect(boton.querySelectorAll(".ds-spinner")).toHaveLength(1);
  });

  it("sin loading no cambia en nada respecto de antes", () => {
    render(<Button variant="primary">Guardar</Button>);
    const boton = screen.getByRole("button", { name: "Guardar" });
    expect(boton).toBeEnabled();
    expect(boton).not.toHaveAttribute("aria-busy");
    expect(boton.querySelector(".ds-spinner")).toBeNull();
  });

  // El spinner es decoración: si entrara en el nombre accesible, cada botón
  // cambiaría de nombre al empezar a cargar.
  it("el spinner no entra en el nombre accesible", () => {
    render(<Button loading>Revocar</Button>);
    expect(screen.getByRole("button", { name: "Revocar" })).toBeInTheDocument();
  });
});
