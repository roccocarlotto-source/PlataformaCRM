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
  aDolares,
  claveDeActividad,
  clavesDeVehiculo,
  cuerpoDeActividad,
  planearVehiculo,
  traducirFilaDeVehiculo,
  type CandidatoDeVehiculo,
  traducirFilaDeActividad,
  traducirFilaDeContacto,
  traducirFilaDeEmpresa,
  type AjustesDeImportacion,
  type CambioPlaneado,
  type CandidatoDeActividad,
  type CandidatoDeContacto,
  type CandidatoDeEmpresa,
  type ContactoExistente,
  type Politica,
  type ReferenciasResueltas,
} from "../utils/importacionMapeo";
import type { FilaCruda } from "../utils/spreadsheet";
import { ResolutorDeImportacion } from "./importacionResolutor";
import {
  FALTA_COTIZACION,
  FALTA_MONEDA_LOCAL,
  monedaLocalDe,
  type MonedaLocal,
} from "./importacionMoneda";
import {
  createVehicleEnTransaccion,
  updateVehicleEnTransaccion,
  type UpdateVehicleInput,
} from "./vehicle.service";
import { AppError } from "../utils/AppError";

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
  entityId: string | null;
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
// Stock de vehículos (§5.4)
// ---------------------------------------------------------------------------

// El costo y el precio mínimo en dólares (decisión 8). Exportada para el
// análisis, que muestra la misma conversión en la vista previa.
export function montosEnDolares(
  c: CandidatoDeVehiculo,
  moneda: MonedaLocal,
): { ok: true; valor: { costo?: number; minimo?: number } } | { ok: false; error: string } {
  const valor: { costo?: number; minimo?: number } = {};
  for (const [campo, monto] of [
    ["costo", c.costo],
    ["minimo", c.minimo],
  ] as const) {
    if (!monto) continue;
    if (monto.moneda === "USD") {
      valor[campo] = monto.monto;
      continue;
    }
    if (!moneda.codigo) return { ok: false, error: FALTA_MONEDA_LOCAL };
    if (!moneda.cotizacion) return { ok: false, error: FALTA_COTIZACION };
    valor[campo] = aDolares(monto.monto, moneda.cotizacion.rate);
  }
  return { ok: true, valor };
}

// De los cambios que se aplican, los datos del PATCH de vehicle.service.
const CAMPOS_DE_VEHICULO: Record<string, keyof UpdateVehicleInput> = {
  make: "make",
  model: "model",
  trim: "trim",
  year: "year",
  mileage: "mileage",
  condition: "condition",
  priceListUsd: "priceListUsd",
  priceListLocal: "priceListLocal",
  acquisitionCostUsd: "acquisitionCostUsd",
  minAcceptablePriceUsd: "minAcceptablePriceUsd",
  status: "status",
  exteriorColor: "exteriorColor",
  fuelType: "fuelType",
  transmission: "transmission",
  licensePlate: "licensePlate",
  vin: "vin",
};

