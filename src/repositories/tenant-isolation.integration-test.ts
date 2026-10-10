import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { findRoleByName } from "./role.repository";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";

import { updateCompany, softDeleteCompany } from "./company.repository";
import { updateContact, softDeleteContact } from "./contact.repository";
import { updatePipeline, softDeletePipeline } from "./pipeline.repository";
import { updateStage, softDeleteStage, reindexStages } from "./stage.repository";
import { updateOpportunity, softDeleteOpportunity } from "./opportunity.repository";
import { updateActivity, softDeleteActivity } from "./activity.repository";
import { updateUser, softDeleteUser } from "./user.repository";
import { revokeInvitationConditional } from "./invitation.repository";
import { updateSource, softDeleteSource } from "./source.repository";
import { revokeApiKeyConditional, revokeApiKeysBySource } from "./apiKey.repository";
import { updateBranch, softDeleteBranch } from "./branch.repository";
import { updateResource, softDeleteResource } from "./resource.repository";
import { updateServiceType, softDeleteServiceType } from "./serviceType.repository";
import { findWorkingHoursByResource, replaceWorkingHours } from "./workingHours.repository";
import { setGoogleEventId, markBookingCancelled } from "./booking.repository";
import {
  markConnectionRevoked,
  markConnectionError,
  setConnectionChannel,
  clearConnectionChannel,
  setConnectionSyncToken,
  findCanalDeLaSucursal,
  reconciliarCanalesConLasColumnasViejas,
} from "./googleCalendarConnection.repository";
import {
  markOutboxEventProcessed,
  rescheduleOutboxEvent,
  markOutboxEventDeadLetter,
} from "./outboxEvent.repository";
import {
  retryIngestionEventConditional,
  markEventFailed,
  anonymizeIngestionEventsOfContact,
} from "./ingestionEvent.repository";
import {
  buscarVinculos,
  decidirFilas,
  findImportBatch,
  listarFilasDelLote,
  resumenDeFilas,
  transicionarLote,
} from "./importacion.repository";
import { marcarFoto, resumenDeFotos } from "./vehiclePhotoImport.repository";
import {
  borrarSync,
  findSync,
  listarSyncs,
  pausarSync,
  reanudarSync,
  registrarCorridaFallida,
  registrarCorridaOk,
  soltarSync,
} from "./importSync.repository";
import {
  expireDueQuotes,
  supersedeOpenQuotes,
  transitionQuoteConditional,
  updateDraftQuoteContent,
} from "./quote.repository";
import { confirmDeliveryConditional, updatePendingDelivery } from "./delivery.repository";
import { deletePayment, updatePayment } from "./payment.repository";
import { MARCADOR_DE_DATO_BORRADO } from "./contact.repository";
import type { NotaIgnorado, PromotionNote } from "../types/promotion";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  softDeleteAgent as softDeleteAgentRepo,
  updateAgent as updateAgentRepo,
} from "./agent.repository";
import {
  revokeEmbedTokenConditional,
  revokeEmbedTokensByAgent,
  touchEmbedTokenLastUsed,
} from "./agentEmbedToken.repository";
import {
  softDeleteAutomation,
  updateAutomation,
  upsertAutomationExecution,
} from "./automation.repository";
import { replaceBusinessHours } from "./branchBusinessHours.repository";
import {
  closeConversation as closeConversationRepo,
  returnConversationToAgent,
  takeOverConversation,
  transferConversationToHuman,
  updateConversation as updateConversationRepo,
} from "./conversation.repository";
import { applyDeliveryStatusByExternalId, markMessageDelivery } from "./message.repository";
import {
  cancelPendingInboundJobsOfConversation,
  markAgentInboundJobDone,
  markAgentInboundJobFailed,
  markAgentInboundJobsCovered,
  setAgentInboundJobResponse,
} from "./agentInboundJob.repository";
import { reassignContactChannelIdentity } from "./contactChannelIdentity.repository";
import {
  markMetaConnectionError,
  markMetaConnectionRevoked,
} from "./metaPageConnection.repository";
import { softDeleteQrCode, updateQrCode } from "./qrCode.repository";
import {
  markQrFollowUpCancelled,
  markQrFollowUpFailed,
  markQrFollowUpSent,
} from "./qrFollowUp.repository";
import { consumirDiscountVoucher } from "./discountVoucher.repository";
import {
  markDiscountVoucherFollowUpCancelled,
  markDiscountVoucherFollowUpFailed,
  markDiscountVoucherFollowUpSent,
} from "./discountVoucherFollowUp.repository";
import {
  markInquiryFollowUpCancelled,
  markInquiryFollowUpFailed,
  markInquiryFollowUpSent,
} from "./inquiryFollowUp.repository";
import {
  setWhatsappTemplateMetaId,
  setWhatsappTemplateStatus,
  softDeleteWhatsappTemplate,
} from "./whatsappTemplate.repository";
import {
  softDeleteVehicle as softDeleteVehicleRepo,
  updateVehicle as updateVehicleRepo,
} from "./vehicle.repository";
import { clearCover, deletePhoto, updatePhoto } from "./vehiclePhoto.repository";
import {
  softDeleteKnowledgeBaseEntry,
  updateKnowledgeBaseEntry,
  writeSyncedKnowledgeBaseEntry,
} from "./knowledgeBaseEntry.repository";
import { setInternalAgentModel } from "./internalAgent.repository";
import { purgeLlmTurnUsages, sumarUsoPorOrganizacion } from "./llmTurnUsage.repository";
import {
  softDeleteContactCustomFieldDefinition,
  updateContactCustomFieldDefinition,
} from "./contactCustomFieldDefinition.repository";
import {
  CONFIGURACION_DE_CLINICA_POR_DEFECTO,
  CONFIGURACION_DE_SEDE_POR_DEFECTO,
  crearConfiguracionDeSede,
  guardarTerminoDelContacto,
  leerConfiguracionDeClinica,
  leerConfiguracionDeSede,
} from "../clinicas/repositories/clinicSettings.repository";
import {
  contarTurnosPorRecurso,
  esProfesionalDeLaPrestacion,
  profesionalesDeLasPrestaciones,
  reemplazarProfesionales,
} from "../clinicas/repositories/serviceTypeResource.repository";
import {
  copiarSedesDeLaInvitacion,
  guardarSedesDeLaInvitacion,
  recepcionDeLaSede,
  reemplazarSedesDelUsuario,
  sedesVigentesDeLaOrganizacion,
  sedesVigentesPorInvitacion,
  sedesVigentesPorUsuario,
} from "../clinicas/repositories/sedesDeUsuarios.repository";
import {
  borrarBloqueo,
  crearBloqueo,
  findBloqueoById,
  findBloqueosQueSeSuperponen,
  guardarSobreturnosDelProfesional,
} from "../clinicas/repositories/bloqueos.repository";

// Test de integración: prueba el contrato de aislamiento multi-tenant de las
// 16 escrituras tenant-scoped incluidas en M4, directamente contra Postgres
// real (Supabase, ver README) — sin mocks de Prisma. No pasa por la capa de
// service ni por Express: la garantía bajo prueba vive en el repository
// (WHERE efectivo de la escritura), no en el pre-check del service.
//
// Propiedad probada por cada una de las 15 escrituras id + organizationId:
// existe un registro de Organization B; se la invoca con el id de ese
// registro pero el organizationId de Organization A; la escritura no debe
// afectar ninguna fila (count === 0) y el registro de B debe permanecer
// exactamente igual tras una relectura independiente.
//
// reindexStages es la 16.ª y tiene una frontera distinta (pipelineId, no
// organizationId — ver stage.repository.ts): el test intenta reindexar un
// Stage ajeno (de otro pipeline, de otra organización) junto con Stages
// legítimos de Pipeline B, y prueba que ni el Stage ajeno ni los legítimos
// cambian — la función debe abortar la transacción completa antes de tocar
// nada, no solo "saltear" el id ajeno.
//
// SEGUNDA PROPIEDAD, agregada con la capa de ingesta: que la BASE rechace una
// referencia cross-tenant. Antes de C-3 (migración 20260821140200) no tenía
// sentido escribir estos tests, porque la base no las rechazaba: las FKs eran
// de columna simple y Postgres solo verificaba que el UUID referenciado
// existiera, no que perteneciera a la misma organización. El caso no es
// hipotético — la primera corrida de la suite completa en CI encontró un
// fixture que llevaba semanas creando una referencia cross-tenant real
// (invitation.service.integration-test.ts:291).
//
// La diferencia con las 16 de arriba importa: allá la garantía es el WHERE de
// la escritura, la prueba la ejecuta el repository y el éxito es count === 0.
// Acá la garantía es la constraint, la escritura va directo por Prisma sin
// pasar por ninguna capa nuestra, y el éxito es una EXCEPCIÓN. Es
// deliberadamente un test del contrato de la base, no de nuestro código: la
// promoción masiva staging -> Contact (ítem 4 del documento de ingesta) no
// pasa por los services, así que las FKs compuestas van a ser su única
// defensa.
//
// LOS TESTS DE ESCRITURA DIFERIDOS DEL ÍTEM 2, saldados en el ítem 3. Aquella
// vez no se escribieron porque los modelos nuevos no tenían repository, y un
// `prisma.source.updateMany({ where: { id, organizationId } })` no habría
// probado nada nuestro, solo que Prisma traduce un WHERE a SQL. Ahora Source y
// ApiKey sí tienen repository, así que sus 4 escrituras entran con el mismo
// patrón que las 16 originales.
//
// IngestionEvent SIGUE SIN ELLOS, y esta vez la razón es distinta: nada en el
// ítem 3 escribe eventos de ingesta, así que darle un repository ahora sería
// crear código muerto para poder testearlo. Sus escrituras nacen con el ítem 4
// —el worker y la promoción— y sus tests van con ellas.
//
// M-20 (docs-privados/auditoria-2026-08-29.md (local, no está en GitHub)) SALDÓ ESA DEUDA Y LA DEL MÓDULO DE
// AGENDA: las escrituras de Branch, Resource, ServiceType, WorkingHours,
// Booking, GoogleCalendarConnection, OutboxEvent y las tres nuevas de
// IngestionEvent (retry, markEventFailed, anonymize) ya filtraban por
// organizationId en su WHERE, pero solo tenían pruebas a nivel service (404
// cross-org), que prueban el pre-check y no el WHERE — la distinción que este
// archivo existe para hacer. Entran al final, con el mismo fixture y los
// mismos dos helpers. WorkingHours es el caso distinto de todos: ver sus dos
// tests.
//
// Un solo fixture (Organization A + Organization B con un registro real por
// entidad) se crea una vez en `before` y se reusa en las 49 pruebas: ninguna
// debería lograr mutar el estado de B si el aislamiento funciona, así que
// compartir el fixture es seguro y evita crear una identidad real de
// Supabase Auth por caso.

interface Fixture {
  orgA: { id: string };
  orgB: { id: string };
  userB: { id: string };
  companyB: { id: string };
  contactB: { id: string };
  pipelineB: { id: string };
  stageB1: { id: string };
  stageB2: { id: string };
  opportunityB: { id: string };
  activityB: { id: string };
  invitationB: { id: string };
  sourceB: { id: string };
  apiKeyB: { id: string };
  pipelineA: { id: string };
  stageA1: { id: string };
  contactA: { id: string };
  sourceA: { id: string };
  // M-20 — módulo de agenda, outbox y las escrituras nuevas de ingesta.
  branchB: { id: string };
  resourceB: { id: string };
  serviceTypeB: { id: string };
  bookingB: { id: string };
  gcalB: { id: string };
  outboxEventB: { id: string };
  ingestionEventBFailed: { id: string };
  ingestionEventBPending: { id: string };
  ingestionEventBProcessed: { id: string };
  // §39 — cotizaciones de la oportunidad de B: una DRAFT y una SENT ya
  // vencida (valid_until en el pasado), cada escritura condicional necesita
  // su estado de partida.
  quoteBDraft: { id: string };
  quoteBSentVencida: { id: string };
  // §40 — una entrega PENDING de la oportunidad de B: las dos escrituras
  // condicionales parten de ese estado.
  deliveryBPending: { id: string };
  // §43 — un pago de la oportunidad de B.
  paymentB: { id: string };
  authUserId: string;
}

// El valor reconocible dentro de la nota de promoción del evento PROCESSED de
// B: si anonymizeIngestionEventsOfContact lo tocara cross-tenant, aparecería
// reemplazado por MARCADOR_DE_DATO_BORRADO.
const ENTRANTE_RECONOCIBLE = "m20-lifecycle-de-org-b";

async function createRealAuthUser(label: string) {
  const email = `m4-test-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear usuario real de Supabase Auth (${label}): ${error?.message}`);
  }
  return { id: data.user.id, email };
}

let fx: Fixture;

