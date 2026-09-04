import { describe, expect, it } from "vitest";
import { AdminRoute } from "../auth/AdminRoute";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { AppLayout } from "../layout/AppLayout";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
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
    const parent = findParentElement(router.routes, "/activities") as { type: unknown } | undefined;

    expect(parent?.type).not.toBe(AdminRoute);
  });

  it("las tres rutas de Activity existen en el árbol real", () => {
    expect(findRoute(router.routes, "/activities")).toBeDefined();
    expect(findRoute(router.routes, "/activities/new")).toBeDefined();
    expect(findRoute(router.routes, "/activities/:id/edit")).toBeDefined();
  });

  it("/tasks (Mis tareas) existe, bajo AppLayout y NO bajo AdminRoute — leer y completar lo propio es de cualquier rol", () => {
    expect(findRoute(router.routes, "/tasks")).toBeDefined();
    const parent = findParentElement(router.routes, "/tasks") as { type: unknown } | undefined;
    expect(parent?.type).toBe(AppLayout);
    expect(parent?.type).not.toBe(AdminRoute);
  });
});

describe("router.tsx — wiring real de M7 (Users, Invitations, Accept)", () => {
  it("/users, /invitations e /invitations/new están anidadas bajo AdminRoute — a diferencia de Activity, acá la LECTURA también es ADMIN-only", () => {
    const usersParent = findParentElement(router.routes, "/users") as { type: unknown };
    const invitationsParent = findParentElement(router.routes, "/invitations") as {
      type: unknown;
    };
    const invitationsNewParent = findParentElement(router.routes, "/invitations/new") as {
      type: unknown;
    };

    expect(usersParent?.type).toBe(AdminRoute);
    expect(invitationsParent?.type).toBe(AdminRoute);
    expect(invitationsNewParent?.type).toBe(AdminRoute);
  });

  it("/invite/accept no está anidada bajo ningún elemento (ni ProtectedRoute ni AdminRoute) — ruta pública de nivel superior, igual que /login", () => {
    const parent = findParentElement(router.routes, "/invite/accept");
    expect(parent).toBeUndefined();
  });

  it("las cuatro rutas de M7 existen en el árbol real", () => {
    expect(findRoute(router.routes, "/users")).toBeDefined();
    expect(findRoute(router.routes, "/invitations")).toBeDefined();
    expect(findRoute(router.routes, "/invitations/new")).toBeDefined();
    expect(findRoute(router.routes, "/invite/accept")).toBeDefined();
  });
});

describe("router.tsx — wiring real de R1.3 (Forgot/Reset Password)", () => {
  it("/forgot-password y /reset-password existen y renderizan sus páginas", () => {
    const forgot = findRoute(router.routes, "/forgot-password") as
      { element: { type: unknown } } | undefined;
    const reset = findRoute(router.routes, "/reset-password") as
      { element: { type: unknown } } | undefined;

    expect(forgot?.element.type).toBe(ForgotPasswordPage);
    expect(reset?.element.type).toBe(ResetPasswordPage);
  });

  it("/forgot-password y /reset-password no están anidadas bajo ningún elemento — rutas públicas de nivel superior, igual que /login y /invite/accept", () => {
    expect(findParentElement(router.routes, "/forgot-password")).toBeUndefined();
    expect(findParentElement(router.routes, "/reset-password")).toBeUndefined();
  });
});

describe("router.tsx — wiring real de M8 (Dashboard en '/')", () => {
  it("'/' renderiza DashboardPage, ya no HomePlaceholder", () => {
    const route = findRoute(router.routes, "/") as { element: { type: unknown } } | undefined;
    expect(route?.element.type).toBe(DashboardPage);
  });

  it("'/' sigue anidada bajo AppLayout, NO bajo AdminRoute", () => {
    const parent = findParentElement(router.routes, "/") as { type: unknown } | undefined;
    expect(parent?.type).toBe(AppLayout);
    expect(parent?.type).not.toBe(AdminRoute);
  });

  it("AppLayout (y por lo tanto '/') sigue viviendo dentro de ProtectedRoute", () => {
    const protectedRouteEntry = router.routes.find(
      (route) => (route.element as { type?: unknown } | undefined)?.type === ProtectedRoute,
    );
    expect(protectedRouteEntry).toBeDefined();

    const appLayoutEntry = protectedRouteEntry?.children?.find(
      (route) => (route.element as { type?: unknown } | undefined)?.type === AppLayout,
    );
    expect(appLayoutEntry).toBeDefined();
    expect(appLayoutEntry?.children?.some((route) => route.path === "/")).toBe(true);
  });

  it("/invite/accept sigue fuera de ProtectedRoute (ruta pública de nivel superior)", () => {
    const parent = findParentElement(router.routes, "/invite/accept");
    expect(parent).toBeUndefined();
  });

  it("las rutas de milestones anteriores permanecen intactas", () => {
    for (const path of [
      "/companies",
      "/contacts",
      "/pipelines",
      "/pipelines/:pipelineId/stages",
      "/opportunities",
      "/activities",
      "/users",
      "/invitations",
      "/login",
    ]) {
      expect(findRoute(router.routes, path)).toBeDefined();
    }
  });
});

describe("router.tsx — wiring real de Fase 3 (módulo QR)", () => {
  it("/qr (listado) existe y NO está bajo AdminRoute — GET /api/qr es lectura abierta, como /companies", () => {
    expect(findRoute(router.routes, "/qr")).toBeDefined();
    const parent = findParentElement(router.routes, "/qr") as { type: unknown } | undefined;
    expect(parent?.type).toBe(AppLayout);
    expect(parent?.type).not.toBe(AdminRoute);
  });

  it("/claim/:qrId es EXACTAMENTE ese path (lo arma buildLandingHtml del backend), dentro de ProtectedRoute y fuera de AdminRoute", () => {
    expect(findRoute(router.routes, "/claim/:qrId")).toBeDefined();
    const parent = findParentElement(router.routes, "/claim/:qrId") as
      { type: unknown } | undefined;
    expect(parent?.type).toBe(AppLayout);
    expect(parent?.type).not.toBe(AdminRoute);

    const protectedRouteEntry = router.routes.find(
      (route) => (route.element as { type?: unknown } | undefined)?.type === ProtectedRoute,
    );
    const appLayoutEntry = protectedRouteEntry?.children?.find(
      (route) => (route.element as { type?: unknown } | undefined)?.type === AppLayout,
    );
    expect(appLayoutEntry?.children?.some((route) => route.path === "/claim/:qrId")).toBe(true);
  });

  it("no hay rutas /qr/new ni /qr/:id/edit: crear y editar son diálogos dentro de /qr", () => {
    expect(findRoute(router.routes, "/qr/new")).toBeUndefined();
    expect(findRoute(router.routes, "/qr/:id/edit")).toBeUndefined();
  });
});
