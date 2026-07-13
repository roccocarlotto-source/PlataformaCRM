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
import { ApiError, request } from "../lib/api";
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
    queryFn: ({ signal }) => request<MeResponse>("/api/me", { getAccessToken, signal }),
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
