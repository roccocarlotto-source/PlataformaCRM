import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { ApiError, registerUnauthorizedHandler, request } from "../lib/api";
import { getAccessToken } from "./getAccessToken";

// Contrato real de GET /api/me (src/controllers/me.controller.ts): serializa
// exactamente el AuthContext que el backend ya resolvió contra Postgres para
// este request. No agregar campos que ese endpoint no devuelve.
export interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  role: "ADMIN" | "USER";
}

export type AuthStatus =
  | "initializing"
  | "unauthenticated"
  | "loading-profile"
  | "authenticated"
  | "account-unavailable"
  | "profile-error";

export interface AuthContextValue {
  status: AuthStatus;
  me: MeResponse | null;
  accountUnavailableReason: string | null;
  profileError: Error | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  retryProfile(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// SE DEJA EL HOOK ACÁ Y SE SILENCIA EL AVISO, en vez de mudarlo a su propio
// archivo como se hizo con NotFoundPlaceholder en app/router.tsx. La diferencia
// no es de criterio, es de radio de impacto:
//
//   - NotFoundPlaceholder se usaba en UN solo lugar. Mudarlo costó un archivo
//     nuevo y un import.
//   - useAuth lo importan 31 archivos, y —esto es lo que decide— 12 tests hacen
//     `vi.mock("../../auth/AuthContext")` POR RUTA DE MÓDULO. Si el hook se
//     mudara, esos mocks seguirían interceptando un módulo que ya no lo exporta
//     y los componentes bajo test pasarían a usar el useAuth REAL. No fallarían
//     con un error de import: fallarían de a poco, o peor, seguirían en verde
//     probando otra cosa.
//
// El costo de no mudarlo es acotado y conocido: al editar este archivo, Vite
// hace un reload completo en vez de un hot-reload con estado preservado. Es una
// molestia de desarrollo, no un defecto del producto — y este archivo casi no se
// edita. Cambiar eso por 12 mocks silenciosamente rotos sería un mal negocio.
// eslint-disable-next-line react-refresh/only-export-components -- ver arriba: mudar useAuth rompería 12 vi.mock por ruta sin que ningún test lo diga
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // undefined: onAuthStateChange todavía no disparó ningún evento.
  // null: disparó, sin sesión. string: disparó, session.user.id conocido.
  const [identityKey, setIdentityKey] = useState<string | null | undefined>(undefined);

  // Espejo de identityKey leído/escrito sincrónicamente dentro del callback
  // de onAuthStateChange (registrado una sola vez — su closure quedaría
  // stale si comparara contra el estado de React directamente).
  const identityRef = useRef<string | null | undefined>(undefined);

  const handleIdentityChange = useCallback(
    (newIdentityKey: string | null) => {
      if (identityRef.current === newIdentityKey) {
        // Misma identidad que ya conocíamos (evento repetido para el mismo
        // usuario) — no-op de frontera: no limpiar cache, no recalcular nada.
        return;
      }

      // Identidad nueva: primera vez, login, logout, o sesión A reemplazada
      // por B sin SIGNED_OUT observable. Limpiar ANTES de exponer la nueva
      // identityKey, para que ningún componente pueda leer la key nueva
      // mientras el cache del tenant/usuario anterior todavía existe.
      queryClient.clear();
      identityRef.current = newIdentityKey;
      setIdentityKey(newIdentityKey);
    },
    [queryClient],
  );

  // R1.4 — se registra una sola vez: cualquier 401 de request() (venga de
  // cualquier módulo, en cualquier momento) termina acá. signOut() dispara
  // SIGNED_OUT más abajo, que ya limpia identidad y cache — no hay estado
  // nuevo que mantener, solo reutiliza el circuito de logout existente.
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      supabase.auth.signOut({ scope: "local" }).catch((error: unknown) => {
        console.error("No se pudo cerrar la sesión tras un 401", error);
      });
    });
  }, []);

  useEffect(() => {
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === "TOKEN_REFRESHED") {
        // organizationId/role no dependen del contenido del token (se
        // resuelven contra Postgres en cada request, ver
        // docs/authentication-architecture.md) — un refresh no requiere
        // re-consultar /api/me ni tocar la frontera de identidad.
        return;
      }

      handleIdentityChange(session?.user.id ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [handleIdentityChange]);

  // La queryKey incluye la identidad: una respuesta tardía de ["me","A"]
  // nunca puede poblar el estado de un observer que ya mira ["me","B"] —
  // esto es lo que aísla A de B, no el timing de queryClient.clear().
  const meQuery = useQuery({
    queryKey: ["me", identityKey ?? "none"] as const,
    // "/me", no "/api/me": buildUrl() ya prefija "/api" (ver lib/api.ts) —
    // mismo criterio que el resto de los módulos, ya no un caso especial.
    queryFn: ({ signal }) => request<MeResponse>("/me", { getAccessToken, signal }),
    enabled: identityKey != null,
  });

  const status: AuthStatus =
    identityKey === undefined
      ? "initializing"
      : identityKey === null
        ? "unauthenticated"
        : meQuery.isLoading
          ? "loading-profile"
          : meQuery.isSuccess
            ? "authenticated"
            : meQuery.isError
              ? meQuery.error instanceof ApiError && meQuery.error.status === 403
                ? "account-unavailable"
                : "profile-error"
              : "loading-profile";

  const accountUnavailableReason =
    status === "account-unavailable" && meQuery.error instanceof ApiError
      ? meQuery.error.message
      : null;

  const profileError = status === "profile-error" ? meQuery.error : null;

  async function login(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
    // No aplicar la sesión a mano: onAuthStateChange (SIGNED_IN) es quien
    // dispara handleIdentityChange con la identidad real.
  }

  async function logout(): Promise<void> {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      // Supabase no confirmó el cierre de sesión: no tocar identityRef,
      // identityKey ni el cache. Seguimos representando exactamente lo que
      // Supabase todavía tiene (sesión válida) — nunca declarar localmente
      // un logout que el proveedor no concretó.
      throw error;
    }
    // Éxito: nada más acá. El SIGNED_OUT real es quien aplica
    // handleIdentityChange(null) y limpia el cache.
  }

  function retryProfile(): void {
    meQuery.refetch();
  }

  const value: AuthContextValue = {
    status,
    me: meQuery.data ?? null,
    accountUnavailableReason,
    profileError,
    login,
    logout,
    retryProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