before(async () => {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN. Abortando.");
  }

  const orgA = await prisma.organization.create({
    data: { name: `M4 org-a ${randomUUID()}`, slug: `m4-org-a-${Date.now()}` },
  });
  const orgB = await prisma.organization.create({
    data: { name: `M4 org-b ${randomUUID()}`, slug: `m4-org-b-${Date.now()}` },
  });

  const authUserB = await createRealAuthUser("org-b-owner");
  const userB = await prisma.user.create({
    data: {
      id: authUserB.id,
      organizationId: orgB.id,
      roleId: adminRole.id,
      email: authUserB.email,
      fullName: "M4 Org B Owner",
    },
  });

  const companyB = await prisma.company.create({
    data: { organizationId: orgB.id, ownerId: userB.id, name: "M4 Org B Company" },
  });

  const contactB = await prisma.contact.create({
    data: {
      organizationId: orgB.id,
      ownerId: userB.id,
      companyId: companyB.id,
      firstName: "M4",
      lastName: "Org B Contact",
    },
  });

  const pipelineB = await prisma.pipeline.create({
    data: { organizationId: orgB.id, name: `M4 Org B Pipeline ${randomUUID()}` },
  });

  const stageB1 = await prisma.stage.create({
    data: { organizationId: orgB.id, pipelineId: pipelineB.id, name: "B Stage 1", order: 1 },
  });
  const stageB2 = await prisma.stage.create({
    data: { organizationId: orgB.id, pipelineId: pipelineB.id, name: "B Stage 2", order: 2 },
  });

  const opportunityB = await prisma.opportunity.create({
    data: {
      organizationId: orgB.id,
      ownerId: userB.id,
      pipelineId: pipelineB.id,
      stageId: stageB1.id,
      companyId: companyB.id,
      title: "M4 Org B Opportunity",
    },
  });

  const activityB = await prisma.activity.create({
    data: {
      organizationId: orgB.id,
      authorId: userB.id,
      companyId: companyB.id,
      type: "NOTE",
      subject: "M4 Org B Activity",
    },
  });

  const invitationB = await prisma.invitation.create({
    data: {
      organizationId: orgB.id,
      email: `m4-invitee-${randomUUID()}@example.test`,
      roleId: adminRole.id,
      invitedById: userB.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const sourceB = await prisma.source.create({
    data: {
      organizationId: orgB.id,
      name: "M4 Org B Source",
      type: "WEBHOOK",
    },
  });

  const apiKeyB = await prisma.apiKey.create({
    data: {
      organizationId: orgB.id,
      sourceId: sourceB.id,
      keyHash: `m4-org-b-hash-${randomUUID()}`,
      keyPrefix: "crm_orgb01",
    },
  });

  // Pipeline/Stage de Organization A — usados solo por el test de
  // reindexStages, como el Stage "ajeno" que Pipeline B nunca debería poder
  // reindexar.
  const pipelineA = await prisma.pipeline.create({
    data: { organizationId: orgA.id, name: `M4 Org A Pipeline ${randomUUID()}` },
  });
  const stageA1 = await prisma.stage.create({
    data: { organizationId: orgA.id, pipelineId: pipelineA.id, name: "A Stage 1", order: 1 },
  });

  // Contact y Source de Organization A — los referentes LEGÍTIMOS de los
  // casos positivos de las pruebas de FK. Sin ellos, una escritura rechazada
  // no distinguiría "la constraint funcionó" de "la fila estaba mal armada
  // por otra razón".
  const contactA = await prisma.contact.create({
    data: {
      organizationId: orgA.id,
      firstName: "M4",
      lastName: "Org A Contact",
    },
  });

  const sourceA = await prisma.source.create({
    data: {
      organizationId: orgA.id,
      name: "M4 Org A Source",
      type: "WEBHOOK",
    },
  });

  // M-20 — el módulo de agenda de Organization B, completo: una reserva
  // exige sucursal, recurso, servicio y contacto reales (FKs compuestas).
  const branchB = await prisma.branch.create({
    data: {
      organizationId: orgB.id,
      name: "M4 Org B Branch",
      timezone: "America/Argentina/Buenos_Aires",
    },
  });
  const resourceB = await prisma.resource.create({
    data: {
      organizationId: orgB.id,
      branchId: branchB.id,
      name: "M4 Org B Resource",
      type: "PERSON",
    },
  });
  const serviceTypeB = await prisma.serviceType.create({
    data: {
      organizationId: orgB.id,
      branchId: branchB.id,
      resourceId: resourceB.id,
      name: "M4 Org B Service",
      durationMin: 30,
    },
  });
  await prisma.workingHours.create({
    data: {
      organizationId: orgB.id,
      resourceId: resourceB.id,
      weekday: "MONDAY",
      startMinute: 540,
      endMinute: 1020,
    },
  });
  const bookingB = await prisma.booking.create({
    data: {
      organizationId: orgB.id,
      branchId: branchB.id,
      resourceId: resourceB.id,
      serviceTypeId: serviceTypeB.id,
      contactId: contactB.id,
      startsAt: new Date("2026-09-07T12:00:00Z"),
      endsAt: new Date("2026-09-07T12:30:00Z"),
    },
  });
  // Con canal YA seteado: si no, "clearConnectionChannel no cambió nada"
  // sería cierto aunque la función no filtrara por organizationId.
  const gcalB = await prisma.googleCalendarConnection.create({
    data: {
      organizationId: orgB.id,
      branchId: branchB.id,
      refreshToken: "m4-org-b-refresh-token-cifrado",
      calendarId: "primary",
      status: "ACTIVE",
      channelId: randomUUID(),
      channelResourceId: "m4-org-b-resource",
      channelExpiration: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      syncToken: "m4-org-b-sync-token",
    },
  });
  // R7: la fila de GoogleCalendarChannel de esa conexión, copiada como lo hace
  // la migración 20261103120000 (la reconciliación es la misma copia).
  await reconciliarCanalesConLasColumnasViejas({ organizationId: orgB.id });
  // Directo por Prisma: emitOutboxEvent exige una transacción abierta a
  // propósito y no aporta nada acá.
  const outboxEventB = await prisma.outboxEvent.create({
    data: { organizationId: orgB.id, eventType: "m4.test", payload: { de: "org-b" } },
  });
  // Tres filas de ingesta de B, una por estado de partida: cada escritura
  // condicional necesita el suyo, y ningún test puede dejar el fixture mutado
  // para el que viene después.
  const ingestionEventBFailed = await prisma.ingestionEvent.create({
    data: {
      organizationId: orgB.id,
      sourceId: sourceB.id,
      rawPayload: { email: "failed@org-b.test" },
      status: "FAILED",
      errorMessage: "m4: fallo de org B",
    },
  });
  const ingestionEventBPending = await prisma.ingestionEvent.create({
    data: {
      organizationId: orgB.id,
      sourceId: sourceB.id,
      rawPayload: { email: "pending@org-b.test" },
      status: "PENDING",
    },
  });
  const notaIgnorado: NotaIgnorado = {
    tipo: "ignorado",
    campo: "lifecycleStage",
    entrante: ENTRANTE_RECONOCIBLE,
    motivo: "la ingesta no escribe lifecycleStage",
  };
  const ingestionEventBProcessed = await prisma.ingestionEvent.create({
    data: {
      organizationId: orgB.id,
      sourceId: sourceB.id,
      rawPayload: { email: "processed@org-b.test", lifecycleStage: ENTRANTE_RECONOCIBLE },
      status: "PROCESSED",
      promotedContactId: contactB.id,
      promotionNotes: [notaIgnorado] as unknown as Prisma.InputJsonValue,
    },
  });

  // §39 — directo por Prisma, como outboxEventB: createQuote del service
  // toma locks y supera la anterior, y acá solo hacen falta dos filas fijas.
  const quoteBDraft = await prisma.quote.create({
    data: {
      organizationId: orgB.id,
      opportunityId: opportunityB.id,
      createdById: userB.id,
      amount: 20_000,
      currency: "USD",
      status: "DRAFT",
    },
  });
  const quoteBSentVencida = await prisma.quote.create({
    data: {
      organizationId: orgB.id,
      opportunityId: opportunityB.id,
      createdById: userB.id,
      amount: 19_000,
      currency: "USD",
      status: "SENT",
      validUntil: new Date("2020-01-01T00:00:00.000Z"),
    },
  });

  // §40 — directo por Prisma, como las cotizaciones: la entrega nace sola al
  // ganar con unidad (opportunity.service.ts), y acá solo hace falta una fila
  // fija. Sin unidad: la columna es nullable y ninguna escritura la mira.
  const deliveryBPending = await prisma.delivery.create({
    data: {
      organizationId: orgB.id,
      opportunityId: opportunityB.id,
      checklist: [{ label: "Manual del vehículo", checked: false }],
    },
  });

  // §43 — directo por Prisma, como las entregas: solo hace falta una fila fija.
  const paymentB = await prisma.payment.create({
    data: {
      organizationId: orgB.id,
      opportunityId: opportunityB.id,
      amount: 5000,
      currency: "USD",
      method: "CASH",
      paidAt: new Date("2026-09-16T00:00:00.000Z"),
    },
  });

  fx = {
    orgA: { id: orgA.id },
    orgB: { id: orgB.id },
    userB: { id: userB.id },
    companyB: { id: companyB.id },
    contactB: { id: contactB.id },
    pipelineB: { id: pipelineB.id },
    stageB1: { id: stageB1.id },
    stageB2: { id: stageB2.id },
    opportunityB: { id: opportunityB.id },
    activityB: { id: activityB.id },
    invitationB: { id: invitationB.id },
    sourceB: { id: sourceB.id },
    apiKeyB: { id: apiKeyB.id },
    pipelineA: { id: pipelineA.id },
    stageA1: { id: stageA1.id },
    contactA: { id: contactA.id },
    sourceA: { id: sourceA.id },
    branchB: { id: branchB.id },
    resourceB: { id: resourceB.id },
    serviceTypeB: { id: serviceTypeB.id },
    bookingB: { id: bookingB.id },
    gcalB: { id: gcalB.id },
    outboxEventB: { id: outboxEventB.id },
    ingestionEventBFailed: { id: ingestionEventBFailed.id },
    ingestionEventBPending: { id: ingestionEventBPending.id },
    ingestionEventBProcessed: { id: ingestionEventBProcessed.id },
    quoteBDraft: { id: quoteBDraft.id },
    quoteBSentVencida: { id: quoteBSentVencida.id },
    deliveryBPending: { id: deliveryBPending.id },
    paymentB: { id: paymentB.id },
    authUserId: authUserB.id,
  };
});

after(async () => {
  if (!fx) return;
  const ambas = { in: [fx.orgA.id, fx.orgB.id] };

  // M-20 — el módulo de agenda, en orden de FKs: Booking depende de Branch,
  // Resource, ServiceType y Contact; WorkingHours y GoogleCalendarConnection
  // de Resource/Branch; ServiceType de Branch y Resource.
  await prisma.booking.deleteMany({ where: { organizationId: ambas } });
  // R6: los bloqueos cuelgan de Resource.
  await prisma.resourceTimeOff.deleteMany({ where: { organizationId: ambas } });
  // R20: las sedes de usuarios e invitaciones cuelgan de Branch, User e Invitation.
  await prisma.userBranch.deleteMany({ where: { organizationId: ambas } });
  await prisma.invitationBranch.deleteMany({ where: { organizationId: ambas } });
  // R5: los profesionales de una prestación cuelgan de ServiceType y Resource.
  await prisma.serviceTypeResource.deleteMany({ where: { organizationId: ambas } });
  await prisma.workingHours.deleteMany({ where: { organizationId: ambas } });
  await prisma.googleCalendarChannel.deleteMany({ where: { organizationId: ambas } });
  await prisma.googleCalendarConnection.deleteMany({ where: { organizationId: ambas } });
  await prisma.serviceType.deleteMany({ where: { organizationId: ambas } });
  await prisma.resource.deleteMany({ where: { organizationId: ambas } });
  await prisma.branch.deleteMany({ where: { organizationId: ambas } });
  await prisma.outboxEvent.deleteMany({ where: { organizationId: ambas } });

  // ingestion_events y api_keys primero: sus FKs a sources son RESTRICT, así
  // que Postgres rechaza borrar una Source que todavía tenga hijas.
  await prisma.ingestionEvent.deleteMany({ where: { organizationId: ambas } });
  await prisma.apiKey.deleteMany({ where: { organizationId: ambas } });
  await prisma.source.deleteMany({ where: { organizationId: ambas } });
  await prisma.invitation.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.activity.deleteMany({ where: { organizationId: fx.orgB.id } });
  // Las cotizaciones referencian la oportunidad (RESTRICT): van antes.
  await prisma.quote.deleteMany({ where: { organizationId: ambas } });
  await prisma.delivery.deleteMany({ where: { organizationId: ambas } });
  await prisma.payment.deleteMany({ where: { organizationId: ambas } });
  await prisma.opportunity.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.contact.deleteMany({ where: { organizationId: ambas } });
  await prisma.company.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.stage.deleteMany({
    where: { organizationId: { in: [fx.orgA.id, fx.orgB.id] } },
  });
  await prisma.pipeline.deleteMany({
    where: { organizationId: { in: [fx.orgA.id, fx.orgB.id] } },
  });
  await prisma.user.deleteMany({ where: { organizationId: fx.orgB.id } });
  await prisma.organization.deleteMany({
    where: { id: { in: [fx.orgA.id, fx.orgB.id] } },
  });
  await getSupabaseAdmin().auth.admin.deleteUser(fx.authUserId);
});

// Helper compartido por las 15 pruebas id + organizationId: lee el estado
// de B, ejecuta la escritura cross-tenant, y prueba que no tuvo efecto.
async function assertCrossTenantWriteNoOp<T>(
  read: () => Promise<T>,
  write: () => Promise<{ count: number }>,
  label: string,
) {
  const before = await read();
  const result = await write();
  assert.equal(result.count, 0, `${label}: no debe afectar ninguna fila`);
  const after = await read();
  assert.deepEqual(
    after,
    before,
    `${label}: el registro de Organization B debe permanecer intacto`,
  );
}

test("updateCompany: id de Organization B + organizationId de Organization A no modifica la Company", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.company.findUniqueOrThrow({ where: { id: fx.companyB.id } }),
    () => updateCompany(fx.companyB.id, fx.orgA.id, { name: "hijacked-by-org-a" }),
    "updateCompany",
  );
});

test("softDeleteCompany: id de Organization B + organizationId de Organization A no borra la Company", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.company.findUniqueOrThrow({ where: { id: fx.companyB.id } }),
    () => softDeleteCompany(fx.companyB.id, fx.orgA.id),
    "softDeleteCompany",
  );
});

test("updateContact: id de Organization B + organizationId de Organization A no modifica el Contact", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.contact.findUniqueOrThrow({ where: { id: fx.contactB.id } }),
    () => updateContact(fx.contactB.id, fx.orgA.id, { firstName: "hijacked" }),
    "updateContact",
  );
});

