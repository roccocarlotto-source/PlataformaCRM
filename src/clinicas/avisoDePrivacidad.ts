import type { OrganizationIndustry } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createMessage } from "../repositories/message.repository";
import { AppError } from "../utils/AppError";
import { leerConfiguracionDeClinica } from "./repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// R16 (docs/rubros.md §8.1): el aviso de privacidad de una clínica, una vez por
// contacto, antes de la primera respuesta del agente.
//
// - Es un Message aparte (AUTOMATION, noticeType PRIVACY_NOTICE), creado justo
//   antes de la respuesta del modelo: en el hilo queda primero.
// - Una vez por contacto: contacts.privacy_notice_sent_at se escribe con un CAS
//   (solo si estaba en NULL) en la misma transacción que el mensaje. Dos turnos
//   a la vez del mismo contacto en dos canales no mandan dos avisos.
// - Si el primer mensaje es una urgencia, sale primero la urgencia (la capa 1
//   responde sin el modelo y no pasa por acá) y el aviso va con la primera
//   respuesta del agente que siga.
// - Solo una fecha: no se guarda ningún dato del paciente ni un motivo clínico
//   (§8.2).
//
// Una automotora no tiene aviso: registrarAvisoDePrivacidad devuelve null sin
// leer nada.
// ---------------------------------------------------------------------------

export const AVISO_DE_PRIVACIDAD_INCOMPLETO =
  "Para activar el agente de una clínica, primero cargá el aviso de privacidad y el link a la política de privacidad en la configuración de la organización.";

export const AVISO_EN_USO =
  "No se puede borrar el aviso de privacidad mientras haya agentes activos: primero desactivalos.";

/** El texto que recibe el contacto: el aviso y, abajo, el link. */
export function textoDelAvisoDePrivacidad(texto: string, url: string): string {
  return `${texto.trim()}\n\n${url.trim()}`;
}

export interface AvisoRegistrado {
  id: string;
  texto: string;
}

/**
 * Si al contacto todavía no se le mandó el aviso y la clínica lo tiene
 * configurado, lo marca como mandado y crea el Message. null si no corresponde
 * (automotora, aviso sin configurar, o ya mandado).
 */
export async function registrarAvisoDePrivacidad(args: {
  organizationId: string;
  industry: OrganizationIndustry;
  conversationId: string;
  contactId: string;
}): Promise<AvisoRegistrado | null> {
  if (args.industry !== "CLINICA") return null;
  const { privacyNoticeText, privacyPolicyUrl } = await leerConfiguracionDeClinica(
    args.organizationId,
  );
  if (!privacyNoticeText || !privacyPolicyUrl) return null;
  const texto = textoDelAvisoDePrivacidad(privacyNoticeText, privacyPolicyUrl);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.contact.updateMany({
      where: { id: args.contactId, organizationId: args.organizationId, privacyNoticeSentAt: null },
      data: { privacyNoticeSentAt: new Date() },
    });
    if (count === 0) return null;
    const mensaje = await createMessage(
      {
        organizationId: args.organizationId,
        conversationId: args.conversationId,
        direction: "OUTBOUND",
        senderType: "AUTOMATION",
        noticeType: "PRIVACY_NOTICE",
        content: texto,
      },
      tx,
    );
    return { id: mensaje.id, texto };
  });
}

/**
 * Los avisos de la conversación que todavía no salieron por el canal (WhatsApp
 * o Messenger), del más viejo al más nuevo. El worker los manda antes de la
 * respuesta del agente, también en un reintento.
 */
export function avisosDePrivacidadSinEnviar(organizationId: string, conversationId: string) {
  return prisma.message.findMany({
    where: {
      organizationId,
      conversationId,
      direction: "OUTBOUND",
      noticeType: "PRIVACY_NOTICE",
      OR: [{ deliveryStatus: null }, { deliveryStatus: { in: ["PENDING", "FAILED"] } }],
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Una clínica no activa un agente sin el aviso y el link cargados. */
export async function exigirAvisoParaActivar(
  organizationId: string,
  industry: OrganizationIndustry,
): Promise<void> {
  if (industry !== "CLINICA") return;
  const { privacyNoticeText, privacyPolicyUrl } = await leerConfiguracionDeClinica(organizationId);
  if (!privacyNoticeText || !privacyPolicyUrl) {
    throw new AppError(AVISO_DE_PRIVACIDAD_INCOMPLETO, 400);
  }
}

/** Borrar el aviso (o el link) con agentes activos dejaría de mandarlo. */
export async function exigirSinAgentesActivos(organizationId: string): Promise<void> {
  const activos = await prisma.agent.count({
    where: { organizationId, isActive: true },
  });
  if (activos > 0) throw new AppError(AVISO_EN_USO, 409);
}
