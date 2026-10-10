import { modulosDe } from "../config/ediciones";
import { prisma, type Db } from "../lib/prisma";
import type { AjustesDeImportacion } from "../utils/importacionMapeo";
import type { FilaCruda } from "../utils/spreadsheet";

// ---------------------------------------------------------------------------
// La importación y la edición de la organización DESTINO (docs/ediciones.md
// §2.2 y §10, paso G). La importación no pasa por el gate de módulos (la
// hace el platform admin sobre otra organización, en un worker), así que la
// regla vive acá:
//
//   - sin el módulo `empresas` (ESENCIAL), no se importan empresas: el lote
//     de empresas se rechaza al subirlo;
//   - en un lote de contactos, la columna mapeada a empresa se IGNORA, con
//     una advertencia por fila en la vista previa, y no se crea ni vincula
//     ninguna empresa aunque el lote tenga crearEmpresas.
//
// Lo decide modulosDe (edición y rubro), como el gate y /api/me.
// ---------------------------------------------------------------------------

export async function organizacionSinEmpresas(
  organizationId: string,
  db: Db = prisma,
): Promise<boolean> {
  const org = await db.organization.findFirst({
    where: { id: organizationId },
    select: { edition: true, industry: true },
  });
  return org !== null && !modulosDe(org.edition, org.industry).has("empresas");
}

/** Los ajustes del lote sin nada de empresas: sin la columna mapeada a
 *  companyName y sin crear empresas. El análisis y la promoción traducen las
 *  filas con estos ajustes, así que la empresa nunca llega al contacto. */
export function ajustesSinEmpresas(ajustes: AjustesDeImportacion): AjustesDeImportacion {
  return {
    ...ajustes,
    mapeo: Object.fromEntries(
      Object.entries(ajustes.mapeo).filter(([, destino]) => destino !== "companyName"),
    ),
    crearEmpresas: false,
  };
}

/** La advertencia de una fila cuya empresa se ignora, o null si la fila no
 *  trae empresa. Usa los ajustes ORIGINALES (con la columna mapeada). */
export function advertenciaDeEmpresaIgnorada(
  ajustes: AjustesDeImportacion,
  fila: FilaCruda,
): string | null {
  const columna = Object.entries(ajustes.mapeo).find(([, d]) => d === "companyName")?.[0];
  if (columna === undefined || !Object.hasOwn(fila, columna)) return null;
  const valor = fila[columna];
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  return `La organización no tiene empresas (edición Esencial): «${String(valor).trim()}» se ignora`;
}

export const MENSAJE_SIN_EMPRESAS =
  "Esta organización no tiene empresas (edición Esencial): no se pueden importar empresas.";
