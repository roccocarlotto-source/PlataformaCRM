import { Prisma, type ImportBatch } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { findActiveContactCustomFieldDefinitions } from "../repositories/contactCustomFieldDefinition.repository";
import {
  guardarPlanes,
  leerTandaDeFilas,
  transicionarLote,
} from "../repositories/importacion.repository";
import { FILAS_POR_TANDA } from "../repositories/ingestionEvent.repository";
import { findDefaultPhoneCountryCode } from "../repositories/organization.repository";
import {
  claveDeNombreDeEmpresa,
  clavesDeContacto,
  clavesDeEmpresa,
  planearContacto,
  planearEmpresa,
  tipoDePlan,
  traducirFilaDeContacto,
  traducirFilaDeEmpresa,
  type CambioPlaneado,
  type CandidatoDeContacto,
  type CandidatoDeEmpresa,
  type ReferenciasResueltas,
  type TipoDePlan,
} from "../utils/importacionMapeo";
import type { FilaCruda } from "../utils/spreadsheet";
import { aDefinicionDeCampo } from "./contactCustomFieldDefinition.service";
import { ajustesDelLote } from "./importacionPromocion.service";
import { ResolutorDeImportacion, type IdentificadoPor } from "./importacionResolutor";

// ---------------------------------------------------------------------------
// LA VISTA PREVIA (docs/importacion-de-datos.md §8.1, pasos 5 y 6): para cada
// fila del lote, qué se va a crear, qué se va a actualizar, qué choca y qué
// falla, y por qué. Corre en el worker de lotes (workers/importBatchWorker.ts),
// no en el request: 10.000 filas no se analizan dentro de un HTTP (§5).
//
// No escribe nada de negocio: solo el `plan` de cada fila y, al terminar, el
// resumen en counters.analisis. Lee por tandas con el MISMO resolutor que la
// promoción, que recuerda lo que el lote "va a crear": dos filas del mismo
// archivo con la misma clave se pronostican como "crea" y "actualiza lo que
// crea aquella", que es lo que la promoción va a hacer.
// ---------------------------------------------------------------------------

export interface PlanDeFila {
  tipo: TipoDePlan;
  errores?: string[];
  advertencias: string[];
  existenteId?: string;
  identificadoPor?: IdentificadoPor;
  cambios?: CambioPlaneado[];
  empresaNueva?: string;
  // Otra fila del mismo archivo que ya trae este registro.
  mismaQueFila?: number;
}

export interface ResumenDelAnalisis {
  empresasNuevas: number;
  ejemplosDeEmpresasNuevas: string[];
  sinClave: number;
}

const MAX_EJEMPLOS = 20;
const PROVISORIO = "fila:";

interface Contexto {
  resolutor: ResolutorDeImportacion;
  resumen: ResumenDelAnalisis;
  empresasNuevas: Set<string>;
}

function recordarEmpresaNueva(ctx: Contexto, nombre: string): void {
  const clave = claveDeNombreDeEmpresa(nombre);
  if (ctx.empresasNuevas.has(clave)) return;
  ctx.empresasNuevas.add(clave);
  ctx.resumen.empresasNuevas++;
  if (ctx.resumen.ejemplosDeEmpresasNuevas.length < MAX_EJEMPLOS) {
    ctx.resumen.ejemplosDeEmpresasNuevas.push(nombre);
  }
}

// La fila del mismo lote que ya trajo alguna de estas claves.
function filaPrevia(
  ctx: Contexto,
  tipo: "CONTACT" | "COMPANY",
  claves: string[],
): number | undefined {
  for (const clave of claves) {
    const id = ctx.resolutor.vinculo(tipo, clave);
    if (id?.startsWith(PROVISORIO)) return Number(id.slice(PROVISORIO.length));
  }
  return undefined;
}