test("softDeleteContact: id de Organization B + organizationId de Organization A no borra el Contact", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.contact.findUniqueOrThrow({ where: { id: fx.contactB.id } }),
    () => softDeleteContact(fx.contactB.id, fx.orgA.id),
    "softDeleteContact",
  );
});

test("updatePipeline: id de Organization B + organizationId de Organization A no modifica el Pipeline", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.pipeline.findUniqueOrThrow({ where: { id: fx.pipelineB.id } }),
    () => updatePipeline(fx.pipelineB.id, fx.orgA.id, { name: "hijacked-pipeline" }),
    "updatePipeline",
  );
});

test("softDeletePipeline: id de Organization B + organizationId de Organization A no borra el Pipeline", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.pipeline.findUniqueOrThrow({ where: { id: fx.pipelineB.id } }),
    () => softDeletePipeline(fx.pipelineB.id, fx.orgA.id),
    "softDeletePipeline",
  );
});

test("updateStage: id de Organization B + organizationId de Organization A no modifica el Stage", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } }),
    () => updateStage(fx.stageB1.id, fx.orgA.id, { name: "hijacked-stage" }),
    "updateStage",
  );
});

test("softDeleteStage: id de Organization B + organizationId de Organization A no borra el Stage", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } }),
    () => softDeleteStage(fx.stageB1.id, fx.orgA.id),
    "softDeleteStage",
  );
});

test("updateOpportunity: id de Organization B + organizationId de Organization A no modifica la Opportunity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.opportunity.findUniqueOrThrow({ where: { id: fx.opportunityB.id } }),
    () => updateOpportunity(fx.opportunityB.id, fx.orgA.id, { title: "hijacked-opportunity" }),
    "updateOpportunity",
  );
});

test("softDeleteOpportunity: id de Organization B + organizationId de Organization A no borra la Opportunity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.opportunity.findUniqueOrThrow({ where: { id: fx.opportunityB.id } }),
    () => softDeleteOpportunity(fx.opportunityB.id, fx.orgA.id),
    "softDeleteOpportunity",
  );
});

test("updateActivity: id de Organization B + organizationId de Organization A no modifica la Activity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.activity.findUniqueOrThrow({ where: { id: fx.activityB.id } }),
    () => updateActivity(fx.activityB.id, fx.orgA.id, { subject: "hijacked-activity" }),
    "updateActivity",
  );
});

test("softDeleteActivity: id de Organization B + organizationId de Organization A no borra la Activity", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.activity.findUniqueOrThrow({ where: { id: fx.activityB.id } }),
    () => softDeleteActivity(fx.activityB.id, fx.orgA.id),
    "softDeleteActivity",
  );
});

test("updateUser: id de Organization B + organizationId de Organization A no modifica el User", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.user.findUniqueOrThrow({ where: { id: fx.userB.id } }),
    () => updateUser(fx.userB.id, fx.orgA.id, { isActive: false }),
    "updateUser",
  );
});

test("softDeleteUser: id de Organization B + organizationId de Organization A no borra el User", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.user.findUniqueOrThrow({ where: { id: fx.userB.id } }),
    () => softDeleteUser(fx.userB.id, fx.orgA.id),
    "softDeleteUser",
  );
});

test("revokeInvitationConditional: id de Organization B + organizationId de Organization A no revoca la Invitation", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.invitation.findUniqueOrThrow({ where: { id: fx.invitationB.id } }),
    () => revokeInvitationConditional(fx.invitationB.id, fx.orgA.id),
    "revokeInvitationConditional",
  );
});

test("reindexStages: no reindexa un Stage ajeno al pipeline (de otra organización) aunque el caller se lo pase por id, y aborta el reordenado completo", async () => {
  const stageABefore = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageA1.id } });
  const stageB1Before = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } });
  const stageB2Before = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB2.id } });

  // El caller (por bug, condición de carrera, o intento deliberado) arma un
  // array de reordenado para Pipeline B que incluye un Stage de Pipeline A
  // (Organization A). reindexStages debe rechazarlo — su propia escritura,
  // no el caller, es la garantía.
  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        reindexStages(fx.pipelineB.id, [fx.stageB1.id, fx.stageA1.id, fx.stageB2.id], tx),
      ),
    /no pertenece al pipeline/,
  );

  const stageAAfter = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageA1.id } });
  const stageB1After = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB1.id } });
  const stageB2After = await prisma.stage.findUniqueOrThrow({ where: { id: fx.stageB2.id } });

  assert.deepEqual(
    stageAAfter,
    stageABefore,
    "el Stage ajeno (otra organización, otro pipeline) no debe tocarse",
  );
  assert.deepEqual(
    stageB1After,
    stageB1Before,
    "la transacción debe abortar completa: ni los Stages legítimos de Pipeline B cambian",
  );
  assert.deepEqual(
    stageB2After,
    stageB2Before,
    "la transacción debe abortar completa: ni los Stages legítimos de Pipeline B cambian",
  );
});

// ---------------------------------------------------------------------------
// Las escrituras de la capa de ingesta (ítem 3), mismo patrón que las 16 de
// arriba: la garantía bajo prueba es el WHERE efectivo del repository.
// ---------------------------------------------------------------------------

test("updateSource: id de Organization B + organizationId de Organization A no modifica la Source", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.source.findUniqueOrThrow({ where: { id: fx.sourceB.id } }),
    () => updateSource(fx.sourceB.id, fx.orgA.id, { name: "hijacked-source" }),
    "updateSource",
  );
});

test("softDeleteSource: id de Organization B + organizationId de Organization A no borra la Source", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.source.findUniqueOrThrow({ where: { id: fx.sourceB.id } }),
    () => softDeleteSource(fx.sourceB.id, fx.orgA.id),
    "softDeleteSource",
  );
});

test("revokeApiKeyConditional: id de Organization B + organizationId de Organization A no revoca la ApiKey", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.apiKey.findUniqueOrThrow({ where: { id: fx.apiKeyB.id } }),
    () => revokeApiKeyConditional(fx.apiKeyB.id, fx.orgA.id),
    "revokeApiKeyConditional",
  );
});

// La escritura MASIVA, que es la que más caro sale si el aislamiento falla:
// una sola llamada podría matar todas las credenciales de una fuente ajena.
// Recibe el sourceId de B con el organizationId de A y no debe tocar nada.
test("revokeApiKeysBySource: sourceId de Organization B + organizationId de Organization A no revoca ninguna ApiKey", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.apiKey.findUniqueOrThrow({ where: { id: fx.apiKeyB.id } }),
    () => revokeApiKeysBySource(fx.sourceB.id, fx.orgA.id),
    "revokeApiKeysBySource",
  );
});

// ---------------------------------------------------------------------------
// Rechazo de referencias cross-tenant por la base — las FKs compuestas de C-3
// aplicadas a la capa de ingesta.
// ---------------------------------------------------------------------------

// La escritura debe fallar con P2003 (violación de FK). Si fallara con
// cualquier otro código —P2002, un NOT NULL, un enum inválido— el test estaría
// pasando por la razón equivocada, así que el predicado es exacto.
async function assertViolaFk(write: () => Promise<unknown>, label: string) {
  await assert.rejects(
    write,
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003",
    `${label}: la base debe rechazar la referencia cross-tenant con una violación de FK`,
  );
}

test("ApiKey de Organization A apuntando a una Source de Organization B: la base la rechaza", async () => {
  await assertViolaFk(
    () =>
      prisma.apiKey.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceB.id,
          keyHash: `cross-tenant-${randomUUID()}`,
          keyPrefix: "crm_xxxx",
        },
      }),
    "api_keys -> sources",
  );
});

test("ApiKey de Organization A apuntando a una Source de Organization A: entra bien", async () => {
  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      keyHash: `legitima-${randomUUID()}`,
      keyPrefix: "crm_ok01",
    },
  });

  assert.equal(apiKey.organizationId, fx.orgA.id);
  assert.equal(apiKey.sourceId, fx.sourceA.id);
});

test("IngestionEvent de Organization A apuntando a una Source de Organization B: la base lo rechaza", async () => {
  await assertViolaFk(
    () =>
      prisma.ingestionEvent.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceB.id,
          rawPayload: { email: "cross-tenant@example.test" },
        },
      }),
    "ingestion_events -> sources",
  );
});

test("IngestionEvent de Organization A con promotedContactId de Organization B: la base lo rechaza", async () => {
  await assertViolaFk(
    () =>
      prisma.ingestionEvent.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceA.id,
          rawPayload: { email: "promocion-cruzada@example.test" },
          status: "PROCESSED",
          promotedContactId: fx.contactB.id,
        },
      }),
    "ingestion_events -> contacts",
  );
});

test("IngestionEvent de Organization A con promotedContactId de Organization A: entra bien", async () => {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { email: "promocion-legitima@example.test" },
      status: "PROCESSED",
      promotedContactId: fx.contactA.id,
    },
  });

  assert.equal(evento.promotedContactId, fx.contactA.id);
});

// MATCH SIMPLE, no MATCH FULL: con organization_id NOT NULL y
// promoted_contact_id nullable, la FK no se valida mientras la columna
// nullable sea NULL. Es el estado de todo evento todavía no promovido — el
// caso normal, no el borde — así que conviene que esté probado y no supuesto.
test("IngestionEvent sin promotedContactId: la FK compuesta no se evalúa y el evento entra", async () => {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { email: "sin-promover@example.test" },
    },
  });

  assert.equal(evento.promotedContactId, null);
  assert.equal(evento.status, "PENDING");
});

// ---------------------------------------------------------------------------
// Idempotencia — el único parcial (source_id, external_id) WHERE external_id
// IS NOT NULL. No es aislamiento multi-tenant, pero es la otra garantía que
// esta etapa delega en la base en vez de en el código, y se prueba igual: por
// el contrato, no por la implementación.
// ---------------------------------------------------------------------------

test("dos IngestionEvent con el mismo (sourceId, externalId): la base rechaza el segundo", async () => {
  const externalId = `evt-${randomUUID()}`;

  await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      externalId,
      rawPayload: { intento: 1 },
    },
  });

  await assert.rejects(
    () =>
      prisma.ingestionEvent.create({
        data: {
          organizationId: fx.orgA.id,
          sourceId: fx.sourceA.id,
          externalId,
          rawPayload: { intento: 2 },
        },
      }),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
    "el reintento con el mismo externalId debe violar el único parcial",
  );
});

test("dos IngestionEvent con externalId nulo sobre la misma Source: entran los dos", async () => {
  const primero = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { fila: 1 },
    },
  });
  const segundo = await prisma.ingestionEvent.create({
    data: {
      organizationId: fx.orgA.id,
      sourceId: fx.sourceA.id,
      rawPayload: { fila: 2 },
    },
  });

  // El índice es PARCIAL a propósito: los contactos sin identificador externo
  // no se deduplican entre sí (sección 4 del documento de ingesta), se
  // promueven como nuevos y se marcan para revisión manual. Un único sin el
  // WHERE dejaría pasar exactamente una fila sin externalId por Source.
  assert.notEqual(primero.id, segundo.id);
});

// ---------------------------------------------------------------------------
// M-20 de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub) — el módulo de agenda, outbox y las
// escrituras nuevas de ingesta. Mismo patrón que las 20 de arriba: la
// garantía bajo prueba es el WHERE efectivo del repository, y el éxito es
// count === 0 con B intacta.
// ---------------------------------------------------------------------------

// Branch ---------------------------------------------------------------------

test("updateBranch: id de Organization B + organizationId de Organization A no modifica la Branch", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.branch.findUniqueOrThrow({ where: { id: fx.branchB.id } }),
    () => updateBranch(fx.branchB.id, fx.orgA.id, { name: "hijacked-branch" }),
    "updateBranch",
  );
});

test("softDeleteBranch: id de Organization B + organizationId de Organization A no borra la Branch", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.branch.findUniqueOrThrow({ where: { id: fx.branchB.id } }),
    () => softDeleteBranch(fx.branchB.id, fx.orgA.id),
    "softDeleteBranch",
  );
});

// Resource -------------------------------------------------------------------

test("updateResource: id de Organization B + organizationId de Organization A no modifica el Resource", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.resource.findUniqueOrThrow({ where: { id: fx.resourceB.id } }),
    () => updateResource(fx.resourceB.id, fx.orgA.id, { name: "hijacked-resource" }),
    "updateResource",
  );
});

test("softDeleteResource: id de Organization B + organizationId de Organization A no borra el Resource", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.resource.findUniqueOrThrow({ where: { id: fx.resourceB.id } }),
    () => softDeleteResource(fx.resourceB.id, fx.orgA.id),
    "softDeleteResource",
  );
});

// ServiceType ----------------------------------------------------------------

test("updateServiceType: id de Organization B + organizationId de Organization A no modifica el ServiceType", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.serviceType.findUniqueOrThrow({ where: { id: fx.serviceTypeB.id } }),
    () => updateServiceType(fx.serviceTypeB.id, fx.orgA.id, { name: "hijacked-service" }),
    "updateServiceType",
  );
});

test("softDeleteServiceType: id de Organization B + organizationId de Organization A no borra el ServiceType", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.serviceType.findUniqueOrThrow({ where: { id: fx.serviceTypeB.id } }),
    () => softDeleteServiceType(fx.serviceTypeB.id, fx.orgA.id),
    "softDeleteServiceType",
  );
});

// WorkingHours — EL CASO DISTINTO --------------------------------------------
//
// replaceWorkingHours no es un updateMany({ id, organizationId }): es un
// deleteMany({ resourceId, organizationId }) seguido, si hay franjas, de un
// createMany con esos mismos organizationId/resourceId, sin ningún findFirst
// que valide que el recurso es de esa organización. Lo que lo protege es la FK
// COMPUESTA WorkingHours -> Resource (organization_id, resource_id) ->
// (organization_id, id), la misma clase que impuso C-3. Eso da dos caminos
// según el contenido de `franjas`, y cada uno tiene su test.

