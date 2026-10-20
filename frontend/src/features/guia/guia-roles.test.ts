import { isValidElement, type ComponentType } from "react";
import type { RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { router } from "../../app/router";
import { AdminRoute } from "../../auth/AdminRoute";
import { PlatformAdminRoute } from "../../auth/PlatformAdminRoute";
import { AYUDA, type ClaveDeAyuda } from "./anclas";
import {
  RUTAS_DE_ADMIN,
  RUTAS_DE_PLATAFORMA,
  SECCIONES,
  SOLO_ADMIN_DE_ANCLA,
  SOLO_ADMIN_DE_ANCLA_DE_CLINICA,
  seccionesDelRubro,
  type Seccion,
} from "./secciones";

// ---------------------------------------------------------------------------
// El filtro por rol de la guía (src/compartido/guia/guia.ts) contra el router
// real: qué pantallas son de AdminRoute y a qué bloque apunta el "?" de cada
// una. Así una pantalla de administrador nueva, o un bloque que se mueve, no
// deja a un USER con un "?" que lleva a algo que no ve (ni le muestra cómo se
// configura algo que no puede abrir).
// ---------------------------------------------------------------------------

type Acceso = "todos" | "admin" | "plataforma";

// Cada ruta del router con su componente y quién la puede abrir.
function rutasDelRouter(): { path: string; componente: string; acceso: Acceso }[] {
  const rutas: { path: string; componente: string; acceso: Acceso }[] = [];
  const recorrer = (hijas: RouteObject[], acceso: Acceso) => {
    for (const ruta of hijas) {
      const tipo = isValidElement(ruta.element) ? ruta.element.type : null;
      const propio: Acceso =
        tipo === PlatformAdminRoute ? "plataforma" : tipo === AdminRoute ? "admin" : acceso;
      if (ruta.path && typeof tipo === "function") {
        rutas.push({ path: ruta.path, componente: (tipo as ComponentType).name, acceso: propio });
      }
      if (ruta.children) recorrer(ruta.children, propio);
    }
  };
  recorrer(router.routes as RouteObject[], "todos");
  return rutas;
}

// En qué componente se usa cada clave de AYUDA: el archivo que tiene
// `AYUDA.<clave>` se llama como su componente (UserListPage.tsx).
const FUENTES = import.meta.glob<string>(["../**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function componentesDe(clave: ClaveDeAyuda): string[] {
  const uso = new RegExp(`AYUDA\\.${clave}\\b`);
  return Object.entries(FUENTES)
    .filter(([, fuente]) => uso.test(fuente))
    .map(([ruta]) => ruta.replace(/^.*\/|\.tsx$/g, ""));
}

// Las claves cuyo componente no es una ruta propia, con la pantalla donde se
// muestran.
const COMPONENTE_DE_LA_PANTALLA: Partial<Record<ClaveDeAyuda, string>> = {
  conversacion: "ConversationListPage",
};

const RUTAS = rutasDelRouter();

function accesoDe(clave: ClaveDeAyuda): Acceso {
  const componentes = componentesDe(clave).map((c) => COMPONENTE_DE_LA_PANTALLA[clave] ?? c);
  const accesos = RUTAS.filter((r) => componentes.includes(r.componente)).map((r) => r.acceso);
  if (accesos.length === 0) throw new Error(`${clave}: su pantalla no es una ruta del router`);
  if (accesos.every((a) => a === "plataforma")) return "plataforma";
  return accesos.every((a) => a !== "todos") ? "admin" : "todos";
}

function existe(secciones: Seccion[], clave: string): boolean {
  const [slug, ancla] = clave.split("#");
  return secciones.some((s) => s.slug === slug && s.encabezados.some((e) => e.ancla === ancla));
}

// Pantallas de administrador cuyo "?" apunta a un bloque que también ve un
// USER, a propósito.
const ADMIN_CON_BLOQUE_DE_TODOS: Readonly<Partial<Record<ClaveDeAyuda, string>>> = {
  unidadForm: "La ficha de la unidad explica los campos que el USER ve en «Ver detalle».",
  camposDeContacto: "Explica cómo se ven los campos en la ficha, que el USER completa.",
};
// En una clínica, pantallas de todos los roles que Recepción no tiene en el menú.
const DE_TODOS_SIN_RECEPCION: Readonly<Partial<Record<ClaveDeAyuda, string>>> = {
  qr: "MenuDeClinica muestra QR solo a un administrador.",
};

describe("rutas de administrador de la guía", () => {
  it("RUTAS_DE_ADMIN y RUTAS_DE_PLATAFORMA son las del router", () => {
    const deAcceso = (acceso: Acceso) =>
      [...new Set(RUTAS.filter((r) => r.acceso === acceso).map((r) => r.path))].sort();
    expect([...RUTAS_DE_ADMIN].sort()).toEqual(deAcceso("admin"));
    expect([...RUTAS_DE_PLATAFORMA].sort()).toEqual(deAcceso("plataforma"));
  });
});

describe("bloques de administrador (SOLO_ADMIN_DE_ANCLA)", () => {
  const raiz = SECCIONES;
  // Una clínica nunca tiene el taller (Servicios es solo de automotora).
  const clinica = seccionesDelRubro(true, (modulo) => modulo !== "servicios");

  it("cada ancla de los registros existe en su guía", () => {
    for (const clave of SOLO_ADMIN_DE_ANCLA) expect(existe(raiz, clave), clave).toBe(true);
    for (const clave of SOLO_ADMIN_DE_ANCLA_DE_CLINICA) {
      expect(existe(clinica, clave), clave).toBe(true);
    }
  });

  for (const [rubro, secciones, registro, excepciones] of [
    ["automotora", raiz, SOLO_ADMIN_DE_ANCLA, {}],
    ["clínica", clinica, SOLO_ADMIN_DE_ANCLA_DE_CLINICA, DE_TODOS_SIN_RECEPCION],
  ] as const) {
    it(`${rubro}: el "?" de una pantalla de todos nunca lleva a un bloque de administrador`, () => {
      for (const [clave, destino] of Object.entries(AYUDA) as [ClaveDeAyuda, string][]) {
        if (!existe(secciones, destino) || accesoDe(clave) !== "todos") continue;
        if (clave in excepciones) continue;
        expect(registro.has(destino), `${clave} → ${destino}`).toBe(false);
      }
    });

    it(`${rubro}: el "?" de una pantalla de administrador lleva a un bloque de administrador`, () => {
      for (const [clave, destino] of Object.entries(AYUDA) as [ClaveDeAyuda, string][]) {
        if (!existe(secciones, destino) || accesoDe(clave) !== "admin") continue;
        if (rubro === "automotora" && clave in ADMIN_CON_BLOQUE_DE_TODOS) continue;
        if (rubro === "clínica" && clave === "camposDeContacto") {
          // En una clínica el bloque sí es de administrador.
          expect(registro.has(destino), clave).toBe(true);
          continue;
        }
        expect(registro.has(destino), `${clave} → ${destino}`).toBe(true);
      }
    });
  }

  it("las excepciones son pantallas reales con el acceso que dicen", () => {
    for (const clave of Object.keys(ADMIN_CON_BLOQUE_DE_TODOS) as ClaveDeAyuda[]) {
      expect(accesoDe(clave), clave).toBe("admin");
    }
    for (const clave of Object.keys(DE_TODOS_SIN_RECEPCION) as ClaveDeAyuda[]) {
      expect(accesoDe(clave), clave).toBe("todos");
    }
  });
});
