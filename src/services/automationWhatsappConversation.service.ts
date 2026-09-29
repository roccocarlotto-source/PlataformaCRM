import { logger } from "../lib/logger";
import { findAgentByWhatsappPhoneNumberId } from "../repositories/agent.repository";
import { registrarSalienteDeAutomatizacion } from "./agentOrchestration.service";
import { textoParaMeta } from "../utils/whatsappTemplateText";
import { normalizarParametroDePlantilla } from "./whatsappGraph.service";

// ---------------------------------------------------------------------------
// El WhatsApp que manda una automatización, anotado en la conversación del
// contacto — F1 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub). Lo usan los dos workers
// que mandan plantillas: el seguimiento con QR (qrFollowUpWorker.ts) y el
// cupón (discountVoucherFollowUpWorker.ts). Qué se registra y por qué con
// senderType AGENT está en registrarSalienteDeAutomatizacion
// (agentOrchestration.service.ts).
// ---------------------------------------------------------------------------

// Lo que el worker ya mandó, con lo necesario para anotarlo.
export interface EnvioDePlantilla {
  organizationId: string;
  contactId: string;
  // El número desde el que salió: su agente es el dueño de la conversación.
  phoneNumberId: string;
  // El wa_id del cliente (solo dígitos).
  destino: string;
  plantilla: { name: string; bodyText?: string | null };
  // {{1}}, {{2}}… en ese orden, tal como se mandaron.
  parametros: string[];
  wamid: string | null;
}

// El texto que el cliente recibió: el cuerpo de la plantilla con cada variable
// reemplazada por su parámetro, normalizado igual que viajó a Meta
// (normalizarParametroDePlantilla). WhatsappTemplate.bodyText guarda el texto
// como lo escribió el negocio, con {nombre} y {link}; textoParaMeta es la MISMA
// traducción a {{1}} y {{2}} que se usó al darla de alta, así que lo anotado es
// lo que Meta armó. Si el cuerpo no está disponible, una línea descriptiva:
// "[Plantilla <nombre>] <param 1> · <param 2>". Un {{n}} sin parámetro queda
// tal cual: es lo que Meta habría rechazado, no algo a inventar. Pura y
// exportada para probarla sin base.
export function textoDePlantilla(
  plantilla: { name: string; bodyText?: string | null },
  parametros: string[],
): string {
  const valores = parametros.map(normalizarParametroDePlantilla);
  const cuerpo = plantilla.bodyText?.trim();
  if (cuerpo) {
    return textoParaMeta(cuerpo).replace(/\{\{(\d+)\}\}/g, (marcador, n: string) => {
      return valores[Number(n) - 1] ?? marcador;
    });
  }
  return [`[Plantilla ${plantilla.name}]`, valores.join(" · ")].filter(Boolean).join(" ");
}

// Anota el envío como saliente en la conversación de WhatsApp del contacto con
// el agente dueño del número. Lanza si algo falla: quien llama
// (anotarEnvioEnConversacion) es el que decide que eso no afecte el envío.
export async function registrarPlantillaEnConversacion(envio: EnvioDePlantilla): Promise<void> {
  const agente = await findAgentByWhatsappPhoneNumberId(envio.phoneNumberId);
  // El número es de un agente de la sucursal (findBranchWhatsappPhoneNumberId);
  // si entre el envío y acá se lo sacaron, o es de otra organización, no hay
  // conversación a la que pertenezca.
  if (!agente || agente.organizationId !== envio.organizationId) {
    throw new Error(
      `El número ${envio.phoneNumberId} ya no es de ningún agente de la organización ${envio.organizationId}`,
    );
  }
  await registrarSalienteDeAutomatizacion({
    organizationId: envio.organizationId,
    agentId: agente.id,
    branchId: agente.branchId,
    contactId: envio.contactId,
    externalThreadId: envio.destino,
    texto: textoDePlantilla(envio.plantilla, envio.parametros),
    externalMessageId: envio.wamid,
  });
}

// ANOTAR NO PUEDE CAMBIAR EL RESULTADO DEL ENVÍO. Se llama DESPUÉS de marcar la
// fila como enviada: si esto falla, se loguea y listo — la fila sigue SENT y el
// envío nunca se reintenta, porque reintentarlo sería mandarle al cliente el
// mismo WhatsApp dos veces por un problema que es solo nuestro. Nunca lanza.
export async function anotarEnvioEnConversacion(
  envio: EnvioDePlantilla,
  registrar: (envio: EnvioDePlantilla) => Promise<void> = registrarPlantillaEnConversacion,
): Promise<void> {
  try {
    await registrar(envio);
  } catch (err) {
    logger.error(
      {
        err,
        organizationId: envio.organizationId,
        contactId: envio.contactId,
        plantilla: envio.plantilla.name,
      },
      "El WhatsApp de la automatización salió pero no quedó en la conversación del contacto (no se reintenta el envío)",
    );
  }
}
