import type { Activity, ConversationChannel, ConversationStatus, Message } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { findOldestActiveAdmin } from "../repositories/user.repository";
import { fraseFueraDeHorario, type AtencionFueraDeHorario } from "../utils/fueraDeHorario";
import { ventanaDeWhatsappAbierta } from "../utils/ventanaDeWhatsapp";
import {
  PREFIJO_TAREA_SIN_RESPUESTA,
  SUFIJO_TAREA_SIN_RESPUESTA,
  findTareaAbiertaDelPedido,
  whereTareaDelPedido,
} from "./tareaDelPedido";

// Para los que ya la importan de acá (conversationReply.service.ts).
export { findTareaAbiertaDelPedido };

// ---------------------------------------------------------------------------
// "Devolver al agente" sin haberle respondido al cliente.
//
// El caso real: el cliente pidió hablar con una persona, el agente le dijo que
// alguien lo iba a contactar y derivó, y el vendedor tocó "Devolver al agente"
// sin escribirle nada. El cliente se quedó esperando a alguien que no iba a
// aparecer. Ahora, en ese caso:
//   - se le avisa al cliente, por el mismo canal, con un texto que decide el
//     negocio —el de siempre, o el que cargó en el agente— y nunca el modelo:
//     es una promesa del negocio y no se improvisa;
//   - la tarea queda pendiente (la de la derivación, o una nueva para un ADMIN
//     si la derivación no tuvo a quién avisarle);
//   - la conversación muestra la marca "Pidió hablar con una persona · sin
//     responder" hasta que una persona le escriba o se complete esa tarea.
//
// El aviso es un Message AUTOMATION con noticeType UNANSWERED_HANDOFF —un
// DATO, no el texto: desde que el texto es configurable por agente
// (Agent.unansweredHandoffNoticeText), su primera frase ya no lo identifica—
// y la tarea es una Activity del contacto con uno de los dos asuntos de abajo.
// El aviso es el ancla de la marca, y por eso se guarda en el hilo aunque no
// se pueda entregar (queda FAILED con el motivo).
//
// POR QUÉ AUTOMATION Y NO AGENT: lo manda una regla, no el modelo, y es lo que
// AUTOMATION significa en el hilo ("Automatización", no el nombre del agente).
// Para el agente no cambia nada: el historial ramifica por direction, así que
// lo ve como algo que el negocio ya le dijo al cliente y sigue desde ahí. Y no
// entra en humanSpokeLast, que solo mira HUMAN y AGENT.
// ---------------------------------------------------------------------------

// La primera frase del aviso de siempre. Ya NO lo reconoce en el hilo (eso es
// noticeType): la migración 20261019120000 la usó una última vez para marcar
// los avisos guardados antes.
export const PREFIJO_DEL_AVISO = "Por el momento no hay nadie del equipo disponible.";
const CIERRE_DEL_AVISO = "Mientras tanto, si querés, puedo seguir ayudándote.";

export const AVISO_SIN_RESPUESTA = `${PREFIJO_DEL_AVISO} Te vamos a contactar más tarde. ${CIERRE_DEL_AVISO}`;

// El tope de Agent.unansweredHandoffNoticeText (VARCHAR(500)).
export const LARGO_MAXIMO_DEL_AVISO = 500;

// El aviso según el horario de la sucursal y el texto del agente.
//   - Sin texto propio (null o vacío): el de siempre. Fuera de horario, en vez
//     de "más tarde", cuándo atiende el equipo y cuándo le van a escribir.
//   - Con texto propio: ese texto, y fuera de horario se le AGREGA la misma
//     frase del horario al final. El negocio no tiene que escribirla ni
//     mantenerla cuando cambia el horario de la sucursal.
// Dentro de horario o sin horario cargado, atencion es null.
export function textoDelAviso(
  atencion: AtencionFueraDeHorario | null,
  textoDelAgente: string | null = null,
): string {
  const propio = textoDelAgente?.trim();
  if (propio) {
    return atencion ? `${propio} ${fraseFueraDeHorario(atencion)}` : propio;
  }
  return atencion
    ? `${PREFIJO_DEL_AVISO} ${fraseFueraDeHorario(atencion)} ${CIERRE_DEL_AVISO}`
    : AVISO_SIN_RESPUESTA;
}

export function asuntoDeTareaSinRespuesta(nombreDelContacto: string): string {
  return `${PREFIJO_TAREA_SIN_RESPUESTA}${nombreDelContacto}${SUFIJO_TAREA_SIN_RESPUESTA}`.slice(
    0,
    255,
  );
}

