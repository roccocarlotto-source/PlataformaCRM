import type { AuthContext } from "../types/auth";

// ---------------------------------------------------------------------------
// Caché corta del contexto de autenticación (D5; FABLE-I-03 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// CADA request autenticado empezaba con una ida a la base para resolver el
// usuario, su organización y su rol. Con la base en otra región, esa ida es
// una parte fija de la latencia de TODA la API, y una pantalla hace varias
// requests: la misma consulta, con la misma respuesta, varias veces por
// segundo. Ahora la respuesta se recuerda unos segundos por usuario.
//
// QUÉ SE GUARDA: solo un contexto válido (usuario activo, organización
// vigente). Un rechazo no se guarda: se vuelve a consultar cada vez.
//
// EL COSTO, Y POR QUÉ SON POCOS SEGUNDOS: un cambio en el usuario —lo
// desactivan, le cambian el rol— tarda hasta el TTL en verse. Los cambios que
// pasan por este backend (PATCH y DELETE de usuarios) lo borran de la caché en
// el acto, así que esa ventana queda solo para lo que se toque por fuera
// (directo en la base). El token se sigue verificando en cada request: esto
// no estira una sesión vencida.
//
// En memoria del proceso, como el resto del estado de este backend (un solo
// proceso). Con tope de entradas: un mapa que nadie poda es una fuga.
// ---------------------------------------------------------------------------

const MAX_ENTRADAS = 5_000;

export interface AuthContextCache {
  leer(userId: string): AuthContext | null;
  guardar(contexto: AuthContext): void;
  olvidar(userId: string): void;
  vaciar(): void;
}

export function crearAuthContextCache(
  ttlMs: number,
  ahora: () => number = Date.now,
): AuthContextCache {
  const entradas = new Map<string, { contexto: AuthContext; vence: number }>();
  return {
    leer(userId) {
      const entrada = entradas.get(userId);
      if (!entrada) {
        return null;
      }
      if (entrada.vence <= ahora()) {
        entradas.delete(userId);
        return null;
      }
      return entrada.contexto;
    },
    guardar(contexto) {
      if (ttlMs <= 0) {
        return;
      }
      if (!entradas.has(contexto.userId) && entradas.size >= MAX_ENTRADAS) {
        // La más vieja (un Map conserva el orden de inserción).
        const primera = entradas.keys().next().value;
        if (primera !== undefined) {
          entradas.delete(primera);
        }
      }
      entradas.set(contexto.userId, { contexto, vence: ahora() + ttlMs });
    },
    olvidar(userId) {
      entradas.delete(userId);
    },
    vaciar() {
      entradas.clear();
    },
  };
}
