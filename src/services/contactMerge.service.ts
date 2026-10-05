import type { Contact, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { soloDigitos } from "../lib/telefono";
import { createActivity } from "../repositories/activity.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { AppError } from "../utils/AppError";
import { appendLeadNotes, getContactById, mergeLeadAiData } from "./contact.service";

// ---------------------------------------------------------------------------
// UNIR CONTACTOS DUPLICADOS. Solo ADMIN. Desde la ficha de un contacto (el que
// QUEDA) se elige otro (el que se UNE), se elige campo por campo qué valor
// queda, y todo lo del contacto unido pasa al que queda. El unido no se borra:
// queda con soft delete y mergedIntoId apuntando al que lo absorbió.
//
// TODO EN UNA TRANSACCIÓN, bajo el lock de la organización: el mismo que
// toman la resolución del contacto de WhatsApp y del widget, así que un
// mensaje que entra a la vez no crea un tercer contacto a mitad de camino.
//
// QUÉ SE MUEVE — el inventario de las FKs a contacts (pg_catalog, octubre
// 2026). La lista vive en FKS_A_CONTACTS y un test de integración la compara
// con el catálogo real: una FK nueva a contacts que no se agregue acá hace
// fallar el CI, en vez de dejar filas colgadas del contacto unido.
//   activities.contact_id                    actividades y tareas
//   bookings.contact_id                      reservas
//   contact_channel_identities.contact_id    PSID / IGSID (Messenger, Instagram)
//   conversations.contact_id                 conversaciones (y con ellas sus
//                                            mensajes, y el wa_id o la sesión
//                                            del widget, que van en la
//                                            conversación)
//   discount_voucher_follow_ups.contact_id   cupones agendados
//   discount_vouchers.contact_id             cupones
//   ingestion_events.promoted_contact_id     eventos de ingesta
//   opportunities.contact_id                 oportunidades (y con ellas
//                                            cotizaciones, pagos, entregas y
//                                            permutas, que cuelgan de la
//                                            oportunidad, no del contacto)
//   qr_follow_ups.contact_id                 seguimientos con QR
//   contacts.merged_into_id                  los que ya se habían unido a
//                                            este: pasan a apuntar al que queda
//
// LOS CHOQUES CON ÍNDICES ÚNICOS, y cómo se resuelven:
//   - contacts_org_email_unique (email por organización, solo no borrados) y
//     el teléfono único de F5 (solo no borrados): el unido se da de baja
//     ANTES de escribir los datos elegidos en el que queda, así que tomar el
//     email o el teléfono del unido no choca.
//   - conversations_open_unique (una abierta por agente, contacto y canal): si
//     los dos tienen una abierta con el mismo agente por el mismo canal, la
//     del unido se CIERRA antes de moverla. La del que queda sigue abierta y
//     el próximo mensaje entra ahí.
//   - contact_channel_identities (org, canal, id externo): mover cambia solo
//     el contacto, el id externo no; no choca.
//
// EL TELÉFONO COMO IDENTIDAD DE WHATSAPP. El webhook encuentra al contacto
// por su teléfono. Si un teléfono de los dos no es el que queda, el próximo
// WhatsApp desde ese número crearía un duplicado nuevo; por eso se registra
// como ContactChannelIdentity WHATSAPP del que queda, y resolveWhatsappContact
// la consulta cuando el teléfono no encuentra a nadie.
//
// LO QUE NO SE REESCRIBE: los JSON históricos que nombran al contacto
// (messages.tool_calls, outbox_events.payload, ingestion_events.raw_payload).
// Son el registro de lo que pasó, no punteros vivos.
// ---------------------------------------------------------------------------

export const FKS_A_CONTACTS = [
  "activities.contact_id",
  "bookings.contact_id",
  "contact_channel_identities.contact_id",
  "contacts.merged_into_id",
  "conversations.contact_id",
  "discount_voucher_follow_ups.contact_id",
  "discount_vouchers.contact_id",
  "ingestion_events.promoted_contact_id",
  "opportunities.contact_id",
  "qr_follow_ups.contact_id",
] as const;

// Los campos que se eligen uno por uno. leadBudget es el par monto + moneda:
// van juntos, no se puede quedar con el monto de uno y la moneda del otro.
export const CAMPOS_DE_LA_UNION = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "companyId",
  "ownerId",
  "lifecycleStage",
  "source",
  "leadScore",
  "leadIntent",
  "leadServiceOfInterest",
  "leadUrgency",
  "leadBudget",
  "leadLocation",
] as const;

