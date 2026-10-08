import { describe, expect, it } from "vitest";
import { AYUDA } from "./anclas";
import {
  buscarEnTitulos,
  parsearSeccion,
  SECCIONES,
  seccionPorSlug,
  seccionesVisibles,
} from "./secciones";

describe("parsearSeccion", () => {
  it("saca slug y orden del nombre de archivo, el título del # y los encabezados con su ancla", () => {
    const seccion = parsearSeccion(
      "../../../../docs/guia-de-uso/03-conversaciones.md",
      "# Conversaciones\n\nIntro.\n\n## La bandeja {#bandeja}\n\n### Filtros\n\n```\n## no es un encabezado\n```\n",
    );
    expect(seccion.slug).toBe("conversaciones");
    expect(seccion.orden).toBe(3);
    expect(seccion.titulo).toBe("Conversaciones");
    expect(seccion.encabezados).toEqual([
      { nivel: 2, titulo: "La bandeja", ancla: "bandeja" },
      { nivel: 3, titulo: "Filtros", ancla: "filtros" },
    ]);
    expect(seccion.soloPlataforma).toBe(false);
  });
});

describe("docs/guia-de-uso/ (los archivos reales, incluidos en el build)", () => {
  it("hay secciones, ordenadas por el prefijo numérico, y una sola 'plataforma'", () => {
    expect(SECCIONES.length).toBeGreaterThan(0);
    const ordenes = SECCIONES.map((s) => s.orden);
    expect(ordenes).toEqual([...ordenes].sort((a, b) => a - b));
    expect(SECCIONES.filter((s) => s.soloPlataforma).map((s) => s.slug)).toEqual(["plataforma"]);
  });

  it("cada archivo tiene un # título y todos sus ## llevan {#ancla} explícita (README de la guía)", () => {
    for (const seccion of SECCIONES) {
      expect(seccion.markdown, seccion.slug).toMatch(/^# .+/m);
      for (const linea of seccion.markdown.split("\n")) {
        if (/^## /.test(linea)) {
          expect(linea, `${seccion.slug}: "${linea}"`).toMatch(/\{#[a-z0-9-]+\}\s*$/);
        }
      }
    }
  });

  it("las anclas no se repiten dentro de una sección", () => {
    for (const seccion of SECCIONES) {
      const anclas = seccion.encabezados.map((e) => e.ancla);
      expect(new Set(anclas).size, seccion.slug).toBe(anclas.length);
    }
  });

  it("no hay HTML crudo ni jerga de código en la guía", () => {
    for (const seccion of SECCIONES) {
      expect(seccion.markdown, seccion.slug).not.toMatch(/<[a-z]+[^>]*>/i);
      expect(seccion.markdown, seccion.slug).not.toMatch(/\b(backend|endpoint|frontend|API)\b/);
    }
  });

  it("cada destino de AYUDA (el '?' de una pantalla) apunta a una sección y un ancla que existen", () => {
    for (const [clave, destino] of Object.entries(AYUDA)) {
      const [slug, ancla] = destino.split("#");
      const seccion = seccionPorSlug(slug);
      expect(seccion, `${clave}: no existe la sección "${slug}"`).toBeDefined();
      expect(
        seccion?.encabezados.some((e) => e.ancla === ancla),
        `${clave}: no existe el ancla "${ancla}" en ${slug}`,
      ).toBe(true);
    }
  });

  it("los links internos a /ayuda/... dentro de la guía apuntan a secciones y anclas existentes", () => {
    const re = /\]\(\/ayuda\/([a-z0-9-]+)(?:#([a-z0-9-]+))?\)/g;
    for (const seccion of SECCIONES) {
      for (const match of seccion.markdown.matchAll(re)) {
        const destino = seccionPorSlug(match[1]);
        expect(destino, `${seccion.slug}: link a /ayuda/${match[1]}`).toBeDefined();
        if (match[2]) {
          expect(
            destino?.encabezados.some((e) => e.ancla === match[2]),
            `${seccion.slug}: link a /ayuda/${match[1]}#${match[2]}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("seccionesVisibles y buscarEnTitulos", () => {
  it("la sección Plataforma solo la ve el platform admin", () => {
    expect(seccionesVisibles(false).some((s) => s.soloPlataforma)).toBe(false);
    expect(seccionesVisibles(true).some((s) => s.soloPlataforma)).toBe(true);
  });

  it("busca sobre títulos sin acentos ni mayúsculas, y sin consulta devuelve todo", () => {
    const secciones = [
      parsearSeccion("01-a.md", "# Primeros pasos\n\n## Ingresar {#ingresar}\n"),
      parsearSeccion(
        "02-b.md",
        "# Contactos\n\n## Unir contactos {#unir}\n\n### Qué se conserva\n",
      ),
    ];
    expect(buscarEnTitulos(secciones, "").map((r) => r.seccion.slug)).toEqual(["a", "b"]);
    const r = buscarEnTitulos(secciones, "CONSERVA");
    expect(r).toHaveLength(1);
    expect(r[0].seccion.slug).toBe("b");
    expect(r[0].encabezados.map((e) => e.titulo)).toEqual(["Qué se conserva"]);
    expect(buscarEnTitulos(secciones, "primeros")[0].encabezados).toEqual([]);
    expect(buscarEnTitulos(secciones, "zzz")).toEqual([]);
  });
});