test("replaceWorkingHours CON franjas: resourceId de Organization B + organizationId de Organization A — el deleteMany no borra nada y la FK compuesta rechaza el INSERT (P2003); el horario de B sigue igual", async () => {
  // Camino 1: hay filas que insertar. El deleteMany no encuentra nada (las
  // franjas reales de B tienen organization_id = orgB), y el createMany que
  // sigue intenta (organization_id = orgA, resource_id = resourceB): una
  // combinación que la FK compuesta no puede satisfacer.
  const antes = await findWorkingHoursByResource(fx.resourceB.id, fx.orgB.id);
  assert.equal(antes.length, 1, "el fixture tiene exactamente una franja real para resourceB");

  await assertViolaFk(
    () =>
      prisma.$transaction((tx) =>
        replaceWorkingHours(
          fx.resourceB.id,
          fx.orgA.id,
          [{ weekday: "TUESDAY", startMinute: 600, endMinute: 660 }],
          tx,
        ),
      ),
    "replaceWorkingHours con franjas",
  );

  // Leído con el organizationId REAL: la transacción abortó entera, el
  // deleteMany incluido, y el horario de B está exactamente como estaba.
  const despues = await findWorkingHoursByResource(fx.resourceB.id, fx.orgB.id);
  assert.deepEqual(despues, antes, "el horario de B debe permanecer intacto tras el rechazo");
});

test("replaceWorkingHours SIN franjas: resourceId de Organization B + organizationId de Organization A no tira y no toca el horario de B", async () => {
  // Camino 2: franjas vacías. El deleteMany tampoco borra nada, y como no hay
  // filas que insertar el createMany ni se ejecuta: la llamada termina sin
  // error y sin haber tocado nada — un no-op, no por una validación explícita
  // sino porque no queda ninguna escritura real con esos parámetros. Sin un
  // { count } que comparar, la propiedad se prueba por lectura antes/después,
  // como el test de reindexStages.
  const antes = await findWorkingHoursByResource(fx.resourceB.id, fx.orgB.id);
  assert.equal(antes.length, 1);

  const devuelto = await prisma.$transaction((tx) =>
    replaceWorkingHours(fx.resourceB.id, fx.orgA.id, [], tx),
  );
  assert.deepEqual(devuelto, [], "leído con el organizationId incorrecto, no ve ninguna franja");

  const despues = await findWorkingHoursByResource(fx.resourceB.id, fx.orgB.id);
  assert.deepEqual(despues, antes, "el horario de B debe permanecer intacto");
});

// Booking --------------------------------------------------------------------
// Las dos escrituras llevan status: "CONFIRMED" en el WHERE, como
// revokeInvitationConditional; el fixture está CONFIRMED, así que lo único
// que las frena es el organizationId.

test("setGoogleEventId: id de Organization B + organizationId de Organization A no escribe el googleEventId", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.booking.findUniqueOrThrow({ where: { id: fx.bookingB.id } }),
    () => setGoogleEventId(fx.bookingB.id, fx.orgA.id, "evt-hijacked-by-org-a"),
    "setGoogleEventId",
  );
});

test("markBookingCancelled: id de Organization B + organizationId de Organization A no cancela la reserva", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.booking.findUniqueOrThrow({ where: { id: fx.bookingB.id } }),
    () => markBookingCancelled(fx.bookingB.id, fx.orgA.id),
    "markBookingCancelled",
  );
});

// GoogleCalendarConnection ---------------------------------------------------
// La clave del WHERE acá es branchId, no id: se llama con la sucursal de B y
// la organización de A. La conexión del fixture tiene canal y syncToken
// seteados para que "no cambió nada" sea una afirmación real en las cinco.
//
// R7: el canal y el syncToken viven en GoogleCalendarChannel (y en espejo en
// la conexión). La lectura trae las dos filas, así "no cambió nada" vale para
// las dos tablas.

async function leerConexionB() {
  return {
    conexion: await prisma.googleCalendarConnection.findUniqueOrThrow({
      where: { id: fx.gcalB.id },
    }),
    canal: await prisma.googleCalendarChannel.findFirstOrThrow({
      where: { organizationId: fx.orgB.id, branchId: fx.branchB.id },
    }),
  };
}

test("GoogleCalendarChannel: el canal de B existe (copiado de la conexión) y A no lo ve", async () => {
  const { conexion, canal } = await leerConexionB();
  assert.equal(canal.channelId, conexion.channelId);
  assert.equal(canal.syncToken, conexion.syncToken);
  assert.equal(await findCanalDeLaSucursal(fx.branchB.id, fx.orgA.id), null);
});

test("reconciliarCanalesConLasColumnasViejas: acotada a A no toca el canal de B", async () => {
  const antes = await leerConexionB();
  await prisma.googleCalendarConnection.update({
    where: { id: fx.gcalB.id },
    data: { syncToken: "m4-org-b-sync-token-del-codigo-viejo" },
  });
  try {
    await reconciliarCanalesConLasColumnasViejas({ organizationId: fx.orgA.id });
    assert.deepEqual((await leerConexionB()).canal, antes.canal);
  } finally {
    await prisma.googleCalendarConnection.update({
      where: { id: fx.gcalB.id },
      data: { syncToken: antes.conexion.syncToken },
    });
  }
});

test("markConnectionRevoked: branchId de Organization B + organizationId de Organization A no revoca la conexión", async () => {
  await assertCrossTenantWriteNoOp(
    leerConexionB,
    () => markConnectionRevoked(fx.branchB.id, fx.orgA.id),
    "markConnectionRevoked",
  );
});

test("markConnectionError: branchId de Organization B + organizationId de Organization A no marca ERROR", async () => {
  await assertCrossTenantWriteNoOp(
    leerConexionB,
    () => markConnectionError(fx.branchB.id, fx.orgA.id, "hijacked: invalid_grant"),
    "markConnectionError",
  );
});

test("setConnectionChannel: branchId de Organization B + organizationId de Organization A no reemplaza el canal", async () => {
  await assertCrossTenantWriteNoOp(
    leerConexionB,
    () =>
      setConnectionChannel(fx.branchB.id, fx.orgA.id, {
        channelId: randomUUID(),
        channelResourceId: "hijacked-resource",
        channelExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
    "setConnectionChannel",
  );
});

test("clearConnectionChannel: branchId de Organization B + organizationId de Organization A no limpia el canal", async () => {
  await assertCrossTenantWriteNoOp(
    leerConexionB,
    () => clearConnectionChannel(fx.branchB.id, fx.orgA.id),
    "clearConnectionChannel",
  );
});

test("setConnectionSyncToken: branchId de Organization B + organizationId de Organization A no cambia el syncToken", async () => {
  await assertCrossTenantWriteNoOp(
    leerConexionB,
    () => setConnectionSyncToken(fx.branchB.id, fx.orgA.id, "hijacked-sync-token"),
    "setConnectionSyncToken",
  );
});

// OutboxEvent ----------------------------------------------------------------
// Las tres llevan status: PENDING en el WHERE; el fixture está PENDING.

function leerOutboxB() {
  return prisma.outboxEvent.findUniqueOrThrow({ where: { id: fx.outboxEventB.id } });
}

test("markOutboxEventProcessed: id de Organization B + organizationId de Organization A no marca PROCESSED", async () => {
  await assertCrossTenantWriteNoOp(
    leerOutboxB,
    () => markOutboxEventProcessed(fx.outboxEventB.id, fx.orgA.id),
    "markOutboxEventProcessed",
  );
});

test("rescheduleOutboxEvent: id de Organization B + organizationId de Organization A no reprograma el evento", async () => {
  await assertCrossTenantWriteNoOp(
    leerOutboxB,
    () =>
      rescheduleOutboxEvent(fx.outboxEventB.id, fx.orgA.id, {
        attempts: 1,
        nextAttemptAt: new Date(Date.now() + 60_000),
        lastError: "hijacked",
      }),
    "rescheduleOutboxEvent",
  );
});

test("markOutboxEventDeadLetter: id de Organization B + organizationId de Organization A no manda el evento a DEAD_LETTER", async () => {
  await assertCrossTenantWriteNoOp(
    leerOutboxB,
    () =>
      markOutboxEventDeadLetter(fx.outboxEventB.id, fx.orgA.id, {
        attempts: 5,
        lastError: "hijacked",
      }),
    "markOutboxEventDeadLetter",
  );
});

// IngestionEvent — las tres escrituras que el hallazgo señala -----------------

test("retryIngestionEventConditional: id de Organization B (FAILED) + organizationId de Organization A no lo devuelve a PENDING", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.ingestionEvent.findUniqueOrThrow({ where: { id: fx.ingestionEventBFailed.id } }),
    () => retryIngestionEventConditional(fx.ingestionEventBFailed.id, fx.orgA.id),
    "retryIngestionEventConditional",
  );
});

test("markEventFailed: id de Organization B (PENDING) + organizationId de Organization A no lo marca FAILED", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.ingestionEvent.findUniqueOrThrow({ where: { id: fx.ingestionEventBPending.id } }),
    () => markEventFailed(fx.ingestionEventBPending.id, fx.orgA.id, "hijacked"),
    "markEventFailed",
  );
});

// La más distinta de las tres: no filtra por id sino por promotedContactId +
// organizationId, y no es un solo updateMany — es un findMany (con
// organizationId en el WHERE) seguido de un updateMany por id + organizationId,
// fila por fila (B-27). El caso cross-tenant es "contactId de B +
// organizationId de A": el findMany no debe encontrar nada, así que ni el
// rawPayload ni la nota de promoción de B se redactan.
test("anonymizeIngestionEventsOfContact: contactId de Organization B + organizationId de Organization A no redacta ningún evento", async () => {
  const antes = await prisma.ingestionEvent.findUniqueOrThrow({
    where: { id: fx.ingestionEventBProcessed.id },
  });
  const notasAntes = antes.promotionNotes as unknown as PromotionNote[];
  assert.equal(notasAntes.length, 1);
  assert.equal((notasAntes[0] as NotaIgnorado).entrante, ENTRANTE_RECONOCIBLE);

  const resultado = await anonymizeIngestionEventsOfContact(fx.contactB.id, fx.orgA.id);
  assert.equal(
    resultado.count,
    0,
    "anonymizeIngestionEventsOfContact: no debe afectar ninguna fila",
  );

  const despues = await prisma.ingestionEvent.findUniqueOrThrow({
    where: { id: fx.ingestionEventBProcessed.id },
  });
  assert.deepEqual(despues, antes, "el evento de Organization B debe permanecer intacto");

  const notasDespues = despues.promotionNotes as unknown as PromotionNote[];
  const entrante = (notasDespues[0] as NotaIgnorado).entrante;
  assert.equal(entrante, ENTRANTE_RECONOCIBLE, "la nota sigue sin redactar");
  assert.notEqual(entrante, MARCADOR_DE_DATO_BORRADO);
});

// ---------------------------------------------------------------------------
// §39 — Cotización. Las cuatro escrituras de quote.repository.ts filtran por
// organizationId en su WHERE además de por estado. El caso cross-tenant es el
// mismo que el resto: id (u opportunityId) de B + organizationId de A, con B
// en el estado exacto que la escritura espera — si no, "no cambió nada" sería
// cierto aunque la función no filtrara por organización.
// ---------------------------------------------------------------------------

function leerQuoteBDraft() {
  return prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteBDraft.id } });
}

test("transitionQuoteConditional: id de Organization B (DRAFT) + organizationId de Organization A no la envía", async () => {
  await assertCrossTenantWriteNoOp(
    leerQuoteBDraft,
    () => transitionQuoteConditional(fx.quoteBDraft.id, fx.orgA.id, "DRAFT", "SENT"),
    "transitionQuoteConditional",
  );
});

test("updateDraftQuoteContent: id de Organization B (DRAFT) + organizationId de Organization A no cambia el monto", async () => {
  await assertCrossTenantWriteNoOp(
    leerQuoteBDraft,
    () => updateDraftQuoteContent(fx.quoteBDraft.id, fx.orgA.id, { amount: 1 }),
    "updateDraftQuoteContent",
  );
});

test("supersedeOpenQuotes: opportunityId de Organization B + organizationId de Organization A no supera ninguna cotización", async () => {
  const leerAmbas = () =>
    prisma.quote.findMany({
      where: { id: { in: [fx.quoteBDraft.id, fx.quoteBSentVencida.id] } },
      orderBy: { id: "asc" },
    });
  await assertCrossTenantWriteNoOp(
    leerAmbas,
    () => supersedeOpenQuotes(fx.orgA.id, fx.opportunityB.id, prisma),
    "supersedeOpenQuotes",
  );
});

test("expireDueQuotes: id de Organization B (SENT vencida) + organizationId de Organization A no la vence", async () => {
  await assertCrossTenantWriteNoOp(
    () => prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteBSentVencida.id } }),
    () =>
      expireDueQuotes(
        { organizationId: fx.orgA.id, id: fx.quoteBSentVencida.id },
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    "expireDueQuotes",
  );
});

// ---------------------------------------------------------------------------
// §40 — Entrega. Las dos escrituras de delivery.repository.ts filtran por
// organizationId en su WHERE además de por estado, con B en PENDING —el estado
// exacto que las dos esperan—. createDelivery no está: recibe organizationId
// en el dato, y lo que impide colgarla de una oportunidad ajena son las FKs
// compuestas (probado en delivery.service.integration-test.ts).
// ---------------------------------------------------------------------------

function leerDeliveryBPending() {
  return prisma.delivery.findUniqueOrThrow({ where: { id: fx.deliveryBPending.id } });
}