export const MOTIVO_VENTANA_CERRADA =
  "No se envió: pasaron más de 24 h desde el último mensaje del cliente y WhatsApp solo permite plantillas aprobadas";
export const MOTIVO_VENTANA_CERRADA_META =
  "No se envió: pasaron más de 24 h desde el último mensaje del cliente y Messenger e Instagram no dejan escribirle hasta que vuelva a escribir";

// ---------------------------------------------------------------------------
// TOPE DE ANTIGÜEDAD DEL AVISO AUTOMÁTICO (FABLE-G-02 de
// docs-privados/auditoria-2026-10-05-FABLE.md y OPUS-D-02 de
// docs-privados/auditoria-2026-10-04-OPUS.md, locales).
//
// El aviso promete algo sobre AHORA ("por el momento no hay nadie
// disponible"). Si el proceso estuvo dormido o caído, o si el negocio acaba de
// activar el aviso, el barrido encuentra derivaciones vencidas hace horas o
// días: mandarles ese texto de golpe —quizá de madrugada, quizá a un cliente
// al que ya atendieron por teléfono— es peor que no mandarlo. Pasado el tope,
// la conversación vuelve al agente y queda la tarea para el vendedor, pero al
// cliente no se le escribe.
//
// El tope: 3 veces los minutos configurados, y nunca menos de 10 minutos de
// tolerancia sobre el plazo. El piso existe por los plazos cortos: con 2
// minutos, "3 veces" son 4 de tolerancia, menos que un deploy o un arranque en
// frío, y un reinicio normal se comería avisos que sí correspondían.
//   2 min -> hasta los 12;  15 min -> hasta los 45;  60 min -> hasta los 180.
// ---------------------------------------------------------------------------
export const FACTOR_DE_ANTIGUEDAD_DEL_AVISO = 3;
export const TOLERANCIA_MINIMA_DEL_AVISO_MIN = 10;

export function topeDeAntiguedadDelAvisoMs(minutos: number): number {
  return (
    Math.max(minutos * FACTOR_DE_ANTIGUEDAD_DEL_AVISO, minutos + TOLERANCIA_MINIMA_DEL_AVISO_MIN) *
    60_000
  );
}

// Pura: ¿la derivación venció hace tanto que ya no se le escribe al cliente?
export function avisoLlegaTarde(derivadaEn: Date, minutos: number, ahora: Date): boolean {
  return ahora.getTime() - derivadaEn.getTime() > topeDeAntiguedadDelAvisoMs(minutos);
}

// Pura: ¿hay que avisarle al cliente al devolver? Solo si la conversación
// estaba derivada y ninguna persona le escribió desde la derivación. El
// segundo dato es humanSpokeLast: después de una derivación el agente sigue
// hablando hasta que una persona escribe, así que "el último entre HUMAN y
// AGENT fue una persona" es exactamente "una persona respondió".
//
// Idempotencia: devolver deja la conversación ACTIVE, así que una segunda
// devolución ya no avisa. La garantía es el CAS de returnConversationToAgent.
export function debeAvisarAlDevolver(estado: {
  status: ConversationStatus;
  humanoRespondio: boolean;
}): boolean {
  return estado.status === "TRANSFERRED_TO_HUMAN" && !estado.humanoRespondio;
}

// Cómo sale el aviso según el canal, con el mismo criterio que responder
// desde el CRM (I-03):
//   - WhatsApp, Messenger e Instagram: se manda por el canal si la ventana de
//     24 h está abierta; si no, se guarda como FAILED con el motivo.
//   - Web: no hay ventana. Queda en el hilo y el widget lo trae con su
//     polling (o al volver a abrirse, si el visitante cerró la pestaña).
export type EntregaDelAviso = { tipo: "por-el-canal" } | { tipo: "no-se-envia"; motivo: string };

export function entregaDelAviso(
  channel: ConversationChannel,
  finDeVentana: Date | null,
  ahora: Date = new Date(),
): EntregaDelAviso {
  if (channel === "WEB") {
    return { tipo: "por-el-canal" };
  }
  if (!ventanaDeWhatsappAbierta(finDeVentana, ahora)) {
    return {
      tipo: "no-se-envia",
      motivo: channel === "WHATSAPP" ? MOTIVO_VENTANA_CERRADA : MOTIVO_VENTANA_CERRADA_META,
    };
  }
  return { tipo: "por-el-canal" };
}

