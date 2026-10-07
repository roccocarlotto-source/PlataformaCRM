import { Prisma, type ImportBatch, type ImportEntityType } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findImportBatch, transicionarLote } from "../repositories/importacion.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// DESHACER UN LOTE (docs/importacion-de-datos.md §8.3, decisión 17).
//
//   - Lo CREADO por el lote se da de baja con soft delete: los registros de
//     external_record_links con created_by_batch_id = el lote. Sus vínculos se
//     borran, así volver a importar crea de nuevo.
//   - Lo ACTUALIZADO no se revierte: el CSV de cambios tiene el antes y el
//     después, para corregir a mano.
//   - Lo que YA TUVO USO PROPIO no se borra: se omite y se informa. "Uso
//     propio" es que alguna otra fila de la base lo referencie (una
//     conversación, una oportunidad, una actividad que no vino del lote, otro
//     contacto unido a este), o que ya esté dado de baja o unido a otro.
//
// QUÉ REFERENCIA A QUÉ SE LEE DEL CATÁLOGO DE POSTGRES, no de una lista
// escrita a mano: una tabla nueva que apunte a contacts cuenta como uso sin
// que nadie se acuerde de agregarla acá (mismo criterio que el test de
// FKS_A_CONTACTS de unir contactos, por el otro lado). Las únicas tablas que
// NO cuentan son las de NO_CUENTAN_COMO_USO, cada una con su motivo.
//
// En orden: historial, contactos, empresas, vehículos. Lo que se borra en un
// paso no cuenta como uso en el siguiente (una nota del lote no salva a su
// contacto), y lo que se omite sí (un contacto que se queda sostiene a su
// empresa).
//
// Corre en el worker de lotes (UNDOING -> UNDONE), en una transacción.
// ---------------------------------------------------------------------------

const TABLA: Record<ImportEntityType, string> = {
  ACTIVITY: "activities",
  CONTACT: "contacts",
  COMPANY: "companies",
  VEHICLE: "vehicles",
};

const ORDEN: ImportEntityType[] = ["ACTIVITY", "CONTACT", "COMPANY", "VEHICLE"];

// Tablas que referencian un registro importado sin que eso sea uso de una
// persona: el staging (es la fila que lo trajo), y lo que el sistema genera
// solo a partir del registro.
const NO_CUENTAN_COMO_USO = new Set([
  // La fila del lote que lo creó (promoted_contact_id).
  "ingestion_events",
  // La cola de fotos del stock importado (§6).
  "vehicle_photo_imports",
  // La entrada de la base de conocimiento que el sistema sincroniza sola
  // con cada vehículo (vehicleKnowledgeBaseSync).
  "knowledge_base_entries",
  // El registro de cambios de ficha que genera el propio alta del vehículo.
  "vehicle_change_logs",
  // Las fotos de un vehículo importado: las que bajó la importación son
  // parte del alta. (Se repasa con el stock, PR 7.)
  "vehicle_photos",
]);

// Un plazo además de la purga no hay (decisión 17); este es el de la purga de
// las filas del staging (docs/data-classification.md §5.1): pasado, el
// informe del lote ya no tiene sus filas.
export const DIAS_PARA_DESHACER = 90;

const MAX_OMITIDOS_EN_EL_INFORME = 200;

export interface Omitido {
  tipo: ImportEntityType;
  id: string;
  motivo: string;
}

export interface ResultadoDeDeshacer {
  borrados: Partial<Record<ImportEntityType, number>>;
  omitidos: Omitido[];
  totalOmitidos: number;
}

interface Referencia {
  tabla: string;
  columna: string;
}

// Las columnas de otras tablas (y de la misma) con FK a `tabla`, sin contar
// organization_id (las FKs son compuestas, C-3).
async function referenciasA(tabla: string, db: Db): Promise<Referencia[]> {
  const filas = await db.$queryRaw<{ tabla: string; columna: string }[]>`
    SELECT regexp_replace(c.conrelid::regclass::text, '^public\\.', '') AS tabla, a.attname AS columna
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = to_regclass(${`public.${tabla}`})
      AND a.attname <> 'organization_id'
  `;
  return filas.filter((f) => !NO_CUENTAN_COMO_USO.has(f.tabla));
}

function identificador(nombre: string): Prisma.Sql {
  // Solo nombres que vienen del catálogo o de TABLA: letras, dígitos y _.
  if (!/^[a-z_][a-z0-9_]*$/.test(nombre)) throw new Error(`identificador inválido: ${nombre}`);
  return Prisma.raw(`"${nombre}"`);
}