test("updatePendingDelivery: id de Organization B (PENDING) + organizationId de Organization A no cambia el checklist", async () => {
  await assertCrossTenantWriteNoOp(
    leerDeliveryBPending,
    () =>
      updatePendingDelivery(fx.deliveryBPending.id, fx.orgA.id, {
        checklist: [{ label: "hijacked", checked: true }],
        scheduledAt: new Date("2030-01-01T00:00:00.000Z"),
      }),
    "updatePendingDelivery",
  );
});

test("confirmDeliveryConditional: id de Organization B (PENDING) + organizationId de Organization A no la confirma", async () => {
  await assertCrossTenantWriteNoOp(
    leerDeliveryBPending,
    () =>
      confirmDeliveryConditional(fx.deliveryBPending.id, fx.orgA.id, {
        deliveredById: fx.userB.id,
        deliveredAt: new Date(),
      }),
    "confirmDeliveryConditional",
  );
});

// ---------------------------------------------------------------------------
// §43 — Pago del cliente. Las dos escrituras de payment.repository.ts filtran
// por organizationId en su WHERE. createPayment no está: recibe organizationId
// en el dato, y lo que impide colgarlo de una oportunidad ajena es la FK
// compuesta (probado en payment.service.integration-test.ts).
// ---------------------------------------------------------------------------

function leerPaymentB() {
  return prisma.payment.findUniqueOrThrow({ where: { id: fx.paymentB.id } });
}

test("updatePayment: id de Organization B + organizationId de Organization A no cambia el pago", async () => {
  await assertCrossTenantWriteNoOp(
    leerPaymentB,
    () =>
      updatePayment(fx.paymentB.id, fx.orgA.id, {
        amount: 1,
        method: "OTHER",
        paidAt: new Date("2030-01-01T00:00:00.000Z"),
      }),
    "updatePayment",
  );
});

test("deletePayment: id de Organization B + organizationId de Organization A no borra el pago", async () => {
  await assertCrossTenantWriteNoOp(
    leerPaymentB,
    () => deletePayment(fx.paymentB.id, fx.orgA.id),
    "deletePayment",
  );
});

// ===========================================================================
// H-01 (docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): los
// modelos con organizationId nacidos después del 29/08 —agente de IA,
// conversaciones, automatizaciones, stock, QR, cupones, plantillas, canales de
// Meta, agente interno— tenían solo pruebas HTTP de 404 cross-org, que
// prueban el pre-check del service y no el WHERE de la escritura. Acá, la
// misma propiedad que arriba, escritura por escritura: el id (o la clave) de
// Y con el organizationId de X no toca nada, y la fila de Y queda igual.
//
// Los modelos que no tienen escrituras por organización en su repositorio
// (solo se insertan: VehicleChangeLog, InternalAgentMessage,
// AutomationExecution, Message, ContactChannelIdentity) se cubren con la
// segunda propiedad del archivo: la base rechaza una fila de X que apunta a
// un padre de Y (FK compuesta).
//
// FIXTURE PROPIO, con dos organizaciones propias (X ataca, Y es la víctima):
// no toca el de arriba, y su limpieza no depende del orden de los `after`.
// ===========================================================================

interface FixtureNuevos {
  orgX: string;
  orgY: string;
  authUserY: string;
  userY: string;
  branchY: string;
  contactY: string;
  opportunityY: string;
  agentY: string;
  embedTokenY: string;
  automationY: string;
  outboxEventY: string;
  conversationY: string;
  messageY: string;
  wamidY: string;
  jobProcessingY: string;
  jobPendingY: string;
  mensajePendienteY: string;
  metaConnectionY: string;
  qrCodeY: string;
  qrFollowUpY: string;
  llmTurnUsageY: string;
  campoY: string;
  voucherY: string;
  voucherFollowUpY: string;
  inquiryFollowUpY: string;
  templateY: string;
  vehicleY: string;
  photoY: string;
  kbY: string;
  internalAgentY: string;
  identityExternalIdY: string;
  importSourceY: string;
  importSyncY: string;
  importBatchY: string;
  importLinkY: string;
  photoImportY: string;
}

let nx: FixtureNuevos;

before(async () => {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) throw new Error("No está sembrado el rol ADMIN. Abortando.");

  const orgX = await prisma.organization.create({
    data: { name: `H01 org-x ${randomUUID()}`, slug: `h01-org-x-${Date.now()}` },
  });
  const orgY = await prisma.organization.create({
    data: { name: `H01 org-y ${randomUUID()}`, slug: `h01-org-y-${Date.now()}` },
  });
  const auth = await createRealAuthUser("h01-org-y");
  const userY = await prisma.user.create({
    data: {
      id: auth.id,
      organizationId: orgY.id,
      roleId: adminRole.id,
      email: auth.email,
      fullName: "H01 Org Y",
    },
  });
  const org = orgY.id;
  const branchY = await prisma.branch.create({
    data: { organizationId: org, name: "H01 Y", timezone: "America/Montevideo" },
  });
  const contactY = await prisma.contact.create({
    data: { organizationId: org, firstName: "H01", lastName: "Y" },
  });
  const pipelineY = await prisma.pipeline.create({
    data: { organizationId: org, name: `H01 Y ${randomUUID()}` },
  });
  const stageY = await prisma.stage.create({
    data: { organizationId: org, pipelineId: pipelineY.id, name: "Y", order: 1 },
  });
  const opportunityY = await prisma.opportunity.create({
    data: {
      organizationId: org,
      ownerId: userY.id,
      pipelineId: pipelineY.id,
      stageId: stageY.id,
      contactId: contactY.id,
      title: "H01 Y",
    },
  });
  const agentY = await prisma.agent.create({
    data: {
      organizationId: org,
      branchId: branchY.id,
      name: "H01 Y",
      instructions: "x",
      modelProvider: "openrouter",
      modelName: "x/y",
      guardrails: {},
      channels: ["WHATSAPP", "WEB"],
    },
  });
  const embedTokenY = await prisma.agentEmbedToken.create({
    data: {
      organizationId: org,
      agentId: agentY.id,
      tokenHash: `h01-${randomUUID()}`,
      tokenPrefix: "h01y",
    },
  });
  const automationY = await prisma.automation.create({
    data: {
      organizationId: org,
      name: "H01 Y",
      triggerType: "opportunity.won",
      actionType: "noop",
      actionConfig: {},
    },
  });
  const outboxEventY = await prisma.outboxEvent.create({
    data: { organizationId: org, eventType: "h01.test", payload: {} },
  });
  await prisma.automationExecution.create({
    data: {
      organizationId: org,
      automationId: automationY.id,
      outboxEventId: outboxEventY.id,
      status: "SUCCESS",
    },
  });
  await prisma.branchBusinessHours.create({
    data: {
      organizationId: org,
      branchId: branchY.id,
      weekday: "MONDAY",
      startMinute: 540,
      endMinute: 1080,
    },
  });
  const conversationY = await prisma.conversation.create({
    data: {
      organizationId: org,
      branchId: branchY.id,
      agentId: agentY.id,
      contactId: contactY.id,
      channel: "WHATSAPP",
      status: "TRANSFERRED_TO_HUMAN",
      externalThreadId: "59800000001",
    },
  });
  const wamidY = `wamid.h01-${randomUUID()}`;
  const messageY = await prisma.message.create({
    data: {
      organizationId: org,
      conversationId: conversationY.id,
      direction: "OUTBOUND",
      senderType: "AGENT",
      content: "h01",
      externalMessageId: wamidY,
      deliveryStatus: "SENT",
    },
  });
  const entranteProcesando = await prisma.message.create({
    data: {
      organizationId: org,
      conversationId: conversationY.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "h01 procesando",
    },
  });
  const entrantePendiente = await prisma.message.create({
    data: {
      organizationId: org,
      conversationId: conversationY.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      content: "h01 pendiente",
    },
  });
  const jobBase = { organizationId: org, channelAccountId: "1", externalUserId: "59800000001" };
  const jobProcessingY = await prisma.agentInboundJob.create({
    data: {
      ...jobBase,
      messageId: entranteProcesando.id,
      status: "PROCESSING",
      attempts: 1,
      lockedUntil: new Date(Date.now() + 60_000),
    },
  });
  const jobPendingY = await prisma.agentInboundJob.create({
    data: { ...jobBase, messageId: entrantePendiente.id },
  });
  const identityExternalIdY = `h01-psid-${randomUUID()}`;
  await prisma.contactChannelIdentity.create({
    data: {
      organizationId: org,
      channel: "MESSENGER",
      externalId: identityExternalIdY,
      contactId: contactY.id,
    },
  });
  const metaConnectionY = await prisma.metaPageConnection.create({
    data: {
      organizationId: org,
      pageId: `h01${Date.now()}`,
      pageAccessToken: "h01-token-cifrado",
    },
  });
  const qrCodeY = await prisma.qrCode.create({
    data: {
      organizationId: org,
      branchId: branchY.id,
      name: "H01 Y",
      destinationUrl: "https://example.test/y",
    },
  });
  const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const qrFollowUpY = await prisma.qrFollowUp.create({
    data: {
      organizationId: org,
      automationId: automationY.id,
      opportunityId: opportunityY.id,
      contactId: contactY.id,
      qrCodeId: qrCodeY.id,
      scheduledFor: futuro,
      nextAttemptAt: futuro,
      attempts: 1,
    },
  });
  // B4: el uso del modelo de un turno de Y (solo se inserta y se purga).
  const llmTurnUsageY = await prisma.llmTurnUsage.create({
    data: {
      organizationId: org,
      agentId: agentY.id,
      conversationId: conversationY.id,
      channel: "WHATSAPP",
      model: "doble/modelo",
      calls: 1,
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 0.001,
      createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    },
  });
  // B6: una definición de campo personalizado de Y.
  const campoY = await prisma.contactCustomFieldDefinition.create({
    data: {
      organizationId: org,
      key: "patente",
      label: "Patente",
      type: "TEXT",
      options: [],
      agentEditable: true,
    },
  });
  const voucherY = await prisma.discountVoucher.create({
    data: {
      organizationId: org,
      opportunityId: opportunityY.id,
      contactId: contactY.id,
      automationId: automationY.id,
      label: "H01 10%",
      expiresAt: futuro,
    },
  });
  const voucherFollowUpY = await prisma.discountVoucherFollowUp.create({
    data: {
      organizationId: org,
      automationId: automationY.id,
      opportunityId: opportunityY.id,
      contactId: contactY.id,
      branchId: branchY.id,
      label: "H01 10%",
      expiresInDays: 30,
      scheduledFor: futuro,
      nextAttemptAt: futuro,
      attempts: 1,
    },
  });
  // Seguimiento de consulta (ítem 185): cuelga de la regla, el contacto, la
  // conversación y la sucursal de Y.
  const inquiryFollowUpY = await prisma.inquiryFollowUp.create({
    data: {
      organizationId: org,
      automationId: automationY.id,
      contactId: contactY.id,
      conversationId: conversationY.id,
      branchId: branchY.id,
      channel: "WHATSAPP",
      outboxEventId: randomUUID(),
      kind: "WHATSAPP",
      lastInboundAt: new Date(),
      scheduledFor: futuro,
      nextAttemptAt: futuro,
      attempts: 1,
    },
  });
  const templateY = await prisma.whatsappTemplate.create({
    data: {
      organizationId: org,
      automationId: automationY.id,
      name: `h01_y_${Date.now()}`,
      language: "es_AR",
      bodyText: "Hola {{1}}",
    },
  });
  const vehicleY = await prisma.vehicle.create({
    data: {
      organizationId: org,
      branchId: branchY.id,
      internalCode: `H01-${Date.now()}`,
      condition: "USED",
      make: "Ford",
      model: "Ranger",
      year: 2024,
    },
  });
  const photoY = await prisma.vehiclePhoto.create({
    data: {
      organizationId: org,
      vehicleId: vehicleY.id,
      storagePath: `h01/${randomUUID()}.jpg`,
      position: 0,
      isCover: true,
    },
  });
  await prisma.vehicleChangeLog.create({
    data: { organizationId: org, vehicleId: vehicleY.id, changedById: userY.id, fieldName: "make" },
  });
  const kbY = await prisma.knowledgeBaseEntry.create({
    data: { organizationId: org, branchId: branchY.id, title: "H01 Y", content: "y" },
  });
  const internalAgentY = await prisma.internalAgent.create({
    data: {
      organizationId: org,
      name: "H01 Y",
      instructions: "y",
      modelProvider: "openrouter",
      modelName: "x/y",
    },
  });
  await prisma.internalAgentMessage.create({
    data: {
      organizationId: org,
      internalAgentId: internalAgentY.id,
      userId: userY.id,
      senderType: "USER",
      content: "h01",
    },
  });
  // Importación de datos (migración 20261026120000): la fuente del sistema
  // de origen, una sincronización, un lote de esa sincronización, un vínculo
  // creado por el lote y una foto encolada del vehículo de Y.
  const importSourceY = await prisma.source.create({
    data: { organizationId: org, name: "H01 Y planilla", type: "FILE_IMPORT" },
  });
  const importSyncY = await prisma.importSync.create({
    data: {
      organizationId: org,
      sourceId: importSourceY.id,
      createdByUserId: userY.id,
      sheetId: "h01-planilla-ficticia",
      sheetGid: "0",
      intervalHours: 6,
      nextRunAt: futuro,
    },
  });
  const importBatchY = await prisma.importBatch.create({
    data: {
      organizationId: org,
      sourceId: importSourceY.id,
      syncId: importSyncY.id,
      entityType: "VEHICLE",
      originKind: "SYNC",
      createdByUserId: userY.id,
    },
  });
  const importLinkY = await prisma.externalRecordLink.create({
    data: {
      organizationId: org,
      sourceId: importSourceY.id,
      entityType: "VEHICLE",
      externalKey: "codigo:H01-Y",
      entityId: vehicleY.id,
      createdByBatchId: importBatchY.id,
    },
  });
  const photoImportY = await prisma.vehiclePhotoImport.create({
    data: {
      organizationId: org,
      batchId: importBatchY.id,
      vehicleId: vehicleY.id,
      url: "https://fotos.example.com/h01-y.jpg",
      urlSha256: "0".repeat(64),
      position: 0,
    },
  });

  // La configuración de una clínica y de su sede (docs/rubros.md §1.3, R3),
  // con valores distintos de los defaults para que un lector que caiga en
  // los defaults no se confunda con la fila de Y.
  await prisma.clinicSettings.create({
    data: { organizationId: org, contactTerm: "CLIENTE", privacyNoticeText: "Aviso de Y" },
  });
  await prisma.clinicBranchSettings.create({
    data: { organizationId: org, branchId: branchY.id, reminderHoursBefore: 48 },
  });

  nx = {
    orgX: orgX.id,
    orgY: orgY.id,
    authUserY: auth.id,
    userY: userY.id,
    branchY: branchY.id,
    contactY: contactY.id,
    opportunityY: opportunityY.id,
    agentY: agentY.id,
    embedTokenY: embedTokenY.id,
    automationY: automationY.id,
    outboxEventY: outboxEventY.id,
    conversationY: conversationY.id,
    messageY: messageY.id,
    wamidY,
    jobProcessingY: jobProcessingY.id,
    jobPendingY: jobPendingY.id,
    mensajePendienteY: entrantePendiente.id,
    metaConnectionY: metaConnectionY.id,
    qrCodeY: qrCodeY.id,
    qrFollowUpY: qrFollowUpY.id,
    llmTurnUsageY: llmTurnUsageY.id,
    campoY: campoY.id,
    voucherY: voucherY.id,
    voucherFollowUpY: voucherFollowUpY.id,
    inquiryFollowUpY: inquiryFollowUpY.id,
    templateY: templateY.id,
    vehicleY: vehicleY.id,
    photoY: photoY.id,
    kbY: kbY.id,
    internalAgentY: internalAgentY.id,
    identityExternalIdY,
    importSourceY: importSourceY.id,
    importSyncY: importSyncY.id,
    importBatchY: importBatchY.id,
    importLinkY: importLinkY.id,
    photoImportY: photoImportY.id,
  };
});