// Pura: la marca. Hay pedido sin responder si hubo un aviso, ninguna persona
// escribió después, y la tarea (si la hay) sigue abierta. Sin tarea —no se
// pudo crear— la marca queda hasta que una persona escriba.
export function marcaSinRespuesta(datos: {
  hayAviso: boolean;
  humanoEscribioDespues: boolean;
  tarea: Pick<Activity, "completedAt"> | null;
}): boolean {
  if (!datos.hayAviso || datos.humanoEscribioDespues) {
    return false;
  }
  return datos.tarea === null || datos.tarea.completedAt === null;
}

function esAviso(message: Pick<Message, "noticeType">): boolean {
  return message.noticeType === "UNANSWERED_HANDOFF";
}

// Las dos tareas que cuentan como "la tarea del pedido" y la consulta de la
// que sigue abierta viven en tareaDelPedido.ts: las comparte la derivación.

// La tarea de un aviso: la más reciente creada hasta ese momento (la nueva se
// crea antes que el mensaje, en la misma transacción).
function findTareaDelAviso(organizationId: string, contactId: string, aviso: Date, db: Db) {
  return db.activity.findFirst({
    where: { ...whereTareaDelPedido(organizationId, contactId), createdAt: { lte: aviso } },
    orderBy: { createdAt: "desc" },
    select: { completedAt: true },
  });
}

// A quién se le asigna la tarea cuando no había ninguna: quien devuelve, si es
// ADMIN; si no (o si no hay quien devuelva: el aviso automático), el ADMIN
// activo más antiguo de la organización. Siempre hay uno: countActiveAdmins
// impide quedarse sin ADMIN.
export async function findAdminParaLaTarea(
  organizationId: string,
  actor: { userId: string; role: string } | null,
  db: Db,
): Promise<string | null> {
  if (actor?.role === "ADMIN") {
    return actor.userId;
  }
  const admin = await findOldestActiveAdmin(organizationId, db);
  return admin?.id ?? null;
}

// La marca del DETALLE: el hilo ya viene entero, así que el aviso y lo que
// vino después salen de ahí; solo la tarea es otra consulta.
export async function pedidoSinResponderDelHilo(
  conversation: {
    organizationId: string;
    contactId: string;
    messages: Pick<Message, "senderType" | "noticeType" | "createdAt">[];
  },
  db: Db = prisma,
): Promise<boolean> {
  let indice = conversation.messages.length - 1;
  while (indice >= 0 && !esAviso(conversation.messages[indice]!)) {
    indice -= 1;
  }
  if (indice === -1) {
    return false;
  }
  const aviso = conversation.messages[indice]!;
  const humanoEscribioDespues = conversation.messages
    .slice(indice + 1)
    .some((m) => m.senderType === "HUMAN");
  if (humanoEscribioDespues) {
    return false;
  }
  const tarea = await findTareaDelAviso(
    conversation.organizationId,
    conversation.contactId,
    aviso.createdAt,
    db,
  );
  return marcaSinRespuesta({ hayAviso: true, humanoEscribioDespues, tarea });
}

// La marca del LISTADO, para una página entera. Una consulta trae el último
// aviso de cada conversación de la página; solo las que tienen uno (pocas)
// pagan las otras dos.
export async function conversacionesConPedidoSinResponder(
  organizationId: string,
  conversations: { id: string; contactId: string }[],
  db: Db = prisma,
): Promise<Set<string>> {
  const conMarca = new Set<string>();
  if (conversations.length === 0) {
    return conMarca;
  }
  const avisos = await db.message.findMany({
    where: {
      organizationId,
      conversationId: { in: conversations.map((c) => c.id) },
      noticeType: "UNANSWERED_HANDOFF",
    },
    orderBy: { createdAt: "desc" },
    distinct: ["conversationId"],
    select: { conversationId: true, createdAt: true },
  });
  const contactoDe = new Map(conversations.map((c) => [c.id, c.contactId]));

  await Promise.all(
    avisos.map(async (aviso) => {
      const contactId = contactoDe.get(aviso.conversationId)!;
      const [humanoDespues, tarea] = await Promise.all([
        db.message.findFirst({
          where: {
            organizationId,
            conversationId: aviso.conversationId,
            senderType: "HUMAN",
            createdAt: { gt: aviso.createdAt },
          },
          select: { id: true },
        }),
        findTareaDelAviso(organizationId, contactId, aviso.createdAt, db),
      ]);
      if (marcaSinRespuesta({ hayAviso: true, humanoEscribioDespues: !!humanoDespues, tarea })) {
        conMarca.add(aviso.conversationId);
      }
    }),
  );
  return conMarca;
}
