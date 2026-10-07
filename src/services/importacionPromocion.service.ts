import { Prisma, type ImportRowDecision } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { aDefinicionDeCampo } from "./contactCustomFieldDefinition.service";
import { appendLeadNotes } from "./contact.service";
import { findActiveContactCustomFieldDefinitions } from "../repositories/contactCustomFieldDefinition.repository";
import { guardarVinculo, marcarFilaPromovida } from "../repositories/importacion.repository";
import { markEventFailed, type EventoReclamado } from "../repositories/ingestionEvent.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import type { PromotionNote } from "../types/promotion";
import {
  cambiosAAplicar,
  claveDeNombreDeEmpresa,
  clavesDeContacto,
  clavesDeEmpresa,
  planearContacto,
  planearEmpresa,
  traducirFilaDeContacto,
  traducirFilaDeEmpresa,
  type AjustesDeImportacion,
  type CambioPlaneado,
  type CandidatoDeContacto,
  type CandidatoDeEmpresa,
  type ContactoExistente,
  type Politica,
  type ReferenciasResueltas,
} from "../utils/importacionMapeo";
import type { FilaCruda } from "../utils/spreadsheet";
import { ResolutorDeImportacion } from "./importacionResolutor";

// ---------------------------------------------------------------------------
// Promoción de UNA fila del asistente de importación (docs/importacion-de-
// datos.md §8). La llama promoverEvento cuando el evento pertenece a un lote
// de import_batches, dentro de la misma transacción que tiene reclamada la
// fila: promover y marcar la fila son atómicos, igual que en la ingesta.
//
// BAJO EL LOCK DE LA ORGANIZACIÓN, siempre: buscar por vínculo, email o
// teléfono y después crear tiene la misma carrera que en la ingesta (F5), con
// un WhatsApp que entra a la vez o con otra fila del mismo lote.
//
// La vista previa (importacionAnalisis.service.ts) es un pronóstico: acá se
// vuelve a calcular contra el estado real, con el mismo núcleo
// (utils/importacionMapeo.ts) y el mismo resolutor.
// ---------------------------------------------------------------------------

export type ResultadoDeFila =
  | { estado: "PROCESSED"; contactId: string | null; notas: PromotionNote[] }
  | { estado: "FAILED"; errorMessage: string };

// Una fila mala se marca FAILED y el lote sigue (§5).
async function fallar(evento: EventoReclamado, motivo: string, db: Db): Promise<ResultadoDeFila> {
  const marcado = await markEventFailed(evento.id, evento.organizationId, motivo, db);
  exigirTransicion(marcado.count, evento);
  return { estado: "FAILED", errorMessage: motivo };
}

