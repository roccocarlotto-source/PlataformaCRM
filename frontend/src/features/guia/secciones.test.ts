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
  SOLO_SIN_MODULO,
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

// Las claves de AYUDA que una edición no usa nunca. En ESENCIAL: las pantallas
// que no tiene (su ruta vuelve al inicio, ModuloRoute) y las de oportunidades
// de COMPLETA (en ESENCIAL, esas pantallas usan las claves *Esencial). En
// COMPLETA: las claves *Esencial. Toda otra clave es de una pantalla de esa
// edición y tiene que apuntar a un ancla visible en ella.
const FUERA_DE_ESENCIAL: ReadonlySet<ClaveDeAyuda> = new Set<ClaveDeAyuda>([
  "empresas",
  "empresaForm",
  "procesosDeVenta",
  "procesoForm",
  "etapas",
  "etapaForm",
  "oportunidades",
  "oportunidadForm",
]);
const SOLO_DE_ESENCIAL: ReadonlySet<ClaveDeAyuda> = new Set<ClaveDeAyuda>([
  "oportunidadesEsencial",
  "oportunidadEsencialForm",
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
      "## Oportunidades en la edición Esencial {#oportunidades-esencial}",
      "Se elige el estado.",
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
      "## Pedidos {#pedidos}",
      "Siempre.",
    ].join("\n"),
  );

  it("sin el módulo, saca el ## con su texto y sus ###; lo de solo sin el módulo aparece", () => {
    const filtrada = filtrarPorModulos(
      seccion,
      (m) => m !== "cotizaciones" && m !== "procesos_de_venta",
    );
    expect(filtrada.encabezados.map((e) => e.ancla)).toEqual(["oportunidades-esencial", "pedidos"]);
    expect(filtrada.markdown).not.toMatch(/cotiza/i);
    expect(filtrada.markdown).toMatch(/Se elige el estado\./);
    expect(filtrada.markdown).toMatch(/Siempre\./);
  });

  it("con todos los módulos saca solo lo de «sin el módulo»", () => {
    const filtrada = filtrarPorModulos(seccion, () => true);
    expect(filtrada.encabezados.map((e) => e.ancla)).toEqual([
      "oportunidades",
      "cotizaciones",
      "crear-una-cotizacion",
      "pedidos",
    ]);
    expect(filtrada.markdown).not.toMatch(/Se elige el estado/);
  });

  it("un ### con ancla propia se oculta hasta el próximo ### o ##", () => {
    const stock = parsearSeccion(
      "05-stock.md",
      [
        "# Stock",
        "",
        "## Nueva unidad {#nueva-unidad}",
        "Pasos.",
        "",
        "### Desde una permuta {#desde-una-permuta}",
        "Lo de la permuta.",
        "",
        "## La ficha {#ficha-de-unidad}",
        "La ficha.",
      ].join("\n"),
    );
    const filtrada = filtrarPorModulos(stock, (m) => m !== "permutas");
    expect(filtrada.encabezados.map((e) => e.ancla)).toEqual(["nueva-unidad", "ficha-de-unidad"]);
    expect(filtrada.markdown).toMatch(/Pasos\./);
    expect(filtrada.markdown).not.toMatch(/permuta/i);
    expect(filtrada.markdown).toMatch(/La ficha\./);
    expect(filtrarPorModulos(stock, () => true)).toBe(stock);
  });
});

describe("la guía real por edición", () => {
  it("cada bloque de MODULO_DE_ANCLA y SOLO_SIN_MODULO existe en la guía (un rename lo rompe acá)", () => {
    for (const destino of [...Object.keys(MODULO_DE_ANCLA), ...Object.keys(SOLO_SIN_MODULO)]) {
      expect(anclaVisible(SECCIONES, destino), destino).toBe(true);
    }
  });

  it("ESENCIAL no ve los bloques de los módulos que no tiene, y sí el de oportunidades simples", () => {
    const visibles = seccionesVisibles(true, ESENCIAL);
    for (const destino of Object.keys(MODULO_DE_ANCLA)) {
      expect(anclaVisible(visibles, destino), destino).toBe(false);
    }
    for (const destino of Object.keys(SOLO_SIN_MODULO)) {
      expect(anclaVisible(visibles, destino), destino).toBe(true);
    }
    const oportunidades = visibles.find((s) => s.slug === "oportunidades-y-procesos-de-venta");
    expect(oportunidades?.markdown).not.toMatch(/^## Cotizaciones/m);
    expect(oportunidades?.markdown).not.toMatch(/no se elige a mano/);
    expect(oportunidades?.markdown).toMatch(/^## Oportunidades en la edición Esencial/m);
  });

  // Una clínica en COMPLETA ya no entra acá: desde R17 tieneModulo lee sus
  // módulos también en COMPLETA (no tiene empresas ni procesos de venta).
  it("COMPLETA ve la guía de siempre: todo menos el bloque de Esencial", () => {
    for (const regla of [COMPLETA]) {
      const visibles = seccionesVisibles(true, regla);
      for (const destino of Object.keys(MODULO_DE_ANCLA)) {
        expect(anclaVisible(visibles, destino), destino).toBe(true);
      }
      for (const destino of Object.keys(SOLO_SIN_MODULO)) {
        expect(anclaVisible(visibles, destino), destino).toBe(false);
      }
      // Las secciones sin bloques de Esencial son las MISMAS, sin copiar ni
      // reescribir links.
      visibles.forEach((seccion, i) => {
        const original = SECCIONES[i];
        if (seccion.slug !== "oportunidades-y-procesos-de-venta") expect(seccion).toBe(original);
      });
      expect(visibles).toEqual(seccionesVisibles(true));
    }
  });

  it("cada '?' apunta a un ancla visible en su edición", () => {
    const esencial = seccionesVisibles(true, ESENCIAL);
    const completa = seccionesVisibles(true, COMPLETA);
    for (const [clave, destino] of Object.entries(AYUDA) as [ClaveDeAyuda, string][]) {
      if (!FUERA_DE_ESENCIAL.has(clave)) {
        expect(anclaVisible(esencial, destino), `ESENCIAL ${clave} → ${destino}`).toBe(true);
      }
      if (!SOLO_DE_ESENCIAL.has(clave)) {
        expect(anclaVisible(completa, destino), `COMPLETA ${clave} → ${destino}`).toBe(true);
      }
    }
  });

  it("las claves fuera de ESENCIAL son justamente las que su ancla oculta", () => {
    const esencial = seccionesVisibles(true, ESENCIAL);
    const completa = seccionesVisibles(true, COMPLETA);
    for (const clave of FUERA_DE_ESENCIAL) {
      expect(anclaVisible(esencial, AYUDA[clave]), clave).toBe(false);
    }
    for (const clave of SOLO_DE_ESENCIAL) {
      expect(anclaVisible(completa, AYUDA[clave]), clave).toBe(false);
    }
  });

  it("en ninguna edición queda un link interno a un bloque que no se ve", () => {
    const re = /\]\((?:\/ayuda\/([a-z0-9-]+))?(?:#([a-z0-9-]+))?\)/g;
    for (const regla of [ESENCIAL, COMPLETA, CLINICA_COMPLETA]) {
      const visibles = seccionesVisibles(true, regla);
      for (const seccion of visibles) {
        for (const match of seccion.markdown.matchAll(re)) {
          const slug = match[1] ?? seccion.slug;
          if (!match[2]) continue;
          expect(
            anclaVisible(visibles, `${slug}#${match[2]}`),
            `${seccion.slug}: link a ${slug}#${match[2]}`,
          ).toBe(true);
        }
      }
    }
  });
});
