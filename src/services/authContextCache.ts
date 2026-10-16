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
// EL COSTO, Y POR QUÉ ALCANZA CON 30 SEGUNDOS: un cambio en el usuario —lo
// desactivan, le cambian el rol— tardaría hasta el TTL en verse. Los cambios
// que pasan por este backend lo borran de la caché en el acto:
//   - PATCH y DELETE de usuarios (rol, activo, sedes, remover): olvidar(id),
//     en user.service.ts;
//   - edición, rubro y módulos activables de la organización: vaciar(), en
//     organizationAdmin.service.ts y organizationModules.service.ts.
// Un usuario no cambia de organización por la API. Así que la ventana del TTL
// queda solo para lo que se toque por fuera (directo en la base). Lo fija
// authContextCache.integration-test.ts, con la caché encendida. El token se
// sigue verificando en cada request: esto no estira una sesión vencida.
//
// LA CARRERA QUE ESTO EVITA: un request lee el usuario de la base justo ANTES
// de que lo desactiven y lo guarda justo DESPUÉS de olvidar(). Sin más, ese
// contexto viejo quedaría guardado el TTL entero. Por eso guardar() recibe la
// marca() que se tomó antes de ir a la base, y no guarda si desde entonces hubo
// un olvidar() de ese usuario o un vaciar().
//
// En memoria del proceso, como el resto del estado de este backend (un solo
// proceso). Con tope de entradas: un mapa que nadie poda es una fuga.
// ---------------------------------------------------------------------------

const MAX_ENTRADAS = 5_000;

export interface AuthContextCache {
  leer(userId: string): AuthContext | null;
  /** Antes de ir a la base: lo que después se le pasa a guardar(). */
  marca(): number;
  /** Con la marca de antes de leer: no guarda si el usuario se invalidó en el
   *  medio. Sin marca, guarda siempre. */
  guardar(contexto: AuthContext, desde?: number): void;
  olvidar(userId: string): void;
  vaciar(): void;
}

export function crearAuthContextCache(
  ttlMs: number,
  ahora: () => number = Date.now,
): AuthContextCache {
  const entradas = new Map<string, { contexto: AuthContext; vence: number }>();
  // Un contador que sube en cada invalidación, y cuándo (en ese contador) se
  // invalidó cada usuario o la caché entera.
  let contador = 0;
  const olvidadoEn = new Map<string, number>();
  let vaciadoEn = 0;
  return {
    marca() {
      return contador;
    },
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
    guardar(contexto, desde) {
      if (ttlMs <= 0) {
        return;
      }
      if (
        desde !== undefined &&
        (vaciadoEn > desde || (olvidadoEn.get(contexto.userId) ?? 0) > desde)
      ) {
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
      contador += 1;
      if (olvidadoEn.size >= MAX_ENTRADAS) {
        // Con tope, como las entradas: vaciar el registro y contarlo como un
        // vaciar() es conservador (a lo sumo no se guarda algo que se podía).
        olvidadoEn.clear();
        vaciadoEn = contador;
      }
      olvidadoEn.set(userId, contador);
    },
    vaciar() {
      entradas.clear();
      contador += 1;
      vaciadoEn = contador;
      olvidadoEn.clear();
    },
  };
}