// Mismo invariante que exigirTransicion de promotion.service.ts (E-1).
function exigirTransicion(count: number, evento: EventoReclamado): void {
  if (count === 0) {
    throw new Error(
      `promoverFilaDelAsistente: la fila ${evento.id} ya no estaba en PENDING al marcarla — se revierte la transacción (E-1)`,
    );
  }
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

// Los cambios que no se aplicaron quedan como nota de conflicto: "nunca
// sobrescribir en silencio" (§4) vale también para lo que se conserva.
function notasDeConflicto(
  cambios: readonly CambioPlaneado[],
  aplicados: readonly CambioPlaneado[],
): PromotionNote[] {
  return cambios
    .filter(
      (c) => (c.accion === "difiere" || c.accion === "difiere_bloqueado") && !aplicados.includes(c),
    )
    .map((c) => ({
      tipo: "conflicto",
      campo: c.campo,
      crm: texto(c.actual),
      entrante: texto(c.entrante),
    }));
}

interface ResultadoDeEscritura {
  entityId: string;
  contactId: string | null;
  outcome: "CREATED" | "UPDATED" | "UNCHANGED" | "SKIPPED";
  changes: { campo: string; antes: unknown; despues: unknown }[];
  notas: PromotionNote[];
}

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

async function resolverEmpresaDelContacto(
  evento: EventoReclamado,
  loteId: string,
  c: CandidatoDeContacto,
  ajustes: AjustesDeImportacion,
  resolutor: ResolutorDeImportacion,
  notas: PromotionNote[],
  db: Db,
): Promise<string | null | undefined> {
  if (c.companyName === undefined) return undefined;
  const existente = resolutor.empresaPorNombreDeContacto(c.companyName);
  if (existente) return existente;
  if (!ajustes.crearEmpresas) {
    notas.push({
      tipo: "ignorado",
      campo: "companyName",
      entrante: c.companyName,
      motivo: "la empresa no existe y el lote no crea empresas: el contacto quedó sin empresa",
    });
    return null;
  }
  const empresa = await db.company.create({
    data: { organizationId: evento.organizationId, name: c.companyName },
    select: { id: true },
  });
  await guardarVinculo(
    {
      organizationId: evento.organizationId,
      sourceId: evento.sourceId,
      entityType: "COMPANY",
      externalKey: claveDeNombreDeEmpresa(c.companyName),
      entityId: empresa.id,
      createdByBatchId: loteId,
    },
    db,
  );
  return empresa.id;
}

function referenciasDelContacto(
  c: CandidatoDeContacto,
  resolutor: ResolutorDeImportacion,
  notas: PromotionNote[],
): Omit<ReferenciasResueltas, "companyId"> {
  const refs: Omit<ReferenciasResueltas, "companyId"> = {};
  if (c.ownerEmail !== undefined) {
    refs.ownerId = resolutor.usuario(c.ownerEmail);
    if (refs.ownerId === null) {
      notas.push({
        tipo: "ignorado",
        campo: "ownerEmail",
        entrante: c.ownerEmail,
        motivo: "no es un usuario activo de la organización: el contacto quedó sin vendedor",
      });
    }
  }
  if (c.vehicleRef !== undefined) {
    refs.vehicleOfInterestId = resolutor.vehiculo(c.vehicleRef);
    if (refs.vehicleOfInterestId === null) {
      notas.push({
        tipo: "ignorado",
        campo: "vehicleRef",
        entrante: c.vehicleRef,
        motivo: "no hay una unidad del stock con ese código o patente",
      });
    }
  }
  return refs;
}

// El email o el teléfono que habría que COMPLETAR pero ya son de otro
// contacto: no se escriben (la base no deja repetir el email, F5 no deja
// repetir el teléfono) y quedan para revisión.
function bloquearDatosDeOtro(
  cambios: CambioPlaneado[],
  contactoId: string,
  resolutor: ResolutorDeImportacion,
): CambioPlaneado[] {
  return cambios.map((cambio) => {
    if (cambio.accion !== "completar") return cambio;
    if (cambio.campo === "email" && resolutor.emailDeOtro(String(cambio.entrante), contactoId)) {
      return { ...cambio, accion: "difiere_bloqueado", motivo: "ese email ya es de otro contacto" };
    }
    if (cambio.campo === "phone" && resolutor.telefonoDeOtro(String(cambio.entrante), contactoId)) {
      return {
        ...cambio,
        accion: "difiere_bloqueado",
        motivo: "ese teléfono ya es de otro contacto",
      };
    }
    return cambio;
  });
}

function datosDeActualizacion(
  aplicar: readonly CambioPlaneado[],
  existente: ContactoExistente,
): Prisma.ContactUncheckedUpdateInput {
  const data: Prisma.ContactUncheckedUpdateInput = {};
  let customFields: Record<string, unknown> | undefined;
  for (const cambio of aplicar) {
    const key = cambio.campo.startsWith("custom:") ? cambio.campo.slice("custom:".length) : null;
    if (key !== null) {
      customFields = { ...(customFields ?? existente.customFields), [key]: cambio.entrante };
      continue;
    }
    switch (cambio.campo) {
      case "notes":
        data.leadNotes = appendLeadNotes(existente.leadNotes, String(cambio.entrante));
        break;
      case "customerSince":
        data.customerSince = new Date(`${String(cambio.entrante)}T00:00:00.000Z`);
        break;
      case "vehicleOfInterestId":
        data.vehicleOfInterestId = cambio.entrante as string;
        data.vehicleOfInterestSetBy = "HUMAN";
        break;
      default:
        (data as Record<string, unknown>)[cambio.campo] = cambio.entrante;
    }
  }
  if (customFields !== undefined) data.customFields = customFields as Prisma.InputJsonValue;
  return data;
}

async function vincular(
  evento: EventoReclamado,
  tipo: "CONTACT" | "COMPANY",
  claves: readonly string[],
  entityId: string,
  creadoPor: string | null,
  db: Db,
): Promise<void> {
  for (const externalKey of claves) {
    await guardarVinculo(
      {
        organizationId: evento.organizationId,
        sourceId: evento.sourceId,
        entityType: tipo,
        externalKey,
        entityId,
        createdByBatchId: creadoPor,
      },
      db,
    );
  }
}

async function escribirContacto(
  evento: EventoReclamado,
  loteId: string,
  c: CandidatoDeContacto,
  ajustes: AjustesDeImportacion,
  politica: Politica,
  resolutor: ResolutorDeImportacion,
  notas: PromotionNote[],
  db: Db,
): Promise<ResultadoDeEscritura> {
  const refs: ReferenciasResueltas = referenciasDelContacto(c, resolutor, notas);
  const encontrado = resolutor.contactoDe(c);

  if (encontrado) {
    const existente = encontrado.existente;
    await vincular(evento, "CONTACT", clavesDeContacto(c), existente.id, null, db);
    if (politica === "SKIP") {
      return {
        entityId: existente.id,
        contactId: existente.id,
        outcome: "SKIPPED",
        changes: [],
        notas,
      };
    }
    // Una empresa que no existe se crea solo si se va a usar: si el contacto ya
    // tiene otra y no se pisa, crearla dejaría una empresa huérfana.
    const empresaYaEsta =
      c.companyName === undefined ? undefined : resolutor.empresaPorNombreDeContacto(c.companyName);
    if (empresaYaEsta === null && existente.companyId !== null && politica !== "OVERWRITE") {
      notas.push({
        tipo: "conflicto",
        campo: "companyName",
        crm: existente.companyId,
        entrante: c.companyName ?? "",
      });
    } else {
      refs.companyId = await resolverEmpresaDelContacto(
        evento,
        loteId,
        c,
        ajustes,
        resolutor,
        notas,
        db,
      );
    }
    const cambios = bloquearDatosDeOtro(
      planearContacto(c, existente, refs),
      existente.id,
      resolutor,
    );
    const aplicar = cambiosAAplicar(cambios, politica);
    notas.push(...notasDeConflicto(cambios, aplicar));
    if (aplicar.length === 0) {
      return {
        entityId: existente.id,
        contactId: existente.id,
        outcome: "UNCHANGED",
        changes: [],
        notas,
      };
    }
    await db.contact.update({
      where: { id: existente.id },
      data: datosDeActualizacion(aplicar, existente),
    });
    return {
      entityId: existente.id,
      contactId: existente.id,
      outcome: "UPDATED",
      changes: aplicar.map((cambio) => ({
        campo: cambio.campo,
        antes: cambio.campo === "notes" ? existente.leadNotes : cambio.actual,
        despues: cambio.entrante,
      })),
      notas,
    };
  }

  // Nuevo: la etapa del archivo tal cual, CHURNED incluido (decisión 24).
  const lifecycleStage = c.lifecycleStage;
  refs.companyId = await resolverEmpresaDelContacto(
    evento,
    loteId,
    c,
    ajustes,
    resolutor,
    notas,
    db,
  );
  if (clavesDeContacto(c).length === 0) {
    notas.push({
      tipo: "revision_manual",
      motivo:
        "sin id del origen, email ni teléfono: no se pudo deduplicar, y volver a subir el archivo lo duplicaría",
    });
  }
  const creado = await db.contact.create({
    data: {
      organizationId: evento.organizationId,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email ?? null,
      phone: c.phone ?? null,
      jobTitle: c.jobTitle ?? null,
      source: (c.source ?? evento.sourceName).slice(0, 100),
      ...(lifecycleStage ? { lifecycleStage } : {}),
      customerSince: c.customerSince ? new Date(`${c.customerSince}T00:00:00.000Z`) : null,
      leadNotes: c.notas ? appendLeadNotes(null, c.notas) : null,
      customFields:
        Object.keys(c.customFields).length > 0
          ? (c.customFields as Prisma.InputJsonValue)
          : Prisma.DbNull,
      ownerId: refs.ownerId ?? null,
      companyId: refs.companyId ?? null,
      vehicleOfInterestId: refs.vehicleOfInterestId ?? null,
      vehicleOfInterestSetBy: refs.vehicleOfInterestId ? "HUMAN" : null,
      importedAt: new Date(),
    },
    select: { id: true },
  });
  await vincular(evento, "CONTACT", clavesDeContacto(c), creado.id, loteId, db);
  return { entityId: creado.id, contactId: creado.id, outcome: "CREATED", changes: [], notas };
}

// ---------------------------------------------------------------------------
// Empresas
// ---------------------------------------------------------------------------

async function escribirEmpresa(
  evento: EventoReclamado,
  loteId: string,
  c: CandidatoDeEmpresa,
  politica: Politica,
  resolutor: ResolutorDeImportacion,
  notas: PromotionNote[],
  db: Db,
): Promise<ResultadoDeEscritura> {
  const refs: Pick<ReferenciasResueltas, "ownerId"> = {};
  if (c.ownerEmail !== undefined) {
    refs.ownerId = resolutor.usuario(c.ownerEmail);
    if (refs.ownerId === null) {
      notas.push({
        tipo: "ignorado",
        campo: "ownerEmail",
        entrante: c.ownerEmail,
        motivo: "no es un usuario activo de la organización: la empresa quedó sin responsable",
      });
    }
  }
  const encontrada = resolutor.empresaDe(c);
  if (encontrada) {
    const existente = encontrada.existente;
    await vincular(evento, "COMPANY", clavesDeEmpresa(c), existente.id, null, db);
    if (politica === "SKIP") {
      return { entityId: existente.id, contactId: null, outcome: "SKIPPED", changes: [], notas };
    }
    const cambios = planearEmpresa(c, existente, refs);
    const aplicar = cambiosAAplicar(cambios, politica);
    notas.push(...notasDeConflicto(cambios, aplicar));
    if (aplicar.length === 0) {
      return { entityId: existente.id, contactId: null, outcome: "UNCHANGED", changes: [], notas };
    }
    await db.company.update({
      where: { id: existente.id },
      data: Object.fromEntries(aplicar.map((cambio) => [cambio.campo, cambio.entrante])),
    });
    return {
      entityId: existente.id,
      contactId: null,
      outcome: "UPDATED",
      changes: aplicar.map((cambio) => ({
        campo: cambio.campo,
        antes: cambio.actual,
        despues: cambio.entrante,
      })),
      notas,
    };
  }
  const creada = await db.company.create({
    data: {
      organizationId: evento.organizationId,
      name: c.name,
      domain: c.domain ?? null,
      industry: c.industry ?? null,
      phone: c.phone ?? null,
      city: c.city ?? null,
      country: c.country ?? null,
      ownerId: refs.ownerId ?? null,
    },
    select: { id: true },
  });
  await vincular(evento, "COMPANY", clavesDeEmpresa(c), creada.id, loteId, db);
  return { entityId: creada.id, contactId: null, outcome: "CREATED", changes: [], notas };
}

// ---------------------------------------------------------------------------

export function ajustesDelLote(config: unknown): AjustesDeImportacion | null {
  const ajustes = (config as { ajustes?: AjustesDeImportacion | null } | null)?.ajustes;
  return ajustes ?? null;
}

export async function promoverFilaDelAsistente(
  evento: EventoReclamado,
  db: Db,
): Promise<ResultadoDeFila> {
  const lote = evento.lote;
  if (!lote)
    throw new Error(
      `promoverFilaDelAsistente: el evento ${evento.id} no es de un lote del asistente`,
    );
  const ajustes = ajustesDelLote(lote.config);
  if (!ajustes) {
    // Un lote confirmado siempre tiene ajustes (confirmar exige READY, y
    // READY sale de analizar con ajustes). Si no los tiene, es un bug.
    throw new Error(`promoverFilaDelAsistente: el lote ${lote.id} no tiene ajustes`);
  }
  if (lote.entityType !== "CONTACT" && lote.entityType !== "COMPANY") {
    return fallar(
      evento,
      `Este tipo de dato (${lote.entityType}) todavía no se puede importar`,
      db,
    );
  }

  const fila = evento.rawPayload as FilaCruda;
  const politica: Politica = (lote.decision as ImportRowDecision | null) ?? ajustes.duplicados;
  const notas: PromotionNote[] = [];

  await lockOrganizationForUpdate(evento.organizationId, db);
  const resolutor = new ResolutorDeImportacion(evento.organizationId, evento.sourceId, db);

  let resultado: ResultadoDeEscritura;
  if (lote.entityType === "CONTACT") {
    const definiciones = (
      await findActiveContactCustomFieldDefinitions(evento.organizationId, db)
    ).map(aDefinicionDeCampo);
    const traducida = traducirFilaDeContacto(fila, ajustes, definiciones, evento.codigoDePais);
    if (!traducida.ok) return fallar(evento, traducida.errores.join("; "), db);
    await resolutor.precargarContactos([traducida.candidato]);
    resultado = await escribirContacto(
      evento,
      lote.id,
      traducida.candidato,
      ajustes,
      politica,
      resolutor,
      notas,
      db,
    );
  } else {
    const traducida = traducirFilaDeEmpresa(fila, ajustes);
    if (!traducida.ok) return fallar(evento, traducida.errores.join("; "), db);
    await resolutor.precargarEmpresas([traducida.candidato]);
    resultado = await escribirEmpresa(
      evento,
      lote.id,
      traducida.candidato,
      politica,
      resolutor,
      notas,
      db,
    );
  }

  const marcado = await marcarFilaPromovida(
    evento.id,
    evento.organizationId,
    {
      outcome: resultado.outcome,
      entityType: lote.entityType,
      entityId: resultado.entityId,
      contactId: resultado.contactId,
      changes: resultado.changes,
      notas: resultado.notas,
    },
    db,
  );
  exigirTransicion(marcado.count, evento);
  return { estado: "PROCESSED", contactId: resultado.contactId, notas: resultado.notas };
}
