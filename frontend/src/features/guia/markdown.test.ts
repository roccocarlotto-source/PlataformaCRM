import { describe, expect, it } from "vitest";
import { asignarAnclas, renderizarMarkdown, slugDe } from "./markdown";

describe("renderizarMarkdown", () => {
  it("un `## Título {#ancla}` genera un h2 con ese id y sin el sufijo en el texto", () => {
    const html = renderizarMarkdown("## Ficha de contacto {#ficha-de-contacto}\n\nTexto.");
    expect(html).toContain('<h2 id="ficha-de-contacto">Ficha de contacto</h2>');
    expect(html).not.toContain("{#");
  });

  it("sin sufijo, el id sale del texto del encabezado (sin acentos ni espacios)", () => {
    const html = renderizarMarkdown("### Qué tener en cuenta");
    expect(html).toContain('<h3 id="que-tener-en-cuenta">Qué tener en cuenta</h3>');
  });

  it("los links externos abren en otra pestaña y los internos quedan como están", () => {
    const html = renderizarMarkdown(
      "[Meta](https://business.facebook.com) y [Contactos](/contacts)",
    );
    expect(html).toContain(
      '<a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer">Meta</a>',
    );
    expect(html).toContain('<a href="/contacts">Contactos</a>');
  });

  it("sanitiza: un <script> o un onerror en el markdown no llegan al HTML", () => {
    const html = renderizarMarkdown(
      'Hola <script>alert(1)</script> <img src=x onerror="alert(1)"> [x](javascript:alert(1))',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("soporta tablas y citas (GFM)", () => {
    const html = renderizarMarkdown("| A | B |\n|---|---|\n| 1 | 2 |\n\n> Ojo.");
    expect(html).toContain("<table>");
    expect(html).toContain("<blockquote>");
  });
});

describe("slugDe", () => {
  it("minúsculas, sin acentos, guiones", () => {
    expect(slugDe("Configuración de la organización y sucursales")).toBe(
      "configuracion-de-la-organizacion-y-sucursales",
    );
  });
});

describe("asignarAnclas", () => {
  it("respeta las anclas explícitas, genera las que faltan y desempata las repetidas", () => {
    const md = "## A {#a}\n\n### Filtros\n\n## B {#b}\n\n### Filtros\n\n```\n### no\n```\n";
    expect(asignarAnclas(md)).toBe(
      "## A {#a}\n\n### Filtros {#filtros}\n\n## B {#b}\n\n### Filtros {#filtros-2}\n\n```\n### no\n```\n",
    );
  });
});
