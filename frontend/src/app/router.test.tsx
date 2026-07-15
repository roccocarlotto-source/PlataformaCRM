import { describe, expect, it } from "vitest";
import { AdminRoute } from "../auth/AdminRoute";
import { router } from "./router";

// Descubierto durante las mutaciones deliberadas de M6: AdminRoute.test.tsx
// construye su propio árbol de rutas a mano (mismo shape que router.tsx,
// pero no el archivo real) — una mutación que mueva una ruta de escritura
// FUERA del AdminRoute en router.tsx no la detecta ningún test existente.
// Este archivo verifica estructuralmente el árbol real que exporta
// router.tsx (sin renderizar, sin jsdom history) — router.routes expone el
// RouteObject[] original que createBrowserRouter recibió.
function findRoute(routes: typeof router.routes, path: string): unknown {
  for (const route of routes) {
    if (route.path === path) return route;
    if (route.children) {
      const found = findRoute(route.children as typeof router.routes, path);
      if (found) return found;
    }
  }
  return undefined;
}

function findParentElement(
  routes: typeof router.routes,
  path: string,
  parent: unknown = undefined,
): unknown {
  for (const route of routes) {
    if (route.path === path) return parent;
    if (route.children) {
      const found = findParentElement(route.children as typeof router.routes, path, route.element);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

describe("router.tsx — wiring real de Activity", () => {
  it("/activities/new y /activities/:id/edit están anidadas bajo AdminRoute", () => {
    const newParent = findParentElement(router.routes, "/activities/new") as {
      type: unknown;
    };
    const editParent = findParentElement(router.routes, "/activities/:id/edit") as {
      type: unknown;
    };

    expect(newParent?.type).toBe(AdminRoute);
    expect(editParent?.type).toBe(AdminRoute);
  });

  it("/activities (listado) NO está anidada bajo AdminRoute", () => {
    const parent = findParentElement(router.routes, "/activities") as
      | { type: unknown }
      | undefined;

    expect(parent?.type).not.toBe(AdminRoute);
  });

  it("las tres rutas de Activity existen en el árbol real", () => {
    expect(findRoute(router.routes, "/activities")).toBeDefined();
    expect(findRoute(router.routes, "/activities/new")).toBeDefined();
    expect(findRoute(router.routes, "/activities/:id/edit")).toBeDefined();
  });
});