function planDeContacto(
  ctx: Contexto,
  c: CandidatoDeContacto,
  rowNumber: number,
  crearEmpresas: boolean,
  advertencias: string[],
): PlanDeFila {
  const { resolutor } = ctx;
  const refs: ReferenciasResueltas = {};
  if (c.ownerEmail !== undefined) {
    refs.ownerId = resolutor.usuario(c.ownerEmail);
    if (refs.ownerId === null) {
      advertencias.push(
        `El vendedor «${c.ownerEmail}» no es un usuario activo de la organización: queda sin asignar`,
      );
    }
  }
  if (c.vehicleRef !== undefined) {
    refs.vehicleOfInterestId = resolutor.vehiculo(c.vehicleRef);
    if (refs.vehicleOfInterestId === null) {
      advertencias.push(`No hay una unidad del stock con el código o la patente «${c.vehicleRef}»`);
    }
  }
  let empresaNueva: string | undefined;
  if (c.companyName !== undefined) {
    refs.companyId = resolutor.empresaPorNombreDeContacto(c.companyName);
    if (refs.companyId === null) {
      if (crearEmpresas) {
        empresaNueva = c.companyName;
        recordarEmpresaNueva(ctx, c.companyName);
        // Para el plan, una empresa nueva es "un valor": completa o difiere.
        refs.companyId = `${PROVISORIO}empresa`;
      } else {
        advertencias.push(`La empresa «${c.companyName}» no existe: el contacto queda sin empresa`);
      }
    }
  }

  const claves = clavesDeContacto(c);
  const encontrado = resolutor.contactoDe(c);
  if (encontrado) {
    const cambios = planearContacto(c, encontrado.existente, refs).map((cambio) => {
      if (cambio.accion !== "completar") return cambio;
      if (
        cambio.campo === "email" &&
        resolutor.emailDeOtro(String(cambio.entrante), encontrado.existente.id)
      ) {
        return {
          ...cambio,
          accion: "difiere_bloqueado" as const,
          motivo: "ese email ya es de otro contacto",
        };
      }
      if (
        cambio.campo === "phone" &&
        resolutor.telefonoDeOtro(String(cambio.entrante), encontrado.existente.id)
      ) {
        return {
          ...cambio,
          accion: "difiere_bloqueado" as const,
          motivo: "ese teléfono ya es de otro contacto",
        };
      }
      return cambio;
    });
    return {
      tipo: tipoDePlan(cambios),
      advertencias,
      existenteId: encontrado.existente.id,
      identificadoPor: encontrado.identificadoPor,
      cambios,
      empresaNueva,
    };
  }

  const previa = filaPrevia(ctx, "CONTACT", claves);
  if (previa !== undefined) {
    advertencias.push(
      `La fila ${String(previa)} del archivo ya trae este contacto: esta fila actualiza lo que crea aquella`,
    );
    return { tipo: "UPDATE", advertencias, mismaQueFila: previa, empresaNueva };
  }
  if (claves.length === 0) {
    ctx.resumen.sinClave++;
    advertencias.push(
      "Sin id del origen, email ni teléfono: volver a subir el archivo lo duplicaría",
    );
  }
  for (const clave of claves)
    resolutor.recordarVinculo("CONTACT", clave, `${PROVISORIO}${String(rowNumber)}`);
  return { tipo: "CREATE", advertencias, empresaNueva };
}

function planDeEmpresa(
  ctx: Contexto,
  c: CandidatoDeEmpresa,
  rowNumber: number,
  advertencias: string[],
): PlanDeFila {
  const { resolutor } = ctx;
  const refs: Pick<ReferenciasResueltas, "ownerId"> = {};
  if (c.ownerEmail !== undefined) {
    refs.ownerId = resolutor.usuario(c.ownerEmail);
    if (refs.ownerId === null) {
      advertencias.push(
        `El responsable «${c.ownerEmail}» no es un usuario activo de la organización: queda sin asignar`,
      );
    }
  }
  const encontrada = resolutor.empresaDe(c);
  if (encontrada) {
    const cambios = planearEmpresa(c, encontrada.existente, refs);
    return {
      tipo: tipoDePlan(cambios),
      advertencias,
      existenteId: encontrada.existente.id,
      identificadoPor: encontrada.identificadoPor,
      cambios,
    };
  }
  const claves = clavesDeEmpresa(c);
  const previa = filaPrevia(ctx, "COMPANY", claves);
  if (previa !== undefined) {
    advertencias.push(
      `La fila ${String(previa)} del archivo ya trae esta empresa: esta fila actualiza lo que crea aquella`,
    );
    return { tipo: "UPDATE", advertencias, mismaQueFila: previa };
  }
  for (const clave of claves)
    resolutor.recordarVinculo("COMPANY", clave, `${PROVISORIO}${String(rowNumber)}`);
  return { tipo: "CREATE", advertencias };
}

