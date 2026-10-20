import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { OrganizationIndustry } from "@prisma/client";
import {
  parsearSecciones,
  seccionesVisibles,
  type Guia,
  type Seccion,
} from "../compartido/guia/guia";
import { MODULOS_ACTIVABLES } from "../config/ediciones";
import type { RoleName } from "../types/auth";

// ---------------------------------------------------------------------------
// La guía de uso (docs/guia-de-uso/) del lado del backend, para el asistente
// "¿Cómo se hace?" (docs-privados/asistente-de-ayuda-diseno.md, local). Qué
// bloques ve cada quien lo decide src/compartido/guia/guia.ts, el MISMO código
// que usa la pantalla Ayuda del frontend: el asistente nunca explica algo que
// esa persona no ve en Ayuda.
//
// Los markdown se leen del disco UNA vez, en el primer pedido: son parte del
// deploy (el Dockerfile copia docs/guia-de-uso/ junto a dist/). La ruta sale
// de este archivo y no del cwd: src/services/ en desarrollo y en los tests,
// dist/services/ en producción, y las dos están a dos niveles de docs/.
// ---------------------------------------------------------------------------

const CARPETA = path.join(__dirname, "..", "..", "docs", "guia-de-uso");
// El mismo patrón que el import.meta.glob del frontend: excluye al README.
const ARCHIVO_DE_SECCION = /^\d\d-[a-z0-9-]+\.md$/;

function leerCarpeta(carpeta: string): Record<string, string> {
  const archivos: Record<string, string> = {};
  for (const nombre of readdirSync(carpeta)) {
    if (!ARCHIVO_DE_SECCION.test(nombre)) continue;
    archivos[nombre] = readFileSync(path.join(carpeta, nombre), "utf8");
  }
  return archivos;
}

let guia: Guia | null = null;

/** Las dos guías, leídas una vez. */
export function guiaDeUso(): Guia {
  guia ??= {
    raiz: parsearSecciones(leerCarpeta(CARPETA)),
    clinica: parsearSecciones(leerCarpeta(path.join(CARPETA, "clinicas"))),
  };
  return guia;
}

export interface LectorDeLaGuia {
  industry: OrganizationIndustry;
  /** `modulosDe(edition, industry, activados)`: lo mismo que /api/me. */
  modulos: ReadonlySet<string>;
  role: RoleName;
  isPlatformAdmin: boolean;
}

/** Las secciones que ve esa persona. Para el asistente, los bloques de
 *  administrador quedan como un aviso de una línea (conAvisosDeAdmin). */
export function guiaVisible(
  lector: LectorDeLaGuia,
  opciones: { conAvisosDeAdmin?: boolean } = {},
): Seccion[] {
  return seccionesVisibles(
    guiaDeUso(),
    {
      esPlatformAdmin: lector.isPlatformAdmin,
      esAdmin: lector.role === "ADMIN",
      esClinica: lector.industry === "CLINICA",
      tiene: (modulo) => lector.modulos.has(modulo),
      modulosActivables: MODULOS_ACTIVABLES as ReadonlySet<string>,
    },
    opciones,
  );
}