export type CampoDeLaUnion = (typeof CAMPOS_DE_LA_UNION)[number];
// "kept": el valor del contacto que queda; "absorbed": el del que se une.
export type Lado = "kept" | "absorbed";
export type Elecciones = Record<CampoDeLaUnion, Lado>;

type ContactoParaUnir = Pick<
  Contact,
  | "id"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "jobTitle"
  | "companyId"
  | "ownerId"
  | "lifecycleStage"
  | "source"
  | "leadScore"
  | "leadIntent"
  | "leadServiceOfInterest"
  | "leadUrgency"
  | "leadBudgetAmount"
  | "leadBudgetCurrency"
  | "leadLocation"
  | "leadNotes"
  | "leadAiData"
  | "vehicleOfInterestId"
  | "vehicleOfInterestSetBy"
  | "updatedAt"
>;

// Pura: el valor de un campo (el presupuesto como par).
export function valorDelCampo(c: ContactoParaUnir, campo: CampoDeLaUnion): unknown {
  if (campo === "leadBudget") {
    return c.leadBudgetAmount === null
      ? null
      : { amount: c.leadBudgetAmount, currency: c.leadBudgetCurrency };
  }
  return c[campo];
}

function vacio(valor: unknown): boolean {
  return (
    valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "")
  );
}

// Pura: la elección por defecto de un campo — el valor MÁS RECIENTE NO VACÍO.
// "Más reciente" es el contacto actualizado por última vez: si su valor está
// vacío, gana el del otro; si los dos están vacíos, el que queda.
export function eleccionPorDefecto(
  kept: ContactoParaUnir,
  absorbed: ContactoParaUnir,
  campo: CampoDeLaUnion,
): Lado {
  const masReciente: Lado =
    absorbed.updatedAt.getTime() > kept.updatedAt.getTime() ? "absorbed" : "kept";
  const otro: Lado = masReciente === "kept" ? "absorbed" : "kept";
  const de = (lado: Lado) => valorDelCampo(lado === "kept" ? kept : absorbed, campo);
  if (!vacio(de(masReciente))) return masReciente;
  if (!vacio(de(otro))) return otro;
  return "kept";
}

// Pura: las elecciones pedidas, completando con el default lo que no vino.
export function resolverElecciones(
  kept: ContactoParaUnir,
  absorbed: ContactoParaUnir,
  pedidas: Partial<Elecciones>,
): Elecciones {
  const elecciones = {} as Elecciones;
  for (const campo of CAMPOS_DE_LA_UNION) {
    elecciones[campo] = pedidas[campo] ?? eleccionPorDefecto(kept, absorbed, campo);
  }
  return elecciones;
}

// Pura: lo que se escribe en el contacto que queda. Las notas y los datos
// extra de la IA no se eligen: se SUMAN (son acumulativos y elegir uno
// tiraría información del otro).
export function datosDelQueQueda(
  kept: ContactoParaUnir,
  absorbed: ContactoParaUnir,
  elecciones: Elecciones,
  hoy: Date = new Date(),
): Prisma.ContactUncheckedUpdateInput {
  const de = (campo: CampoDeLaUnion) => (elecciones[campo] === "kept" ? kept : absorbed);
  const presupuesto = de("leadBudget");
  const datos: Prisma.ContactUncheckedUpdateInput = {
    firstName: de("firstName").firstName,
    lastName: de("lastName").lastName,
    email: de("email").email,
    phone: de("phone").phone,
    jobTitle: de("jobTitle").jobTitle,
    companyId: de("companyId").companyId,
    ownerId: de("ownerId").ownerId,
    lifecycleStage: de("lifecycleStage").lifecycleStage,
    source: de("source").source,
    leadScore: de("leadScore").leadScore,
    leadIntent: de("leadIntent").leadIntent,
    leadServiceOfInterest: de("leadServiceOfInterest").leadServiceOfInterest,
    leadUrgency: de("leadUrgency").leadUrgency,
    leadBudgetAmount: presupuesto.leadBudgetAmount,
    leadBudgetCurrency: presupuesto.leadBudgetCurrency,
    leadLocation: de("leadLocation").leadLocation,
  };
  // El vehículo de interés no se elige: si el que queda no tiene uno y el
  // unido sí, se conserva el del unido (con quién lo cargó, que va junto por
  // el CHECK). Si los dos tienen, queda el del que queda.
  if (!kept.vehicleOfInterestId && absorbed.vehicleOfInterestId) {
    datos.vehicleOfInterestId = absorbed.vehicleOfInterestId;
    datos.vehicleOfInterestSetBy = absorbed.vehicleOfInterestSetBy;
  }
  if (absorbed.leadNotes?.trim()) {
    datos.leadNotes = appendLeadNotes(
      kept.leadNotes,
      `(del contacto unido ${nombreDe(absorbed)}) ${absorbed.leadNotes.trim()}`,
      hoy,
    );
  }
  if (absorbed.leadAiData !== null && absorbed.leadAiData !== undefined) {
    // Las claves del que queda ganan.
    const delQueQueda =
      kept.leadAiData && typeof kept.leadAiData === "object" && !Array.isArray(kept.leadAiData)
        ? (kept.leadAiData as Record<string, unknown>)
        : {};
    datos.leadAiData = mergeLeadAiData(absorbed.leadAiData, delQueQueda) as Prisma.InputJsonValue;
  }
  return datos;
}

