import { describe, expect, it } from "vitest";
import { AYUDA } from "./anclas";
import type { ClaveDeAyuda } from "./anclas";
import type { MeResponse } from "../../auth/AuthContext";
import { tieneModulo } from "../../auth/useModulo";
import { edicionDeMe, MODULOS_COMPLETA } from "../../test/edicionFixtures";

const ME_BASE: MeResponse = {
  id: "u1",
  email: "a@example.com",
  fullName: "Ana",
  organizationId: "org-1",
  role: "ADMIN",
  isPlatformAdmin: true,
  canUseInternalAgent: false,
};
import {
  buscarEnTitulos,
  filtrarPorModulos,
  MODULO_DE_ANCLA,
  parsearSeccion,
  type Seccion,
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

// ---------------------------------------------------------------------------
// Ediciones (docs/ediciones.md §9): la guía sin los ## de módulos que la
// organización no tiene. Se prueba con la regla real (tieneModulo) y los
// módulos de cada edición.
// ---------------------------------------------------------------------------

const ESENCIAL = (modulo: string) =>
  tieneModulo({ ...ME_BASE, ...edicionDeMe("ESENCIAL") }, modulo);
const COMPLETA = (modulo: string) =>
  tieneModulo({ ...ME_BASE, ...edicionDeMe("COMPLETA") }, modulo);
const CLINICA_COMPLETA = (modulo: string) =>
  tieneModulo(
    {
      ...ME_BASE,
      edition: "COMPLETA",
      industry: "CLINICA",
      modulos: MODULOS_COMPLETA.filter((m) => m !== "empresas" && m !== "procesos_de_venta"),
    },
    modulo,
  );

// Las pantallas que ESENCIAL no tiene (su ruta vuelve al inicio, ModuloRoute):
// su "?" no se ve nunca en esa edición. Toda otra clave de AYUDA es de una
// pantalla visible en ESENCIAL y tiene que apuntar a un ancla visible.
const PANTALLAS_FUERA_DE_ESENCIAL: ReadonlySet<ClaveDeAyuda> = new Set<ClaveDeAyuda>([
  "empresas",
  "empresaForm",
  "procesosDeVenta",
  "procesoForm",
  "etapas",
  "etapaForm",
]);

function anclaVisible(secciones: Seccion[], destino: string): boolean {
  const [slug, ancla] = destino.split("#");
  const seccion = secciones.find((s) => s.slug === slug);
  return seccion?.encabezados.some((e) => e.ancla === ancla) === true;
}

describe("filtrarPorModulos", () => {
  const seccion = parsearSeccion(
    "04-oportunidades-y-procesos-de-venta.md",
    [
      "# Oportunidades",
      "",
      "## Oportunidades {#oportunidades}",
      "Texto.",
      "",
      "## Cotizaciones {#cotizaciones}",
      "Se cotiza así.",
      "",
      "### Crear una cotización",
      "Paso a paso.",
      "",
      "## Cerrar {#cerrar}",
      "Se cierra así.",
    ].join("\n"),
  );

  it("sin el módulo, saca el ## con su texto y sus ###; lo demás queda", () => {
    const filtrada = filtrarPorModulos(seccion, (m) => m !== "cotizaciones");
    expect(filtrada.encabezados.map((e) => e.ancla)).toEqual(["oportunidades", "cerrar"]);
    expect(filtrada.markdown).not.toMatch(/cotiza/i);
    expect(filtrada.markdown).toMatch(/Se cierra así\./);
  });

  it("con todos los módulos devuelve la misma sección, sin copiarla", () => {
    expect(filtrarPorModulos(seccion, () => true)).toBe(seccion);
  });
});

describe("la guía real por edición", () => {
  it("cada ## de MODULO_DE_ANCLA existe en la guía (un rename lo rompe acá)", () => {
    for (const destino of Object.keys(MODULO_DE_ANCLA)) {
      expect(anclaVisible(SECCIONES, destino), destino).toBe(true);
    }
  });

  it("ESENCIAL no ve los ## de empresas, embudo, cotizaciones, pagos, permuta, entrega, procesos de venta y etapas", () => {
    const visibles = seccionesVisibles(true, ESENCIAL);
    for (const destino of Object.keys(MODULO_DE_ANCLA)) {
      expect(anclaVisible(visibles, destino), destino).toBe(false);
    }
    const oportunidades = visibles.find((s) => s.slug === "oportunidades-y-procesos-de-venta");
    expect(oportunidades?.markdown).not.toMatch(/^## Cotizaciones/m);
    expect(oportunidades?.markdown).toMatch(/^## Cerrar una oportunidad/m);
  });

  it("COMPLETA (también una clínica COMPLETA) ve exactamente la guía de siempre", () => {
    for (const regla of [COMPLETA, CLINICA_COMPLETA]) {
      const visibles = seccionesVisibles(true, regla);
      expect(visibles).toEqual(seccionesVisibles(true));
      visibles.forEach((seccion, i) => expect(seccion).toBe(seccionesVisibles(true)[i]));
    }
  });

  it("cada '?' de una pantalla que ESENCIAL tiene apunta a un ancla visible en ESENCIAL", () => {
    const visibles = seccionesVisibles(true, ESENCIAL);
    for (const [clave, destino] of Object.entries(AYUDA) as [ClaveDeAyuda, string][]) {
      if (PANTALLAS_FUERA_DE_ESENCIAL.has(clave)) continue;
      expect(anclaVisible(visibles, destino), `${clave} → ${destino}`).toBe(true);
    }
  });

  it("las pantallas fuera de ESENCIAL son justamente las que su ancla oculta", () => {
    const visibles = seccionesVisibles(true, ESENCIAL);
    for (const clave of PANTALLAS_FUERA_DE_ESENCIAL) {
      expect(anclaVisible(visibles, AYUDA[clave]), clave).toBe(false);
    }
  });
});