export async function deshacerLote(lote: ImportBatch, db: Db): Promise<ResultadoDeDeshacer> {
  const org = lote.organizationId;
  const vinculos = await db.externalRecordLink.findMany({
    where: { organizationId: org, createdByBatchId: lote.id },
    select: { entityType: true, entityId: true },
  });
  const creados = new Map<ImportEntityType, string[]>();
  for (const v of vinculos) {
    const lista = creados.get(v.entityType) ?? [];
    if (!lista.includes(v.entityId)) lista.push(v.entityId);
    creados.set(v.entityType, lista);
  }

  const borradosPorTabla = new Map<string, string[]>();
  const resultado: ResultadoDeDeshacer = { borrados: {}, omitidos: [], totalOmitidos: 0 };
  const omitir = (tipo: ImportEntityType, id: string, motivo: string) => {
    resultado.totalOmitidos++;
    if (resultado.omitidos.length < MAX_OMITIDOS_EN_EL_INFORME) {
      resultado.omitidos.push({ tipo, id, motivo });
    }
  };

  for (const tipo of ORDEN) {
    const ids = creados.get(tipo) ?? [];
    if (ids.length === 0) continue;
    const tabla = TABLA[tipo];
    const t = identificador(tabla);

    // Los que siguen vivos. Uno dado de baja (o unido a otro, que también lo
    // da de baja) ya no es de este lote para deshacer.
    const vivos = new Set(
      (
        await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM ${t}
          WHERE organization_id = ${org}::uuid AND id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
        `
      ).map((f) => f.id),
    );
    for (const id of ids) {
      if (!vivos.has(id)) omitir(tipo, id, "ya estaba dado de baja o unido a otro registro");
    }

    const usados = new Map<string, string>();
    for (const ref of await referenciasA(tabla, db)) {
      const excluir = borradosPorTabla.get(ref.tabla) ?? [];
      const filas = await db.$queryRaw<{ ref: string }[]>`
        SELECT DISTINCT ${identificador(ref.columna)}::text AS ref FROM ${identificador(ref.tabla)}
        WHERE organization_id = ${org}::uuid
          AND ${identificador(ref.columna)} = ANY(${[...vivos]}::uuid[])
          AND NOT (id = ANY(${excluir}::uuid[]))
      `;
      for (const f of filas) if (!usados.has(f.ref)) usados.set(f.ref, ref.tabla);
    }
    for (const [id, porTabla] of usados) {
      omitir(tipo, id, `ya tiene uso propio en el CRM (${porTabla})`);
    }

    const aBorrar = [...vivos].filter((id) => !usados.has(id));
    if (aBorrar.length > 0) {
      await db.$executeRaw`
        UPDATE ${t} SET deleted_at = now(), updated_at = now()
        WHERE organization_id = ${org}::uuid AND id = ANY(${aBorrar}::uuid[]) AND deleted_at IS NULL
      `;
      await db.externalRecordLink.deleteMany({
        where: { organizationId: org, entityType: tipo, entityId: { in: aBorrar } },
      });
    }
    borradosPorTabla.set(tabla, aBorrar);
    resultado.borrados[tipo] = aBorrar.length;
  }

  const previos =
    lote.counters !== null && typeof lote.counters === "object" && !Array.isArray(lote.counters)
      ? lote.counters
      : {};
  const hecho = await transicionarLote(
    org,
    lote.id,
    ["UNDOING"],
    {
      status: "UNDONE",
      undoneAt: new Date(),
      counters: { ...previos, deshacer: resultado } as unknown as Prisma.InputJsonValue,
    },
    db,
  );
  if (hecho.count === 0) {
    throw new Error(
      `deshacerLote: el lote ${lote.id} dejó de estar en UNDOING mientras se deshacía`,
    );
  }
  return resultado;
}

// POST .../imports/:batchId/undo: lo pide el admin; lo hace el worker.
export async function pedirDeshacer(organizationId: string, batchId: string, userId: string) {
  const lote = await findImportBatch(organizationId, batchId);
  if (!lote) throw new AppError("Importación no encontrada", 404);
  if (lote.status !== "DONE") {
    throw new AppError("Solo se deshace una importación terminada", 409);
  }
  const limite = Date.now() - DIAS_PARA_DESHACER * 24 * 60 * 60 * 1000;
  if (lote.finishedAt && lote.finishedAt.getTime() < limite) {
    throw new AppError(
      `Pasaron más de ${DIAS_PARA_DESHACER} días: las filas de esta importación ya se purgaron`,
      409,
    );
  }
  const r = await transicionarLote(
    organizationId,
    batchId,
    ["DONE"],
    { status: "UNDOING", undoneByUserId: userId, errorMessage: null },
    prisma,
  );
  if (r.count === 0) throw new AppError("Solo se deshace una importación terminada", 409);
  return findImportBatch(organizationId, batchId);
}
