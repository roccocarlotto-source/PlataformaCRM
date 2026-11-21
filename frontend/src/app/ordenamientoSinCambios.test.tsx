import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { router } from "./router";

// ---------------------------------------------------------------------------
// Ordenamiento en núcleo y dos productos (docs/ordenamiento-productos.md §5.0,
// punto 4): una foto fija del árbol de rutas que exporta router.tsx. Mover
// pantallas entre carpetas (features/automotora, features/clinica) no puede
// cambiarla: mismas rutas, mismo anidamiento, mismos envoltorios (ModuloRoute
// con su módulo, AdminRoute, AppLayout…), mismas pantallas y en el mismo orden.
//
// De cada elemento se guarda el nombre del componente y sus props simples. El
// nombre no depende de la carpeta del archivo. Para regenerar la foto cuando
// un cambio es a propósito (y entonces no es parte del ordenamiento):
// npx vitest run src/app/ordenamientoSinCambios.test.tsx -u, y revisar el diff.
// La ruta va ANTES de -u: en vitest 4, -u acepta un valor ("new", "all"…), y
// con `-u ruta` se come la ruta y regraba los snapshots de toda la suite (con
// el locale de la PC, textosDelRubro.test.tsx.snap queda mal).
// ---------------------------------------------------------------------------

type Serializado =
  string | { componente: string; props?: Record<string, unknown>; hijos?: Serializado[] };

function nombreDe(tipo: unknown): string {
  if (typeof tipo === "string") return tipo;
  const t = tipo as { displayName?: string; name?: string; type?: unknown; render?: unknown };
  if (t.displayName) return t.displayName;
  if (t.name) return t.name;
  // memo(Componente) y forwardRef(Componente).
  if (t.type) return `memo(${nombreDe(t.type)})`;
  if (t.render) return `forwardRef(${nombreDe(t.render)})`;
  return "?";
}

function serializar(nodo: ReactNode): Serializado | undefined {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return undefined;
  if (!isValidElement(nodo)) return String(nodo);
  const props = nodo.props as Record<string, unknown>;
  const simples: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(props)) {
    if (clave === "children") continue;
    if (["string", "number", "boolean"].includes(typeof valor)) simples[clave] = valor;
    else if (isValidElement(valor)) simples[clave] = serializar(valor);
    else if (Array.isArray(valor) && valor.every((v) => typeof v === "string"))
      simples[clave] = valor;
    else if (valor !== undefined) simples[clave] = `<${typeof valor}>`;
  }
  const hijos = Children.toArray(props.children as ReactNode)
    .map(serializar)
    .filter((h): h is Serializado => h !== undefined);
  return {
    componente: nombreDe(nodo.type),
    ...(Object.keys(simples).length > 0 ? { props: simples } : {}),
    ...(hijos.length > 0 ? { hijos } : {}),
  };
}

interface RutaDelArbol {
  path?: string;
  index?: boolean;
  element?: ReactNode;
  errorElement?: ReactNode;
  children?: RutaDelArbol[];
  loader?: unknown;
  action?: unknown;
  lazy?: unknown;
}

function arbol(rutas: readonly RutaDelArbol[]): unknown[] {
  return rutas.map((ruta) => ({
    ...(ruta.path !== undefined ? { path: ruta.path } : {}),
    ...(ruta.index ? { index: true } : {}),
    ...(ruta.element !== undefined ? { element: serializar(ruta.element) } : {}),
    ...(ruta.errorElement !== undefined ? { errorElement: serializar(ruta.errorElement) } : {}),
    ...(ruta.loader ? { loader: true } : {}),
    ...(ruta.action ? { action: true } : {}),
    ...(ruta.lazy ? { lazy: true } : {}),
    ...(ruta.children ? { children: arbol(ruta.children) } : {}),
  }));
}

function contarRutas(rutas: readonly RutaDelArbol[]): number {
  return rutas.reduce(
    (total, r) => total + (r.path !== undefined || r.index ? 1 : 0) + contarRutas(r.children ?? []),
    0,
  );
}

describe("ordenamiento: el árbol de rutas del frontend no cambia", () => {
  it("rutas, anidamiento, envoltorios y pantallas, en orden", async () => {
    const rutas = router.routes as readonly RutaDelArbol[];
    // Si el recorrido se rompe, la foto quedaría vacía y no probaría nada.
    expect(contarRutas(rutas)).toBeGreaterThan(60);
    await expect(`${JSON.stringify(arbol(rutas), null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/ordenamiento-router.json",
    );
  });
});
