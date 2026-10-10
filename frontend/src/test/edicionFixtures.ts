import type { MeResponse } from "../auth/AuthContext";

// Los `modulos` que /api/me manda para una automotora en cada edición: copia
// de MODULOS / SOLO_COMPLETA de src/config/ediciones.ts (el backend). Si allá
// cambia el catálogo, acá se actualiza a mano: los tests de pantalla solo
// necesitan que ESENCIAL no tenga los módulos de SOLO_COMPLETA.
const EN_LAS_DOS = [
  "comun",
  "plataforma",
  "usuarios",
  "contactos",
  "conversaciones",
  "agentes",
  "canales",
  "base_de_conocimiento",
  "sucursales",
  "agenda",
  "stock",
  "tareas",
  "cupones_y_qr",
  "automatizaciones",
  "oportunidades",
  "campos_personalizados",
  "agente_interno",
  "ingesta",
  "dashboard_atencion",
];

const SOLO_COMPLETA = [
  "procesos_de_venta",
  "cotizaciones",
  "pagos",
  "entregas",
  "empresas",
  "dashboard_comercial",
  "financiacion",
  "permutas",
];

export const MODULOS_COMPLETA: string[] = [...EN_LAS_DOS, ...SOLO_COMPLETA];
export const MODULOS_ESENCIAL: string[] = [...EN_LAS_DOS];

/** Los campos de edición de `me` para una automotora de esa edición. */
export function edicionDeMe(
  edition: "COMPLETA" | "ESENCIAL",
): Pick<MeResponse, "edition" | "modulos"> {
  return { edition, modulos: edition === "ESENCIAL" ? MODULOS_ESENCIAL : MODULOS_COMPLETA };
}
