import type { Activity, ConversationChannel, ConversationStatus, Message } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import { fraseFueraDeHorario, type AtencionFueraDeHorario } from "../utils/fueraDeHorario";
import { ventanaDeWhatsappAbierta } from "../utils/ventanaDeWhatsapp";
import { PREFIJO_TAREA_DE_DERIVACION } from "./agentOrchestration.service";

// ---------------------------------------------------------------------------
// "Devolver al agente" sin haberle respondido al cliente.
//
// El caso real: el cliente pidió hablar con una persona, el agente le dijo que
// alguien lo iba a contactar y derivó, y el vendedor tocó "Devolver al agente"
// sin escribirle nada. El cliente se quedó esperando a alguien que no iba a
// aparecer. Ahora, en ese caso:
//   - se le avisa al cliente, por el mismo canal, con un texto FIJO (no lo
//     genera el modelo: es una promesa del negocio y no se improvisa);
//   - la tarea queda pendiente (la de la derivación, o una nueva para un ADMIN
//     si la derivación no tuvo a quién avisarle);
//   - la conversación muestra la marca "Pidió hablar con una persona · sin
//     responder" hasta que una persona le escriba o se complete esa tarea.
//
// SIN COLUMNA NUEVA. Todo se deriva de lo que ya existe, igual que
// humanoAtiendeLaConversacion: el aviso es un Message (AUTOMATION, que empieza
// con PREFIJO_DEL_AVISO) y la tarea es una Activity del contacto con uno de los dos
// asuntos de abajo. El aviso es el ancla de la marca, y por eso se guarda en
// el hilo aunque no se pueda entregar (queda FAILED con el motivo).
//
// POR QUÉ AUTOMATION Y NO AGENT: lo manda una regla, no el modelo, y es lo que
// AUTOMATION significa en el hilo ("Automatización", no el nombre del agente).
// Para el agente no cambia nada: el historial ramifica por direction, así que
// lo ve como algo que el negocio ya le dijo al cliente y sigue desde ahí. Y no
// entra en humanSpokeLast, que solo mira HUMAN y AGENT.
// ---------------------------------------------------------------------------

// La primera frase del aviso, igual en todas sus versiones: es lo que lo
// reconoce en el hilo (esAviso y el listado). Fuera de horario el resto del
// texto cambia con el horario de la sucursal, así que el texto entero ya no
// sirve de ancla; los avisos guardados antes de esto también empiezan así.
export const PREFIJO_DEL_AVISO = "Por el momento no hay nadie del equipo disponible.";
const CIERRE_DEL_AVISO = "Mientras tanto, si querés, puedo seguir ayudándote.";

export const AVISO_SIN_RESPUESTA = `${PREFIJO_DEL_AVISO} Te vamos a contactar más tarde. ${CIERRE_DEL_AVISO}`;

// El aviso según el horario de la sucursal: fuera de horario, en vez de "más
// tarde", cuándo atiende el equipo y cuándo le van a escribir. Dentro de
// horario o sin horario cargado (atencion null), AVISO_SIN_RESPUESTA.
export function textoDelAviso(atencion: AtencionFueraDeHorario | null): string {
  return atencion
    ? `${PREFIJO_DEL_AVISO} ${fraseFueraDeHorario(atencion)} ${CIERRE_DEL_AVISO}`
    : AVISO_SIN_RESPUESTA;
}

const PREFIJO_TAREA_SIN_RESPUESTA = "Contactar a ";
const SUFIJO_TAREA_SIN_RESPUESTA = ": pidió hablar con una persona y nadie respondió";

export function asuntoDeTareaSinRespuesta(nombreDelContacto: string): string {
  return `${PREFIJO_TAREA_SIN_RESPUESTA}${nombreDelContacto}${SUFIJO_TAREA_SIN_RESPUESTA}`.slice(
    0,
    255,
  );
}

export const MOTIVO_VENTANA_CERRADA =
  "No se envió: pasaron más de 24 h desde el último mensaje del cliente y WhatsApp solo permite plantillas aprobadas";
export const MOTIVO_CANAL_SIN_ENVIO =
  "No se envió: por ahora el CRM solo puede escribirle al cliente por WhatsApp";

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
//   - WhatsApp: se manda si la ventana de 24 h está abierta; si no, se guarda
//     como FAILED con el motivo.
//   - Web: se guarda en el hilo. El widget no recibe mensajes que no sean la
//     respuesta al suyo, pero lo ve al recargar el historial.
//   - Messenger/Instagram: I-03 no los soporta; se guarda como FAILED.
export type EntregaDelAviso =
  { tipo: "whatsapp" } | { tipo: "solo-hilo" } | { tipo: "no-se-envia"; motivo: string };

export function entregaDelAviso(
  channel: ConversationChannel,
  finDeVentana: Date | null,
  ahora: Date = new Date(),
): EntregaDelAviso {
  if (channel === "WEB") {
    return { tipo: "solo-hilo" };
  }
  if (channel !== "WHATSAPP") {
    return { tipo: "no-se-envia", motivo: MOTIVO_CANAL_SIN_ENVIO };
  }
  if (!ventanaDeWhatsappAbierta(finDeVentana, ahora)) {
    return { tipo: "no-se-envia", motivo: MOTIVO_VENTANA_CERRADA };
  }
  return { tipo: "whatsapp" };
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

function esAviso(message: Pick<Message, "senderType" | "content">): boolean {
  return message.senderType === "AUTOMATION" && message.content.startsWith(PREFIJO_DEL_AVISO);
}

// Las dos tareas que cuentan como "la tarea del pedido": la de la derivación
// (crearActivityDeAviso) y la que crea devolver cuando no había ninguna.
function whereTareaDelPedido(organizationId: string, contactId: string) {
  return {
    organizationId,
    contactId,
    type: "TASK" as const,
    deletedAt: null,
    OR: [
      { subject: { startsWith: PREFIJO_TAREA_DE_DERIVACION } },
      {
        subject: {
          startsWith: PREFIJO_TAREA_SIN_RESPUESTA,
          endsWith: SUFIJO_TAREA_SIN_RESPUESTA,
        },
      },
    ],
  };
}

// ¿Hay una tarea del pedido todavía abierta para este contacto? Al devolver:
// si la hay, no se toca ni se crea otra.
export function findTareaAbiertaDelPedido(organizationId: string, contactId: string, db: Db) {
  return db.activity.findFirst({
    where: { ...whereTareaDelPedido(organizationId, contactId), completedAt: null },
    select: { id: true },
  });
}

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
  const admin = await db.user.findFirst({
    where: { organizationId, isActive: true, deletedAt: null, role: { name: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

// La marca del DETALLE: el hilo ya viene entero, así que el aviso y lo que
// vino después salen de ahí; solo la tarea es otra consulta.
export async function pedidoSinResponderDelHilo(
  conversation: {
    organizationId: string;
    contactId: string;
    messages: Pick<Message, "senderType" | "content" | "createdAt">[];
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
      senderType: "AUTOMATION",
      content: { startsWith: PREFIJO_DEL_AVISO },
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