after(async () => {
  if (!nx) return;
  const ambas = { in: [nx.orgX, nx.orgY] };
  const w = { where: { organizationId: ambas } };
  await prisma.internalAgentMessage.deleteMany(w);
  await prisma.internalAgent.deleteMany(w);
  await prisma.vehiclePhotoImport.deleteMany(w);
  await prisma.externalRecordLink.deleteMany(w);
  await prisma.importBatch.deleteMany(w);
  await prisma.importSync.deleteMany(w);
  await prisma.source.deleteMany(w);
  await prisma.vehicleChangeLog.deleteMany(w);
  await prisma.vehiclePhoto.deleteMany(w);
  await prisma.knowledgeBaseEntry.deleteMany(w);
  await prisma.vehicle.deleteMany(w);
  await prisma.whatsappTemplate.deleteMany(w);
  await prisma.inquiryFollowUp.deleteMany(w);
  await prisma.discountVoucherFollowUp.deleteMany(w);
  await prisma.discountVoucher.deleteMany(w);
  await prisma.qrFollowUp.deleteMany(w);
  await prisma.llmTurnUsage.deleteMany(w);
  await prisma.contactCustomFieldDefinition.deleteMany(w);
  await prisma.qrCode.deleteMany(w);
  await prisma.metaPageConnection.deleteMany(w);
  await prisma.contactChannelIdentity.deleteMany(w);
  await prisma.agentInboundJob.deleteMany(w);
  await prisma.message.deleteMany(w);
  await prisma.conversation.deleteMany(w);
  await prisma.branchBusinessHours.deleteMany(w);
  await prisma.clinicBranchSettings.deleteMany(w);
  await prisma.clinicSettings.deleteMany(w);
  await prisma.automationExecution.deleteMany(w);
  await prisma.outboxEvent.deleteMany(w);
  await prisma.automation.deleteMany(w);
  await prisma.agentEmbedToken.deleteMany(w);
  await prisma.agent.deleteMany(w);
  await prisma.opportunity.deleteMany(w);
  await prisma.stage.deleteMany(w);
  await prisma.pipeline.deleteMany(w);
  await prisma.contact.deleteMany(w);
  await prisma.branch.deleteMany(w);
  await prisma.user.deleteMany(w);
  await prisma.organization.deleteMany({ where: { id: ambas } });
  await getSupabaseAdmin().auth.admin.deleteUser(nx.authUserY);
});

// Lectores de la fila de Y, para comparar antes y después.
const leerY = {
  agent: () => prisma.agent.findUniqueOrThrow({ where: { id: nx.agentY } }),
  embedToken: () => prisma.agentEmbedToken.findUniqueOrThrow({ where: { id: nx.embedTokenY } }),
  automation: () => prisma.automation.findUniqueOrThrow({ where: { id: nx.automationY } }),
  horarios: () =>
    prisma.branchBusinessHours.findMany({
      where: { branchId: nx.branchY },
      orderBy: { id: "asc" },
    }),
  conversation: () => prisma.conversation.findUniqueOrThrow({ where: { id: nx.conversationY } }),
  message: () => prisma.message.findUniqueOrThrow({ where: { id: nx.messageY } }),
  jobs: () =>
    prisma.agentInboundJob.findMany({ where: { organizationId: nx.orgY }, orderBy: { id: "asc" } }),
  meta: () => prisma.metaPageConnection.findUniqueOrThrow({ where: { id: nx.metaConnectionY } }),
  qr: () => prisma.qrCode.findUniqueOrThrow({ where: { id: nx.qrCodeY } }),
  qrFollowUp: () => prisma.qrFollowUp.findUniqueOrThrow({ where: { id: nx.qrFollowUpY } }),
  voucher: () => prisma.discountVoucher.findUniqueOrThrow({ where: { id: nx.voucherY } }),
  voucherFollowUp: () =>
    prisma.discountVoucherFollowUp.findUniqueOrThrow({ where: { id: nx.voucherFollowUpY } }),
  inquiryFollowUp: () =>
    prisma.inquiryFollowUp.findUniqueOrThrow({ where: { id: nx.inquiryFollowUpY } }),
  template: () => prisma.whatsappTemplate.findUniqueOrThrow({ where: { id: nx.templateY } }),
  vehicle: () => prisma.vehicle.findUniqueOrThrow({ where: { id: nx.vehicleY } }),
  photo: () => prisma.vehiclePhoto.findUniqueOrThrow({ where: { id: nx.photoY } }),
  kb: () => prisma.knowledgeBaseEntry.findUniqueOrThrow({ where: { id: nx.kbY } }),
  campo: () => prisma.contactCustomFieldDefinition.findUniqueOrThrow({ where: { id: nx.campoY } }),
  internalAgent: () => prisma.internalAgent.findUniqueOrThrow({ where: { id: nx.internalAgentY } }),
  identity: () =>
    prisma.contactChannelIdentity.findMany({ where: { externalId: nx.identityExternalIdY } }),
  importSync: () => prisma.importSync.findUniqueOrThrow({ where: { id: nx.importSyncY } }),
  importBatch: () => prisma.importBatch.findUniqueOrThrow({ where: { id: nx.importBatchY } }),
  importLink: () => prisma.externalRecordLink.findUniqueOrThrow({ where: { id: nx.importLinkY } }),
  photoImport: () =>
    prisma.vehiclePhotoImport.findUniqueOrThrow({ where: { id: nx.photoImportY } }),
  clinica: () => prisma.clinicSettings.findUniqueOrThrow({ where: { organizationId: nx.orgY } }),
  sede: () => prisma.clinicBranchSettings.findUniqueOrThrow({ where: { branchId: nx.branchY } }),
};

function reclamoCruzado(id: string) {
  return { id, organizationId: nx.orgX, attempts: 1 };
}

test("H-01 Agent: updateAgent y softDeleteAgent con el id de Y y la organización de X no tocan nada", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.agent,
    () => updateAgentRepo(nx.agentY, nx.orgX, { name: "hijacked" }),
    "updateAgent",
  );
  await assertCrossTenantWriteNoOp(
    leerY.agent,
    () => softDeleteAgentRepo(nx.agentY, nx.orgX),
    "softDeleteAgent",
  );
});

test("H-01 AgentEmbedToken: revocar (uno o por agente) y touchLastUsed no tocan el token de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.embedToken,
    () => revokeEmbedTokenConditional(nx.embedTokenY, nx.orgX, nx.agentY),
    "revokeEmbedTokenConditional",
  );
  await assertCrossTenantWriteNoOp(
    leerY.embedToken,
    () => revokeEmbedTokensByAgent(nx.agentY, nx.orgX),
    "revokeEmbedTokensByAgent",
  );
  await assertCrossTenantWriteNoOp(
    leerY.embedToken,
    () => touchEmbedTokenLastUsed(nx.embedTokenY, nx.orgX, new Date()),
    "touchEmbedTokenLastUsed",
  );
});

test("H-01 Automation: updateAutomation y softDeleteAutomation no tocan la regla de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.automation,
    () => updateAutomation(nx.automationY, nx.orgX, { name: "hijacked" }),
    "updateAutomation",
  );
  await assertCrossTenantWriteNoOp(
    leerY.automation,
    () => softDeleteAutomation(nx.automationY, nx.orgX),
    "softDeleteAutomation",
  );
});

test("H-01 AutomationExecution: una ejecución NUEVA de X sobre la regla de Y la rechaza la base", async () => {
  // Un evento de Y sin ejecución todavía: el upsert va por el INSERT, y ahí
  // la FK compuesta (organization_id, automation_id) frena la referencia.
  const eventoNuevoY = await prisma.outboxEvent.create({
    data: { organizationId: nx.orgY, eventType: "h01.nuevo", payload: {} },
  });
  await assertViolaFk(
    () =>
      upsertAutomationExecution({
        organizationId: nx.orgX,
        automationId: nx.automationY,
        outboxEventId: eventoNuevoY.id,
        status: "FAILED",
        error: "h01",
      }),
    "AutomationExecution de X con la regla de Y",
  );
});

// Hallazgo de H-01 (docs-privados/auditoria-2026-09-24-punta-a-punta.md,
// local), cerrado: el UPDATE del upsert buscaba por el único (automation_id,
// outbox_event_id) SIN organizationId y pisaba la ejecución existente de otra
// organización. Ahora busca con organizationId; con la organización de X no
// encuentra la de Y, el INSERT choca con el único, y la fila de Y no cambia.
test("H-01 AutomationExecution: upsertAutomationExecution con la organización de X no pisa la ejecución existente de Y", async () => {
  const antes = await prisma.automationExecution.findFirstOrThrow({
    where: { automationId: nx.automationY, outboxEventId: nx.outboxEventY },
  });
  await assert.rejects(() =>
    upsertAutomationExecution({
      organizationId: nx.orgX,
      automationId: nx.automationY,
      outboxEventId: nx.outboxEventY,
      status: "FAILED",
      error: "h01",
    }),
  );
  const despues = await prisma.automationExecution.findUniqueOrThrow({ where: { id: antes.id } });
  assert.deepEqual(despues, antes);
});

test("H-01 AutomationExecution: con su propia organización, el reintento sí actualiza la marca", async () => {
  const eventoY = await prisma.outboxEvent.create({
    data: { organizationId: nx.orgY, eventType: "h01.reintento", payload: {} },
  });
  const datos = {
    organizationId: nx.orgY,
    automationId: nx.automationY,
    outboxEventId: eventoY.id,
  };
  const primera = await upsertAutomationExecution({ ...datos, status: "FAILED", error: "x" });
  const segunda = await upsertAutomationExecution({ ...datos, status: "SUCCESS", error: null });
  assert.equal(segunda.id, primera.id, "es la misma marca, no una nueva");
  assert.equal(segunda.status, "SUCCESS");
  assert.equal(segunda.error, null);
});

test("H-01 BranchBusinessHours: replaceBusinessHours con la sucursal de Y no borra su horario (y no puede escribirle)", async () => {
  const antes = await leerY.horarios();
  await prisma.$transaction((tx) => replaceBusinessHours(nx.branchY, nx.orgX, [], tx));
  assert.deepEqual(await leerY.horarios(), antes, "sin franjas: el horario de Y sigue igual");
  await assertViolaFk(
    () =>
      prisma.$transaction((tx) =>
        replaceBusinessHours(
          nx.branchY,
          nx.orgX,
          [{ weekday: "TUESDAY", startMinute: 540, endMinute: 600 }],
          tx,
        ),
      ),
    "BranchBusinessHours de X sobre la sucursal de Y",
  );
  assert.deepEqual(await leerY.horarios(), antes);
});

test("H-01 Conversation: las cinco escrituras con el id de Y y la organización de X no la tocan", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.conversation,
    () => updateConversationRepo(nx.conversationY, nx.orgX, { brief: "hijacked" }),
    "updateConversation",
  );
  await assertCrossTenantWriteNoOp(
    leerY.conversation,
    () => transferConversationToHuman(nx.conversationY, nx.orgX, null),
    "transferConversationToHuman",
  );
  await assertCrossTenantWriteNoOp(
    leerY.conversation,
    () => takeOverConversation(nx.conversationY, nx.orgX, nx.userY, new Date()),
    "takeOverConversation",
  );
  await assertCrossTenantWriteNoOp(
    leerY.conversation,
    () => returnConversationToAgent(nx.conversationY, nx.orgX),
    "returnConversationToAgent",
  );
  await assertCrossTenantWriteNoOp(
    leerY.conversation,
    () => closeConversationRepo(nx.conversationY, nx.orgX),
    "closeConversation",
  );
});