async function escribirVehiculo(
  evento: EventoReclamado,
  loteId: string,
  c: CandidatoDeVehiculo,
  montos: { costo?: number; minimo?: number },
  ajustes: AjustesDeImportacion,
  politica: Politica,
  resolutor: ResolutorDeImportacion,
  notas: PromotionNote[],
  db: Db,
): Promise<ResultadoDeEscritura> {
  const stock = ajustes.stock as NonNullable<AjustesDeImportacion["stock"]>;
  const encontrado = resolutor.vehiculoDe(c);

  if (c.vendidaEnOrigen && !stock.importarVendidas) {
    // Decisión 12: vendidas en el origen, omitidas salvo la casilla.
    notas.push({
      tipo: "ignorado",
      campo: "status",
      entrante: "SOLD",
      motivo: "vendida en el origen: se omite (el lote no importa vendidas)",
    });
    return {
      entityId: encontrado?.existente.id ?? null,
      contactId: null,
      outcome: "SKIPPED",
      changes: [],
      notas,
    };
  }

  if (encontrado) {
    const existente = encontrado.existente;
    if (politica === "SKIP") {
      await vincularVehiculo(evento, c, existente.id, null, db);
      return { entityId: existente.id, contactId: null, outcome: "SKIPPED", changes: [], notas };
    }
    const cambios = planearVehiculo(c, existente, montos, encontrado.identificadoPor);
    const aplicar = cambiosAAplicar(cambios, politica);
    notas.push(...notasDeConflicto(cambios, aplicar));
    if (aplicar.length > 0) {
      const data = Object.fromEntries(
        aplicar.map((cambio) => [CAMPOS_DE_VEHICULO[cambio.campo], cambio.entrante]),
      ) as UpdateVehicleInput;
      // El historial de la ficha a nombre del responsable elegido.
      await updateVehicleEnTransaccion(
        evento.organizationId,
        stock.responsableId,
        existente.id,
        data,
        db,
      );
    }
    await vincularVehiculo(evento, c, existente.id, null, db);
    return {
      entityId: existente.id,
      contactId: null,
      outcome: aplicar.length > 0 ? "UPDATED" : "UNCHANGED",
      changes: aplicar.map((cambio) => ({
        campo: cambio.campo,
        antes: cambio.actual,
        despues: cambio.entrante,
      })),
      notas,
    };
  }

  const creado = await createVehicleEnTransaccion(
    evento.organizationId,
    {
      make: c.make,
      model: c.model,
      trim: c.trim ?? null,
      year: c.year,
      condition: c.condition,
      mileage: c.mileage ?? null,
      priceListUsd: c.priceListUsd ?? null,
      priceListLocal: c.priceListLocal ?? null,
      acquisitionCostUsd: montos.costo ?? null,
      minAcceptablePriceUsd: montos.minimo ?? null,
      status: c.status ?? "AVAILABLE",
      exteriorColor: c.exteriorColor ?? null,
      fuelType: c.fuelType ?? null,
      transmission: c.transmission ?? null,
      licensePlate: c.licensePlate ?? null,
      vin: c.vin ?? null,
      branchId: stock.branchId,
      // Decisión 9: el código del sistema anterior queda a la vista en la
      // ficha; nuestro STK-… sigue siendo el principal.
      internalNotes: c.stockCode ? `Código anterior: ${c.stockCode}` : null,
    },
    db,
  );
  await vincularVehiculo(evento, c, creado.id, loteId, db);
  return { entityId: creado.id, contactId: null, outcome: "CREATED", changes: [], notas };
}

async function vincularVehiculo(
  evento: EventoReclamado,
  c: CandidatoDeVehiculo,
  entityId: string,
  creadoPor: string | null,
  db: Db,
): Promise<void> {
  for (const externalKey of clavesDeVehiculo(c)) {
    await guardarVinculo(
      {
        organizationId: evento.organizationId,
        sourceId: evento.sourceId,
        entityType: "VEHICLE",
        externalKey,
        entityId,
        createdByBatchId: creadoPor,
      },
      db,
    );
  }
}

// ---------------------------------------------------------------------------
// Historial (§5.3, decisiones 5, 7, 23 y 25)
// ---------------------------------------------------------------------------

// Un día del calendario como instante: el mediodía UTC cae en el mismo día en
// toda América y en Europa, así la fecha no se corre al mostrarla.
export function mediodiaUtc(dia: string): Date {
  return new Date(`${dia}T12:00:00.000Z`);
}

