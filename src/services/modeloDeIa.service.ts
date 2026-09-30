import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { OPENROUTER_PROVIDER_NAME } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// EL MODELO DE IA LO ELIGE LA PLATAFORMA (B-05 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local; decisión de
// Rocco).
//
// Todas las organizaciones usan la misma OPENROUTER_API_KEY, la de la
// plataforma. Hasta acá cualquier ADMIN de cualquier organización escribía el
// modelo que quisiera en su agente (texto libre), y la factura del modelo
// elegido la pagaba la plataforma, sin tope.
//
// Desde B-05, calcado del número de WhatsApp (ítem 127):
//   - Un agente nuevo (y el agente interno la primera vez) toma
//     OPENROUTER_MODEL. Los existentes conservan el suyo.
//   - El ADMIN del cliente VE el modelo, pero no lo cambia: el CRUD acepta que
//     el formulario reenvíe el mismo valor (o, al crear, el de la plataforma),
//     y cualquier otro es 403.
//   - Lo cambia solo un platform admin, por /api/admin/... (agentAdmin.routes).
// ---------------------------------------------------------------------------

export const MENSAJE_MODELO_LO_ELIGE_LA_PLATAFORMA =
  "El modelo de IA del agente lo elige la plataforma: pedíselo al equipo de la plataforma";

export interface ModeloDeIa {
  modelProvider: string;
  modelName: string;
}

// El de un agente nuevo: el de la plataforma.
export function modeloPorDefecto(): ModeloDeIa {
  return { modelProvider: OPENROUTER_PROVIDER_NAME, modelName: env.OPENROUTER_MODEL };
}

// Pura: el pedido del tenant solo pasa si no dice nada o repite el vigente.
// modelProvider ya viene en minúsculas del borde (modelProviderSchema).
export function assertModeloSinCambios(
  vigente: ModeloDeIa,
  pedido: { modelProvider?: string; modelName?: string },
): void {
  const cambiaProveedor =
    pedido.modelProvider !== undefined && pedido.modelProvider !== vigente.modelProvider;
  const cambiaModelo = pedido.modelName !== undefined && pedido.modelName !== vigente.modelName;
  if (cambiaProveedor || cambiaModelo) {
    throw new AppError(MENSAJE_MODELO_LO_ELIGE_LA_PLATAFORMA, 403);
  }
}