test("H-01 Message: markMessageDelivery y applyDeliveryStatusByExternalId no tocan el mensaje de Y; un Message de X en la conversación de Y lo rechaza la base", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.message,
    () => markMessageDelivery(nx.messageY, nx.orgX, { status: "FAILED", error: "hijacked" }),
    "markMessageDelivery",
  );
  await assertCrossTenantWriteNoOp(
    leerY.message,
    () => applyDeliveryStatusByExternalId(nx.orgX, nx.wamidY, { status: "READ" }),
    "applyDeliveryStatusByExternalId",
  );
  await assertViolaFk(
    () =>
      prisma.message.create({
        data: {
          organizationId: nx.orgX,
          conversationId: nx.conversationY,
          direction: "INBOUND",
          senderType: "CONTACT",
          content: "x",
        },
      }),
    "Message de X en la conversación de Y",
  );
});

test("H-01 AgentInboundJob: las transiciones y cancelaciones con la organización de X no tocan los jobs de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.jobs,
    () => setAgentInboundJobResponse(reclamoCruzado(nx.jobProcessingY), nx.messageY),
    "setAgentInboundJobResponse",
  );
  await assertCrossTenantWriteNoOp(
    leerY.jobs,
    () => markAgentInboundJobDone(reclamoCruzado(nx.jobProcessingY)),
    "markAgentInboundJobDone",
  );
  await assertCrossTenantWriteNoOp(
    leerY.jobs,
    () => markAgentInboundJobFailed(reclamoCruzado(nx.jobProcessingY), "hijacked"),
    "markAgentInboundJobFailed",
  );
  await assertCrossTenantWriteNoOp(
    leerY.jobs,
    () => cancelPendingInboundJobsOfConversation(nx.orgX, nx.conversationY),
    "cancelPendingInboundJobsOfConversation",
  );
  await assertCrossTenantWriteNoOp(
    leerY.jobs,
    () => markAgentInboundJobsCovered(nx.orgX, [nx.mensajePendienteY]),
    "markAgentInboundJobsCovered",
  );
});

test("H-01 ContactChannelIdentity: reasignar la identidad de Y desde X falla sin tocarla; una identidad de X hacia el contacto de Y la rechaza la base", async () => {
  const antes = await leerY.identity();
  await assert.rejects(() =>
    reassignContactChannelIdentity({
      organizationId: nx.orgX,
      channel: "MESSENGER",
      externalId: nx.identityExternalIdY,
      contactId: nx.contactY,
    }),
  );
  assert.deepEqual(await leerY.identity(), antes);
  await assertViolaFk(
    () =>
      prisma.contactChannelIdentity.create({
        data: {
          organizationId: nx.orgX,
          channel: "INSTAGRAM",
          externalId: `h01-x-${randomUUID()}`,
          contactId: nx.contactY,
        },
      }),
    "ContactChannelIdentity de X hacia el contacto de Y",
  );
});

test("H-01 MetaPageConnection: marcar REVOKED o ERROR desde X no toca la conexión de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.meta,
    () => markMetaConnectionRevoked(nx.orgX),
    "markMetaConnectionRevoked",
  );
  await assertCrossTenantWriteNoOp(
    leerY.meta,
    () => markMetaConnectionError(nx.orgX, "hijacked"),
    "markMetaConnectionError",
  );
});

test("H-01 QrCode: updateQrCode y softDeleteQrCode no tocan el QR de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.qr,
    () => updateQrCode(nx.qrCodeY, nx.orgX, { destinationUrl: "https://evil.test" }),
    "updateQrCode",
  );
  await assertCrossTenantWriteNoOp(
    leerY.qr,
    () => softDeleteQrCode(nx.qrCodeY, nx.orgX),
    "softDeleteQrCode",
  );
});

test("H-01 QrFollowUp: las tres transiciones con la organización de X no tocan el seguimiento de Y", async () => {
  const r = reclamoCruzado(nx.qrFollowUpY);
  await assertCrossTenantWriteNoOp(
    leerY.qrFollowUp,
    () => markQrFollowUpSent(r, new Date()),
    "markQrFollowUpSent",
  );
  await assertCrossTenantWriteNoOp(
    leerY.qrFollowUp,
    () => markQrFollowUpCancelled(r, "hijacked"),
    "markQrFollowUpCancelled",
  );
  await assertCrossTenantWriteNoOp(
    leerY.qrFollowUp,
    () => markQrFollowUpFailed(r, "hijacked"),
    "markQrFollowUpFailed",
  );
});

test("H-01 DiscountVoucher: canjear el cupón de Y desde X no lo consume", async () => {
  const antes = await leerY.voucher();
  const canje = await consumirDiscountVoucher(nx.voucherY, nx.orgX, nx.userY, new Date());
  assert.equal(canje, null);
  assert.deepEqual(await leerY.voucher(), antes);
});

test("H-01 DiscountVoucherFollowUp: las tres transiciones con la organización de X no tocan el de Y", async () => {
  const r = reclamoCruzado(nx.voucherFollowUpY);
  await assertCrossTenantWriteNoOp(
    leerY.voucherFollowUp,
    () => markDiscountVoucherFollowUpSent(r, new Date()),
    "markDiscountVoucherFollowUpSent",
  );
  await assertCrossTenantWriteNoOp(
    leerY.voucherFollowUp,
    () => markDiscountVoucherFollowUpCancelled(r, "hijacked"),
    "markDiscountVoucherFollowUpCancelled",
  );
  await assertCrossTenantWriteNoOp(
    leerY.voucherFollowUp,
    () => markDiscountVoucherFollowUpFailed(r, "hijacked"),
    "markDiscountVoucherFollowUpFailed",
  );
});

test("H-01 InquiryFollowUp: las tres transiciones con la organización de X no tocan el de Y", async () => {
  const r = reclamoCruzado(nx.inquiryFollowUpY);
  await assertCrossTenantWriteNoOp(
    leerY.inquiryFollowUp,
    () => markInquiryFollowUpSent(r, new Date()),
    "markInquiryFollowUpSent",
  );
  await assertCrossTenantWriteNoOp(
    leerY.inquiryFollowUp,
    () => markInquiryFollowUpCancelled(r, "hijacked"),
    "markInquiryFollowUpCancelled",
  );
  await assertCrossTenantWriteNoOp(
    leerY.inquiryFollowUp,
    () => markInquiryFollowUpFailed(r, "hijacked"),
    "markInquiryFollowUpFailed",
  );
});

test("H-01 WhatsappTemplate: setMetaId, setStatus y softDelete con la organización de X no tocan la plantilla de Y", async () => {
  const estado = { status: "REJECTED" as const, rejectedReason: "hijacked" };
  await assertCrossTenantWriteNoOp(
    leerY.template,
    () => setWhatsappTemplateMetaId(nx.orgX, nx.templateY, { ...estado, metaTemplateId: "x" }),
    "setWhatsappTemplateMetaId",
  );
  await assertCrossTenantWriteNoOp(
    leerY.template,
    () => setWhatsappTemplateStatus(nx.orgX, nx.templateY, estado),
    "setWhatsappTemplateStatus",
  );
  await assertCrossTenantWriteNoOp(
    leerY.template,
    () => softDeleteWhatsappTemplate(nx.orgX, nx.templateY),
    "softDeleteWhatsappTemplate",
  );
});

test("H-01 Vehicle: updateVehicle y softDeleteVehicle no tocan la unidad de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.vehicle,
    () => updateVehicleRepo(nx.vehicleY, nx.orgX, { make: "hijacked" }),
    "updateVehicle",
  );
  await assertCrossTenantWriteNoOp(
    leerY.vehicle,
    () => softDeleteVehicleRepo(nx.vehicleY, nx.orgX),
    "softDeleteVehicle",
  );
});

test("H-01 VehiclePhoto: updatePhoto, clearCover y deletePhoto no tocan la foto de Y; una foto de X en la unidad de Y la rechaza la base", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.photo,
    () => updatePhoto(nx.photoY, nx.vehicleY, nx.orgX, { position: 9 }, prisma),
    "updatePhoto",
  );
  await assertCrossTenantWriteNoOp(
    leerY.photo,
    () => clearCover(nx.vehicleY, nx.orgX, prisma),
    "clearCover",
  );
  await assertCrossTenantWriteNoOp(
    leerY.photo,
    () => deletePhoto(nx.photoY, nx.vehicleY, nx.orgX, prisma),
    "deletePhoto",
  );
  await assertViolaFk(
    () =>
      prisma.vehiclePhoto.create({
        data: {
          organizationId: nx.orgX,
          vehicleId: nx.vehicleY,
          storagePath: `h01/x-${randomUUID()}.jpg`,
          position: 1,
        },
      }),
    "VehiclePhoto de X en la unidad de Y",
  );
});

test("H-01 VehicleChangeLog: una entrada de historial de X sobre la unidad de Y la rechaza la base", async () => {
  await assertViolaFk(
    () =>
      prisma.vehicleChangeLog.create({
        data: {
          organizationId: nx.orgX,
          vehicleId: nx.vehicleY,
          changedById: nx.userY,
          fieldName: "make",
        },
      }),
    "VehicleChangeLog de X sobre la unidad de Y",
  );
});

test("H-01 KnowledgeBaseEntry: update, softDelete y la escritura de sincronización no tocan la entrada de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.kb,
    () => updateKnowledgeBaseEntry(nx.kbY, nx.orgX, { title: "hijacked" }),
    "updateKnowledgeBaseEntry",
  );
  await assertCrossTenantWriteNoOp(
    leerY.kb,
    () => softDeleteKnowledgeBaseEntry(nx.kbY, nx.orgX),
    "softDeleteKnowledgeBaseEntry",
  );
  await assertCrossTenantWriteNoOp(
    leerY.kb,
    () =>
      writeSyncedKnowledgeBaseEntry(nx.kbY, nx.orgX, {
        branchId: nx.branchY,
        title: "hijacked",
        content: "hijacked",
      }),
    "writeSyncedKnowledgeBaseEntry",
  );
});

test("H-01 InternalAgent e InternalAgentMessage: cambiar el modelo desde X no toca el de Y; un mensaje de X en el agente de Y lo rechaza la base", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.internalAgent,
    () => setInternalAgentModel(nx.orgX, { modelProvider: "openrouter", modelName: "hijacked" }),
    "setInternalAgentModel",
  );
  await assertViolaFk(
    () =>
      prisma.internalAgentMessage.create({
        data: {
          organizationId: nx.orgX,
          internalAgentId: nx.internalAgentY,
          userId: nx.userY,
          senderType: "USER",
          content: "x",
        },
      }),
    "InternalAgentMessage de X en el agente de Y",
  );
});

// La fila que evita que el próximo modelo nuevo quede afuera sin que nadie se
// entere: todo modelo con organizationId del schema tiene que aparecer en
// este archivo (como prisma.<modelo>.). Si agregás un modelo, agregale su
// prueba acá.
// B6: las definiciones de campos personalizados. Las dos escrituras del
// repositorio con el id de Y y la organización de X no tocan nada.
test("H-01 ContactCustomFieldDefinition: update y softDelete con el id de Y y la organización de X no tocan la definición de Y", async () => {
  await assertCrossTenantWriteNoOp(
    leerY.campo,
    () =>
      updateContactCustomFieldDefinition(nx.campoY, nx.orgX, {
        label: "hijacked",
        agentEditable: false,
      }),
    "updateContactCustomFieldDefinition",
  );
  await assertCrossTenantWriteNoOp(
    leerY.campo,
    () => softDeleteContactCustomFieldDefinition(nx.campoY, nx.orgX),
    "softDeleteContactCustomFieldDefinition",
  );
});

// B4: llm_turn_usages solo se inserta (registrarUsoDelTurno), se suma por
// organización y se purga por fecha. Las dos escrituras/lecturas con
// organización: la purga acotada a X no toca la fila de Y, y la suma por
// organización atribuye el gasto de Y a Y y no a X.
test("H-01 LlmTurnUsage: la purga acotada a X no borra la fila (vencida) de Y, y la suma por organización no la mezcla", async () => {
  const corte = new Date(Date.now() + 60_000);
  const { count } = await purgeLlmTurnUsages(corte, { organizationId: nx.orgX });
  assert.equal(count, 0, "X no tiene filas: la purga acotada a X no borra nada");
  assert.ok(
    await prisma.llmTurnUsage.findUnique({ where: { id: nx.llmTurnUsageY } }),
    "la fila de Y sigue",
  );
  const sumas = await sumarUsoPorOrganizacion(new Date(0));
  const deY = sumas.find((s) => s.organizationId === nx.orgY);
  assert.equal(deY?.turnos, 1);
  assert.equal(deY?.promptTokens, 10);
  assert.equal(
    sumas.find((s) => s.organizationId === nx.orgX),
    undefined,
    "X no tiene gasto: no aparece",
  );
});