// Analiza el lote entero, en la transacción del worker que lo tiene tomado.
export async function analizarLote(lote: ImportBatch, db: Db): Promise<ResumenDelAnalisis> {
  const ajustes = ajustesDelLote(lote.config);
  if (!ajustes) throw new Error(`analizarLote: el lote ${lote.id} no tiene ajustes`);
  if (lote.entityType !== "CONTACT" && lote.entityType !== "COMPANY") {
    throw new Error(`analizarLote: el tipo ${lote.entityType} todavía no se analiza`);
  }
  const definiciones =
    lote.entityType === "CONTACT"
      ? (await findActiveContactCustomFieldDefinitions(lote.organizationId, db)).map(
          aDefinicionDeCampo,
        )
      : [];
  const codigoDePais = await findDefaultPhoneCountryCode(lote.organizationId, db);
  const ctx: Contexto = {
    resolutor: new ResolutorDeImportacion(lote.organizationId, lote.sourceId, db),
    resumen: { empresasNuevas: 0, ejemplosDeEmpresasNuevas: [], sinClave: 0 },
    empresasNuevas: new Set(),
  };

  let desde = 0;
  for (;;) {
    const tanda = await leerTandaDeFilas(lote.organizationId, lote.id, desde, FILAS_POR_TANDA, db);
    if (tanda.length === 0) break;
    desde = tanda[tanda.length - 1].rowNumber ?? desde + tanda.length;

    const planes: { id: string; plan: PlanDeFila }[] = [];
    if (lote.entityType === "CONTACT") {
      const traducidas = tanda.map((f) =>
        traducirFilaDeContacto(f.rawPayload as FilaCruda, ajustes, definiciones, codigoDePais),
      );
      await ctx.resolutor.precargarContactos(
        traducidas.flatMap((t) => (t.ok ? [t.candidato] : [])),
      );
      tanda.forEach((f, i) => {
        const t = traducidas[i];
        planes.push({
          id: f.id,
          plan: t.ok
            ? planDeContacto(ctx, t.candidato, f.rowNumber ?? 0, ajustes.crearEmpresas, [
                ...t.advertencias,
              ])
            : { tipo: "FAIL", errores: t.errores, advertencias: t.advertencias },
        });
      });
    } else {
      const traducidas = tanda.map((f) =>
        traducirFilaDeEmpresa(f.rawPayload as FilaCruda, ajustes),
      );
      await ctx.resolutor.precargarEmpresas(traducidas.flatMap((t) => (t.ok ? [t.candidato] : [])));
      tanda.forEach((f, i) => {
        const t = traducidas[i];
        planes.push({
          id: f.id,
          plan: t.ok
            ? planDeEmpresa(ctx, t.candidato, f.rowNumber ?? 0, [...t.advertencias])
            : { tipo: "FAIL", errores: t.errores, advertencias: t.advertencias },
        });
      });
    }
    await guardarPlanes(lote.organizationId, planes, db);
  }

  const listo = await transicionarLote(
    lote.organizationId,
    lote.id,
    ["ANALYZING"],
    { status: "READY", counters: { analisis: ctx.resumen } as unknown as Prisma.InputJsonValue },
    db,
  );
  if (listo.count === 0) {
    // Lo tenemos tomado con FOR UPDATE: nadie pudo cambiarlo. Bug.
    throw new Error(
      `analizarLote: el lote ${lote.id} dejó de estar en ANALYZING mientras se analizaba`,
    );
  }
  return ctx.resumen;
}
