import type { Request } from "express";
import { CAMPOS_POR_RUTA, moduloDeLaRuta, modulosDe } from "../config/ediciones";
import { logger } from "../lib/logger";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Gate de módulos por edición (docs/ediciones.md §5.2). ÚNICO punto que lo
// decide, y no se llama ruta por ruta: lo llama `authenticate` apenas resolvió
// req.auth. Por eso:
//
//   - un pedido sin sesión sigue dando 401 (authenticate falla antes de
//     llegar acá), y el 403 MODULO_NO_INCLUIDO solo lo ve un usuario ya
//     autenticado;
//   - las rutas sin `authenticate` (health, webhooks, ingesta por API key,
//     widget, callbacks de OAuth, enlaces públicos) nunca pasan por acá, así
//     que no se pueden bloquear por error;
//   - la edición sale de req.auth, que se resuelve contra la base (mismo
//     JOIN que la organización, cacheado con el resto del contexto): nunca de
//     un header ni del body.
//
// La ruta se identifica por el patrón que registró Express
// (req.baseUrl + req.route.path, "/api/quotes/:id"), sin regex de paths.
//
// COMPLETA tiene todos los módulos: para ella esto no hace NADA, ni siquiera
// buscar la ruta. En ESENCIAL:
//   - ruta de un módulo excluido → 403 MODULO_NO_INCLUIDO;
//   - ruta sin clasificar → 403 MODULO_NO_INCLUIDO con modulo "sin_clasificar"
//     y un log de error (falla cerrado; el test de clasificación ya impide
//     mergearla);
//   - campo de un módulo excluido con valor no nulo → 400 CAMPO_NO_INCLUIDO.
// ---------------------------------------------------------------------------

export const MODULO_NO_INCLUIDO = "MODULO_NO_INCLUIDO";
export const CAMPO_NO_INCLUIDO = "CAMPO_NO_INCLUIDO";
export const MODULO_SIN_CLASIFICAR = "sin_clasificar";

/** "MÉTODO patrón" de la ruta que está atendiendo el request. HEAD lo atiende
 *  la ruta GET (Express), así que se clasifica como GET. */
export function rutaDelRequest(req: Request): string {
  const metodo = req.method === "HEAD" ? "GET" : req.method;
  const patron = (req.route as { path?: unknown } | undefined)?.path;
  return `${metodo} ${req.baseUrl}${typeof patron === "string" ? patron : req.path}`;
}

export function exigirModuloDeLaEdicion(req: Request, auth: AuthContext): void {
  if (auth.edition === "COMPLETA") return;

  const permitidos = modulosDe(auth.edition);
  const ruta = rutaDelRequest(req);
  const modulo = moduloDeLaRuta(ruta);

  if (!modulo) {
    (req.log ?? logger).error(
      { ruta, edition: auth.edition },
      "Ruta autenticada sin clasificar en src/config/ediciones.ts: se bloquea en esta edición",
    );
    throw new AppError("Esta función no está incluida en tu edición.", 403, true, {
      code: MODULO_NO_INCLUIDO,
      modulo: MODULO_SIN_CLASIFICAR,
    });
  }

  if (!permitidos.has(modulo)) {
    throw new AppError("Esta función no está incluida en tu edición.", 403, true, {
      code: MODULO_NO_INCLUIDO,
      modulo,
    });
  }

  const body: unknown = req.body;
  if (typeof body !== "object" || body === null) return;
  for (const { campo, modulo: moduloDelCampo } of CAMPOS_POR_RUTA[ruta] ?? []) {
    const valor = (body as Record<string, unknown>)[campo];
    if (valor !== undefined && valor !== null && !permitidos.has(moduloDelCampo)) {
      throw new AppError(`El campo ${campo} no está incluido en tu edición.`, 400, true, {
        code: CAMPO_NO_INCLUIDO,
        campo,
        modulo: moduloDelCampo,
      });
    }
  }
}