// Importación de datos (migración 20261026120000). Todavía sin repositorios:
// lo que esta migración garantiza por sí sola son las FKs compuestas (C-3).
// Una fila de X no puede colgar de la fuente, la sincronización, el lote ni
// el vehículo de Y, aunque el código le pase esos ids: la base la rechaza. Los
// H-01 de las escrituras llegan con los repositorios (PR 3 en adelante).
test("H-01 Importación: una fila de X no puede apuntar a la fuente, la sincronización, el lote ni el vehículo de Y (FKs compuestas)", async () => {
  const antes = {
    sync: await leerY.importSync(),
    batch: await leerY.importBatch(),
    link: await leerY.importLink(),
    photo: await leerY.photoImport(),
  };
  const deX = { organizationId: nx.orgX, createdByUserId: nx.userY };
  const rechazos: [string, () => Promise<unknown>][] = [
    [
      "import_batches -> sources de Y",
      () =>
        prisma.importBatch.create({
          data: { ...deX, sourceId: nx.importSourceY, entityType: "CONTACT", originKind: "FILE" },
        }),
    ],
    [
      "import_syncs -> sources de Y",
      () =>
        prisma.importSync.create({
          data: {
            ...deX,
            sourceId: nx.importSourceY,
            sheetId: "x",
            sheetGid: "0",
            intervalHours: 6,
            nextRunAt: new Date(),
          },
        }),
    ],
    [
      "external_record_links -> import_batches de Y",
      () =>
        prisma.externalRecordLink.create({
          data: {
            organizationId: nx.orgX,
            sourceId: nx.importSourceY,
            entityType: "VEHICLE",
            externalKey: "codigo:H01-X",
            entityId: nx.vehicleY,
            createdByBatchId: nx.importBatchY,
          },
        }),
    ],
    [
      "vehicle_photo_imports -> vehicles y import_batches de Y",
      () =>
        prisma.vehiclePhotoImport.create({
          data: {
            organizationId: nx.orgX,
            batchId: nx.importBatchY,
            vehicleId: nx.vehicleY,
            url: "https://fotos.example.com/h01-x.jpg",
            urlSha256: "1".repeat(64),
            position: 0,
          },
        }),
    ],
  ];
  for (const [nombre, crear] of rechazos) {
    await assert.rejects(crear, /Foreign key constraint/i, nombre);
  }
  assert.deepEqual(await leerY.importSync(), antes.sync);
  assert.deepEqual(await leerY.importBatch(), antes.batch);
  assert.deepEqual(await leerY.importLink(), antes.link);
  assert.deepEqual(await leerY.photoImport(), antes.photo);
  assert.equal(await prisma.importBatch.count({ where: { organizationId: nx.orgX } }), 0);
});

// Las lecturas y escrituras del asistente de importación
// (importacion.repository.ts) con los ids de Y y la organización de X: no
// encuentran nada y no tocan nada.
test("H-01 Importación: lote, filas y vínculos de Y no se leen ni se escriben con la organización de X", async () => {
  const antes = { batch: await leerY.importBatch(), link: await leerY.importLink() };
  assert.equal(await findImportBatch(nx.orgX, nx.importBatchY), null);
  const cas = await transicionarLote(nx.orgX, nx.importBatchY, ["STAGED"], { status: "CANCELLED" });
  assert.equal(cas.count, 0);
  const decididas = await decidirFilas(nx.orgX, nx.importBatchY, [randomUUID()], "SKIP");
  assert.equal(decididas.count, 0);
  assert.equal(
    (await buscarVinculos(nx.orgX, nx.importSourceY, "VEHICLE", ["codigo:H01-Y"])).size,
    0,
  );
  assert.equal((await resumenDeFilas(nx.orgX, nx.importBatchY)).total, 0);
  assert.equal(
    (await listarFilasDelLote(nx.orgX, nx.importBatchY, { page: 1, pageSize: 10 })).total,
    0,
  );
  assert.deepEqual(await leerY.importBatch(), antes.batch);
  assert.deepEqual(await leerY.importLink(), antes.link);
});

// La cola de fotos del stock importado (vehiclePhotoImport.repository.ts).
test("H-01 VehiclePhotoImport: marcar o resumir la foto de Y con la organización de X no toca ni ve nada", async () => {
  const antes = await leerY.photoImport();
  const r = await marcarFoto(nx.photoImportY, nx.orgX, { status: "FAILED", error: "ajeno" });
  assert.equal(r.count, 0);
  assert.deepEqual(await resumenDeFotos(nx.orgX, nx.importBatchY), {});
  assert.deepEqual(await leerY.photoImport(), antes);
});

// Las sincronizaciones del stock (importSync.repository.ts).
test("H-01 ImportSync: registrar, pausar, reanudar, borrar o leer la sincronización de Y con la organización de X no toca ni ve nada", async () => {
  const antes = await leerY.importSync();
  assert.equal((await registrarCorridaOk(nx.importSyncY, nx.orgX)).count, 0);
  assert.equal(await registrarCorridaFallida(nx.importSyncY, nx.orgX, "ajeno"), 0);
  assert.equal((await soltarSync(nx.importSyncY, nx.orgX)).count, 0);
  assert.equal((await pausarSync(nx.orgX, nx.importSyncY)).count, 0);
  assert.equal((await reanudarSync(nx.orgX, nx.importSyncY)).count, 0);
  assert.equal((await borrarSync(nx.orgX, nx.importSyncY)).count, 0);
  assert.equal(await findSync(nx.orgX, nx.importSyncY), null);
  assert.ok((await listarSyncs(nx.orgX)).every((s) => s.id !== nx.importSyncY));
  assert.deepEqual(await leerY.importSync(), antes);
});

// R3 (docs/rubros.md §1.3): la configuración de una clínica es por
// organización (su clave) y la de una sede cuelga de la sucursal con FK
// compuesta. Con la organización de X: las lecturas no devuelven lo de Y
// (caen en los defaults), escribir el término toca solo la fila de X, y la
// base rechaza la configuración de X sobre la sede de Y.
test("H-01 ClinicSettings: leer y guardar con la organización de X no ven ni tocan la configuración de Y", async () => {
  const antes = await leerY.clinica();
  assert.deepEqual(
    await leerConfiguracionDeClinica(nx.orgX),
    CONFIGURACION_DE_CLINICA_POR_DEFECTO,
    "X no tiene fila: defaults, no la de Y",
  );
  await guardarTerminoDelContacto(nx.orgX, "PACIENTE");
  assert.deepEqual(await leerY.clinica(), antes, "la fila de Y sigue igual");
  assert.equal(
    (await prisma.clinicSettings.findUniqueOrThrow({ where: { organizationId: nx.orgX } }))
      .contactTerm,
    "PACIENTE",
  );
});

test("H-01 ClinicBranchSettings: X no lee la configuración de la sede de Y ni puede crearle una", async () => {
  const antes = await leerY.sede();
  assert.deepEqual(
    await leerConfiguracionDeSede(nx.orgX, nx.branchY),
    CONFIGURACION_DE_SEDE_POR_DEFECTO,
  );
  // Otra sede de Y, sin fila: con branchY el PK (branch_id) ya ocupado
  // rechazaría antes que la FK y el test no probaría la FK compuesta.
  const otraSedeY = await prisma.branch.create({
    data: { organizationId: nx.orgY, name: "H-01 sede sin configuración", timezone: "UTC" },
  });
  await assertViolaFk(
    () => crearConfiguracionDeSede(nx.orgX, otraSedeY.id, prisma),
    "ClinicBranchSettings de X sobre la sede de Y",
  );
  assert.equal(await prisma.clinicBranchSettings.count({ where: { branchId: otraSedeY.id } }), 0);
  assert.deepEqual(await leerY.sede(), antes);
});

// R5 (docs/rubros.md §4.3): los profesionales de una prestación. Con la
// organización de A: las lecturas no ven la prestación ni los profesionales
// de B, reemplazar no borra las filas de B y la base rechaza una fila de A
// sobre la prestación de B (FK compuesta).
test("H-01 ServiceTypeResource: A no lee, no borra ni crea profesionales en la prestación de B", async () => {
  const otroDeB = await prisma.resource.create({
    data: {
      organizationId: fx.orgB.id,
      branchId: fx.branchB.id,
      name: "H-01 profesional de B",
      type: "PERSON",
    },
  });
  await prisma.serviceTypeResource.create({
    data: { organizationId: fx.orgB.id, serviceTypeId: fx.serviceTypeB.id, resourceId: otroDeB.id },
  });
  const deB = { id: fx.serviceTypeB.id, resourceId: fx.resourceB.id };

  assert.deepEqual(
    (await profesionalesDeLasPrestaciones(fx.orgA.id, [deB])).get(deB.id),
    [],
    "con A no se ven los profesionales de B",
  );
  assert.equal(await esProfesionalDeLaPrestacion(fx.orgA.id, deB, otroDeB.id), false);
  assert.equal(
    (await contarTurnosPorRecurso(fx.orgA.id, [fx.resourceB.id], new Date(0), new Date())).size,
    0,
  );

  await assertViolaFk(
    // Un par que todavía no existe: el ya existente lo saltaría skipDuplicates
    // (tampoco insertaría nada), y el test no llegaría a la FK.
    () => reemplazarProfesionales(fx.orgA.id, deB.id, [fx.resourceB.id], prisma),
    "ServiceTypeResource de A sobre la prestación de B",
  );
  assert.equal(
    await prisma.serviceTypeResource.count({ where: { serviceTypeId: deB.id } }),
    1,
    "la fila de B sigue",
  );
});

// R20 (docs/rubros.md §11.5): las sedes de usuarios e invitaciones. Con la
// organización de A: las lecturas no ven las filas de B, reemplazar las sedes
// de un usuario de B no borra las suyas, copiar las de una invitación de B no
// copia nada, y la base rechaza una fila de A sobre el usuario, la invitación
// o la sede de B (FKs compuestas).
test("H-01 UserBranch e InvitationBranch: A no lee, no borra ni crea sedes de B", async () => {
  await prisma.userBranch.create({
    data: { organizationId: fx.orgB.id, userId: fx.userB.id, branchId: fx.branchB.id },
  });
  await prisma.invitationBranch.create({
    data: { organizationId: fx.orgB.id, invitationId: fx.invitationB.id, branchId: fx.branchB.id },
  });

  assert.equal((await sedesVigentesPorUsuario(fx.orgA.id, [fx.userB.id])).size, 0);
  assert.equal((await sedesVigentesPorInvitacion(fx.orgA.id, [fx.invitationB.id])).size, 0);
  assert.deepEqual(await sedesVigentesDeLaOrganizacion(fx.orgA.id, [fx.branchB.id]), []);
  assert.deepEqual(await recepcionDeLaSede(fx.orgA.id, fx.branchB.id), []);
  assert.equal(
    await copiarSedesDeLaInvitacion(fx.orgA.id, fx.invitationB.id, fx.userB.id, prisma),
    0,
  );

  await reemplazarSedesDelUsuario(fx.orgA.id, fx.userB.id, [], prisma);
  assert.equal(
    await prisma.userBranch.count({ where: { userId: fx.userB.id } }),
    1,
    "la sede del usuario de B sigue",
  );

  // Con una sede de A (el par con la sede de B ya existe y lo rechazaría la PK,
  // no la FK): A no puede colgar sus sedes del usuario ni de la invitación de
  // B, ni las de B de un usuario de A.
  const sedeA = await prisma.branch.create({
    data: { organizationId: fx.orgA.id, name: "H-01 sede de A" },
  });
  await assertViolaFk(
    () => reemplazarSedesDelUsuario(fx.orgA.id, fx.userB.id, [sedeA.id], prisma),
    "UserBranch de A sobre el usuario de B",
  );
  await assertViolaFk(
    () => guardarSedesDeLaInvitacion(fx.orgA.id, fx.invitationB.id, [sedeA.id], prisma),
    "InvitationBranch de A sobre la invitación de B",
  );
  await assertViolaFk(
    () =>
      prisma.userBranch.create({
        data: { organizationId: fx.orgB.id, userId: fx.userB.id, branchId: sedeA.id },
      }),
    "UserBranch de B sobre la sede de A",
  );
  assert.equal(
    await prisma.invitationBranch.count({ where: { invitationId: fx.invitationB.id } }),
    1,
  );
});

// R6 (docs/rubros.md §4.4, §4.5): los bloqueos y los sobreturnos de un
// profesional. Con la organización de A: no se lee, no se borra ni se crea un
// bloqueo sobre el profesional de B (FK compuesta), y no se le cambian los
// sobreturnos.
test("H-01 ResourceTimeOff: A no lee, no borra ni crea bloqueos del profesional de B", async () => {
  const desde = new Date("2027-03-01T12:00:00Z");
  const hasta = new Date("2027-03-01T14:00:00Z");
  const deB = await prisma.resourceTimeOff.create({
    data: {
      organizationId: fx.orgB.id,
      resourceId: fx.resourceB.id,
      startsAt: desde,
      endsAt: hasta,
    },
  });

  assert.deepEqual(
    await findBloqueosQueSeSuperponen(fx.orgA.id, fx.resourceB.id, desde, hasta),
    [],
  );
  assert.equal(await findBloqueoById(deB.id, fx.orgA.id), null);
  assert.equal((await borrarBloqueo(deB.id, fx.orgA.id)).count, 0);
  assert.equal(
    (
      await guardarSobreturnosDelProfesional(fx.orgA.id, fx.resourceB.id, {
        allowsOverbooking: true,
        maxOverbookingsPerDay: 9,
      })
    ).count,
    0,
  );
  await assertViolaFk(
    () =>
      crearBloqueo({
        organizationId: fx.orgA.id,
        resourceId: fx.resourceB.id,
        startsAt: desde,
        endsAt: hasta,
        reason: null,
      }),
    "ResourceTimeOff de A sobre el profesional de B",
  );
  assert.equal(await prisma.resourceTimeOff.count({ where: { id: deB.id } }), 1);
  const recursoB = await prisma.resource.findUniqueOrThrow({ where: { id: fx.resourceB.id } });
  assert.equal(recursoB.allowsOverbooking, false);
});

test("H-01: todo modelo con organizationId del schema aparece en este archivo", async () => {
  const schema = await readFile(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const esteArchivo = await readFile(
    join(process.cwd(), "src", "repositories", "tenant-isolation.integration-test.ts"),
    "utf8",
  );
  const conOrganizacion = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .filter(([, , cuerpo]) => /^\s+organizationId\s/m.test(cuerpo))
    .map(([, nombre]) => nombre);
  assert.ok(conOrganizacion.length > 30, "el parseo del schema encontró los modelos");
  const faltan = conOrganizacion.filter(
    (nombre) => !esteArchivo.includes(`prisma.${nombre[0].toLowerCase()}${nombre.slice(1)}.`),
  );
  assert.deepEqual(
    faltan,
    [],
    `modelos con organizationId sin prueba de aislamiento: ${faltan.join(", ")}`,
  );
});