function nombreDe(c: Pick<Contact, "firstName" | "lastName">): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

// Pura: los teléfonos (en dígitos) que dejan de estar en un contacto vivo y
// tienen que seguir encontrando al que queda por WhatsApp.
export function telefonosQueSePierden(
  kept: Pick<Contact, "phone">,
  absorbed: Pick<Contact, "phone">,
  telefonoFinal: string | null,
): string[] {
  const final = telefonoFinal ? soloDigitos(telefonoFinal) : "";
  const todos = [kept.phone, absorbed.phone]
    .map((t) => (t ? soloDigitos(t) : ""))
    .filter((d) => d !== "" && d !== final);
  return [...new Set(todos)];
}

export interface ResultadoDeLaUnion {
  contactId: string;
  absorbedId: string;
  movidos: Record<string, number>;
  conversacionesCerradas: number;
}

async function leerParaUnir(organizationId: string, id: string, db: Db) {
  return db.contact.findFirst({ where: { id, organizationId, deletedAt: null } });
}

// Cuántas filas de cada tabla cuelgan del contacto: la vista previa.
export async function contarRelaciones(
  organizationId: string,
  contactId: string,
  db: Db = prisma,
): Promise<Record<string, number>> {
  const w = { organizationId, contactId };
  const [
    actividades,
    reservas,
    identidades,
    conversaciones,
    cuponesAgendados,
    cupones,
    eventos,
    oportunidades,
    seguimientosQr,
    unidos,
  ] = await Promise.all([
    db.activity.count({ where: { ...w, deletedAt: null } }),
    db.booking.count({ where: w }),
    db.contactChannelIdentity.count({ where: w }),
    db.conversation.count({ where: w }),
    db.discountVoucherFollowUp.count({ where: w }),
    db.discountVoucher.count({ where: w }),
    db.ingestionEvent.count({ where: { organizationId, promotedContactId: contactId } }),
    db.opportunity.count({ where: { ...w, deletedAt: null } }),
    db.qrFollowUp.count({ where: w }),
    db.contact.count({ where: { organizationId, mergedIntoId: contactId } }),
  ]);
  return {
    actividades,
    reservas,
    identidades,
    conversaciones,
    cuponesAgendados,
    cupones,
    eventos,
    oportunidades,
    seguimientosQr,
    unidos,
  };
}

export async function vistaPreviaDeLaUnion(
  organizationId: string,
  keptId: string,
  absorbedId: string,
) {
  if (keptId === absorbedId) {
    throw new AppError("No se puede unir un contacto consigo mismo", 400);
  }
  // Con el nombre de la empresa y del asignado: la pantalla muestra nombres,
  // no ids.
  const leer = (id: string) =>
    prisma.contact.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        company: { select: { name: true } },
        owner: { select: { fullName: true } },
      },
    });
  const [kept, absorbed] = await Promise.all([leer(keptId), leer(absorbedId)]);
  if (!kept || !absorbed) {
    throw new AppError("Contacto no encontrado", 404);
  }
  return {
    kept,
    absorbed,
    defaults: resolverElecciones(kept, absorbed, {}),
    aMover: await contarRelaciones(organizationId, absorbedId),
  };
}