async function escribirActividad(
  evento: EventoReclamado,
  loteId: string,
  c: CandidatoDeActividad,
  contactoId: string,
  ajustes: AjustesDeImportacion,
  politica: Politica,
  resolutor: ResolutorDeImportacion,
  notas: PromotionNote[],
  db: Db,
): Promise<ResultadoDeEscritura> {
  const historial = ajustes.historial as NonNullable<AjustesDeImportacion["historial"]>;
  const clave = claveDeActividad(c);
  const body = cuerpoDeActividad(c);
  const existente = resolutor.actividadDe(c);
  if (existente) {
    // Lo ya importado no se toca, salvo que se pida pisar: entonces el asunto
    // y el texto se actualizan con lo del archivo.
    if (politica !== "OVERWRITE") {
      return {
        entityId: existente,
        contactId: contactoId,
        outcome: politica === "SKIP" ? "SKIPPED" : "UNCHANGED",
        changes: [],
        notas,
      };
    }
    const antes = await db.activity.findUniqueOrThrow({
      where: { id: existente },
      select: { subject: true, body: true },
    });
    const changes = [
      ...(antes.subject !== c.subject
        ? [{ campo: "subject", antes: antes.subject, despues: c.subject }]
        : []),
      ...(antes.body !== body ? [{ campo: "body", antes: antes.body, despues: body }] : []),
    ];
    if (changes.length === 0) {
      return {
        entityId: existente,
        contactId: contactoId,
        outcome: "UNCHANGED",
        changes: [],
        notas,
      };
    }
    await db.activity.update({ where: { id: existente }, data: { subject: c.subject, body } });
    return { entityId: existente, contactId: contactoId, outcome: "UPDATED", changes, notas };
  }

  const occurredAt = c.occurredAt ? mediodiaUtc(c.occurredAt) : new Date();
  let assigneeId: string | null = null;
  let dueDate: Date | null = null;
  let completedAt: Date | null = null;
  if (c.type === "TASK") {
    dueDate = c.dueDate ? mediodiaUtc(c.dueDate) : c.occurredAt ? occurredAt : null;
    // Hecha: completada con su fecha original Y confirmada (decisiones 7 y
    // 25). Sin hacer: abierta, y vencida si la fecha ya pasó, asignada al
    // responsable del archivo o al autor elegido.
    if (c.done) completedAt = dueDate ?? occurredAt;
    if (c.assigneeEmail !== undefined) {
      assigneeId = resolutor.usuario(c.assigneeEmail);
      if (assigneeId === null) {
        notas.push({
          tipo: "ignorado",
          campo: "assigneeEmail",
          entrante: c.assigneeEmail,
          motivo: "no es un usuario activo de la organización: la tarea quedó asignada al autor",
        });
      }
    }
    assigneeId ??= historial.autorId;
  }
  const creada = await db.activity.create({
    data: {
      organizationId: evento.organizationId,
      type: c.type,
      authorId: historial.autorId,
      assigneeId,
      contactId: contactoId,
      subject: c.subject.slice(0, 255),
      body,
      occurredAt,
      dueDate,
      completedAt,
      confirmedAt: completedAt,
      confirmedById: completedAt ? historial.autorId : null,
    },
    select: { id: true },
  });
  await guardarVinculo(
    {
      organizationId: evento.organizationId,
      sourceId: evento.sourceId,
      entityType: "ACTIVITY",
      externalKey: clave,
      entityId: creada.id,
      createdByBatchId: loteId,
    },
    db,
  );
  return { entityId: creada.id, contactId: contactoId, outcome: "CREATED", changes: [], notas };
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
  } else if (lote.entityType === "VEHICLE") {
    const moneda = await monedaLocalDe(evento.organizationId, db);
    const traducida = traducirFilaDeVehiculo(fila, ajustes, moneda.codigo);
    if (!traducida.ok) return fallar(evento, traducida.errores.join("; "), db);
    const montos = montosEnDolares(traducida.candidato, moneda);
    if (!montos.ok) return fallar(evento, montos.error, db);
    await resolutor.precargarVehiculosDelLote([traducida.candidato]);
    try {
      resultado = await escribirVehiculo(
        evento,
        lote.id,
        traducida.candidato,
        montos.valor,
        ajustes,
        politica,
        resolutor,
        notas,
        db,
      );
    } catch (err) {
      // Las reglas de vehicle.service (patente o VIN de otra unidad,
      // sucursal) son un dato malo de ESTA fila: se marca y el lote sigue.
      // Corren antes de escribir, así que la transacción sigue sana.
      if (err instanceof AppError && err.statusCode < 500) return fallar(evento, err.message, db);
      throw err;
    }
  } else if (lote.entityType === "ACTIVITY") {
    const traducida = traducirFilaDeActividad(fila, ajustes, evento.codigoDePais);
    if (!traducida.ok) return fallar(evento, traducida.errores.join("; "), db);
    await resolutor.precargarActividades([traducida.candidato]);
    const contactoId = resolutor.contactoDeActividad(traducida.candidato);
    if (!contactoId) {
      return fallar(
        evento,
        "No se encontró el contacto: importá los contactos antes que el historial",
        db,
      );
    }
    resultado = await escribirActividad(
      evento,
      lote.id,
      traducida.candidato,
      contactoId,
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
