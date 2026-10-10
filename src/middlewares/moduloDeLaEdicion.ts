import type { Request } from "express";
import {
  CAMPOS_POR_RUTA,
  SOLO_CLINICA,
  moduloDeLaRuta,
  modulosDe,
  motivoDeExclusion,
  type MotivoDeExclusion,
} from "../config/ediciones";
import { logger } from "../lib/logger";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Gate de módulos por edición y por rubro (docs/ediciones.md §5.2,
// docs/rubros.md §1.2). ÚNICO punto que lo decide, y no se llama ruta por
// ruta: lo llama `authenticate` apenas resolvió req.auth. Por eso:
//
//   - un pedido sin sesión sigue dando 401 (authenticate falla antes de
//     llegar acá), y el 403 MODULO_NO_INCLUIDO solo lo ve un usuario ya
//     autenticado;
//   - las rutas sin `authenticate` (health, webhooks, ingesta por API key,
//     widget, callbacks de OAuth, enlaces públicos) nunca pasan por acá, así
//     que no se pueden bloquear por error;
//   - la edición y el rubro salen de req.auth, que se resuelve contra la base
//     (mismo JOIN que la organización, cacheado con el resto del contexto):
//     nunca de un header ni del body.
//
// La ruta se identifica por el patrón que registró Express
// (req.baseUrl + req.route.path, "/api/quotes/:id"), sin regex de paths.
//
// COMPLETA + AUTOMOTORA (todas las organizaciones de hoy) tiene todos los
// módulos menos los solo de clínica: para ella esto no hace NADA salvo
// rechazar una ruta de un módulo solo de clínica (403 con motivo RUBRO). En
// cualquier otra combinación:
//   - ruta de un módulo excluido → 403 MODULO_NO_INCLUIDO;
//   - ruta sin clasificar → 403 MODULO_NO_INCLUIDO con modulo "sin_clasificar"
//     y un log de error (falla cerrado; el test de clasificación ya impide
//     mergearla);
//   - campo de un módulo excluido con valor no nulo → 400 CAMPO_NO_INCLUIDO.
//
// El 403 y el 400 llevan `motivo: "EDICION" | "RUBRO"` (D12 de
// docs/rubros.md), un campo aditivo: el código y el resto del cuerpo no
// cambian. Con EDICION el frontend ofrece la edición completa; con RUBRO no
// ofrece nada.
// ---------------------------------------------------------------------------

export const MODULO_NO_INCLUIDO = "MODULO_NO_INCLUIDO";
export const CAMPO_NO_INCLUIDO = "CAMPO_NO_INCLUIDO";
export const MODULO_SIN_CLASIFICAR = "sin_clasificar";

const MENSAJE: Record<MotivoDeExclusion, string> = {
  EDICION: "Esta función no está incluida en tu edición.",
  RUBRO: "Esta función no está disponible para tu rubro.",
};

/** "MÉTODO patrón" de la ruta que está atendiendo el request. HEAD lo atiende
 *  la ruta GET (Express), así que se clasifica como GET. */
export function rutaDelRequest(req: Request): string {
  const metodo = req.method === "HEAD" ? "GET" : req.method;
  const patron = (req.route as { path?: unknown } | undefined)?.path;
  return `${metodo} ${req.baseUrl}${typeof patron === "string" ? patron : req.path}`;
}

export function exigirModuloDeLaEdicion(req: Request, auth: AuthContext): void {
  if (auth.edition === "COMPLETA" && auth.industry === "AUTOMOTORA") {
    // Sigue siendo un no-op para COMPLETA + AUTOMOTORA, con UNA excepción
    // desde R5: las rutas de un módulo solo de clínica (SOLO_CLINICA, hoy
    // agenda_clinica) no son de una automotora. Todo lo demás (rutas sin
    // clasificar, campos) queda como antes.
    const modulo = moduloDeLaRuta(rutaDelRequest(req));
    if (modulo !== undefined && SOLO_CLINICA.has(modulo)) {
      throw new AppError(MENSAJE.RUBRO, 403, true, {
        code: MODULO_NO_INCLUIDO,
        modulo,
        motivo: "RUBRO",
      });
    }
    return;
  }

  const permitidos = modulosDe(auth.edition, auth.industry);
  const ruta = rutaDelRequest(req);
  const modulo = moduloDeLaRuta(ruta);

  if (!modulo) {
    // Sin módulo no hay a quién preguntarle: lo nombra lo que la saca del
    // no-op, el rubro si no es AUTOMOTORA.
    const motivo: MotivoDeExclusion = auth.industry === "AUTOMOTORA" ? "EDICION" : "RUBRO";
    (req.log ?? logger).error(
      { ruta, edition: auth.edition, industry: auth.industry },
      "Ruta autenticada sin clasificar en src/config/ediciones.ts: se bloquea en esta edición y rubro",
    );
    throw new AppError(MENSAJE[motivo], 403, true, {
      code: MODULO_NO_INCLUIDO,
      modulo: MODULO_SIN_CLASIFICAR,
      motivo,
    });
  }

  if (!permitidos.has(modulo)) {
    const motivo = motivoDeExclusion(modulo, auth.industry);
    throw new AppError(MENSAJE[motivo], 403, true, {
      code: MODULO_NO_INCLUIDO,
      modulo,
      motivo,
    });
  }

  const body: unknown = req.body;
  if (typeof body !== "object" || body === null) return;
  for (const { campo, modulo: moduloDelCampo } of CAMPOS_POR_RUTA[ruta] ?? []) {
    const valor = (body as Record<string, unknown>)[campo];
    if (valor !== undefined && valor !== null && !permitidos.has(moduloDelCampo)) {
      const motivo = motivoDeExclusion(moduloDelCampo, auth.industry);
      throw new AppError(
        motivo === "EDICION"
          ? `El campo ${campo} no está incluido en tu edición.`
          : `El campo ${campo} no está disponible para tu rubro.`,
        400,
        true,
        { code: CAMPO_NO_INCLUIDO, campo, modulo: moduloDelCampo, motivo },
      );
    }
  }
}