export async function unirContactos(
  actorUserId: string,
  organizationId: string,
  keptId: string,
  absorbedId: string,
  pedidas: Partial<Elecciones> = {},
): Promise<ResultadoDeLaUnion> {
  if (keptId === absorbedId) {
    throw new AppError("No se puede unir un contacto consigo mismo", 400);
  }
  const resultado = await prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    const [kept, absorbed] = await Promise.all([
      leerParaUnir(organizationId, keptId, tx),
      leerParaUnir(organizationId, absorbedId, tx),
    ]);
    if (!kept || !absorbed) {
      throw new AppError("Contacto no encontrado", 404);
    }
    const elecciones = resolverElecciones(kept, absorbed, pedidas);
    const datos = datosDelQueQueda(kept, absorbed, elecciones);

    // 1. conversations_open_unique: la abierta del unido que choca con una
    //    abierta del que queda (mismo agente y canal) se cierra.
    const abiertas = {
      in: ["ACTIVE", "TRANSFERRED_TO_HUMAN"] as ("ACTIVE" | "TRANSFERRED_TO_HUMAN")[],
    };
    const delQueQueda = await tx.conversation.findMany({
      where: { organizationId, contactId: keptId, status: abiertas },
      select: { agentId: true, channel: true },
    });
    let conversacionesCerradas = 0;
    for (const { agentId, channel } of delQueQueda) {
      const { count } = await tx.conversation.updateMany({
        where: { organizationId, contactId: absorbedId, agentId, channel, status: abiertas },
        data: { status: "CLOSED" },
      });
      conversacionesCerradas += count;
    }

    // 2. Todo lo que referencia al unido pasa al que queda (FKS_A_CONTACTS).
    const de = { organizationId, contactId: absorbedId };
    const a = { contactId: keptId };
    const movidos: Record<string, number> = {
      actividades: (await tx.activity.updateMany({ where: de, data: a })).count,
      reservas: (await tx.booking.updateMany({ where: de, data: a })).count,
      identidades: (await tx.contactChannelIdentity.updateMany({ where: de, data: a })).count,
      conversaciones: (await tx.conversation.updateMany({ where: de, data: a })).count,
      cuponesAgendados: (await tx.discountVoucherFollowUp.updateMany({ where: de, data: a })).count,
      cupones: (await tx.discountVoucher.updateMany({ where: de, data: a })).count,
      eventos: (
        await tx.ingestionEvent.updateMany({
          where: { organizationId, promotedContactId: absorbedId },
          data: { promotedContactId: keptId },
        })
      ).count,
      oportunidades: (await tx.opportunity.updateMany({ where: de, data: a })).count,
      seguimientosQr: (await tx.qrFollowUp.updateMany({ where: de, data: a })).count,
      unidos: (
        await tx.contact.updateMany({
          where: { organizationId, mergedIntoId: absorbedId },
          data: { mergedIntoId: keptId },
        })
      ).count,
    };

    // 3. Los teléfonos que dejan de estar en un contacto vivo siguen
    //    encontrando al que queda por WhatsApp.
    const perdidos = telefonosQueSePierden(kept, absorbed, (datos.phone as string | null) ?? null);
    if (perdidos.length > 0) {
      await tx.contactChannelIdentity.createMany({
        data: perdidos.map((externalId) => ({
          organizationId,
          channel: "WHATSAPP" as const,
          externalId,
          contactId: keptId,
        })),
        skipDuplicates: true,
      });
    }

    // 4. El unido se da de baja ANTES de escribir los datos elegidos (email y
    //    teléfono únicos solo entre los no borrados).
    await tx.contact.update({
      where: { id: absorbedId },
      data: { deletedAt: new Date(), mergedIntoId: keptId },
    });
    await tx.contact.update({ where: { id: keptId }, data: datos });

    // 5. Queda escrito en el contacto: quién unió a quién y qué se movió.
    const detalle = Object.entries(movidos)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(", ");
    await createActivity(
      {
        organizationId,
        authorId: actorUserId,
        type: "NOTE",
        assigneeId: null,
        companyId: null,
        contactId: keptId,
        opportunityId: null,
        subject: `Se unió el contacto ${nombreDe(absorbed)}`.slice(0, 255),
        body:
          `Contacto unido: ${nombreDe(absorbed)} (${absorbed.id}).` +
          (detalle ? ` Pasaron a este contacto: ${detalle}.` : " No tenía registros asociados.") +
          (conversacionesCerradas > 0
            ? ` Se cerraron ${conversacionesCerradas} conversaciones abiertas del unido que chocaban con una abierta de este.`
            : ""),
      },
      tx,
    );

    return { contactId: keptId, absorbedId, movidos, conversacionesCerradas };
  });
  return resultado;
}

// El contacto que queda, como lo devuelve el GET de la ficha.
export function contactoDespuesDeUnir(organizationId: string, id: string) {
  return getContactById(organizationId, id);
}
