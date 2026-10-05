import type { Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// "La tarea del pedido": la tarea que le dice a una persona del equipo que un
// cliente está esperando que lo atiendan. Hay dos, y se reconocen por el
// asunto porque Activity no guarda a qué conversación pertenece (solo
// contactId):
//   - la de una derivación del agente (crearActivityDeAviso);
//   - la que se crea al devolver al agente —a mano o por el aviso automático—
//     una conversación a la que nadie respondió.
//
// Vive en su propio archivo porque la usan los dos lados: la derivación
// (agentOrchestration.service.ts) para no crear otra si ya hay una abierta
// (FABLE-I-05 de docs-privados/auditoria-2026-10-05-FABLE.md, local), y el
// aviso sin respuesta (avisoSinRespuesta.service.ts) para la marca y para no
// duplicarla al devolver.
// ---------------------------------------------------------------------------

// El comienzo del asunto de la tarea de una derivación del agente.
export const PREFIJO_TAREA_DE_DERIVACION = "Conversación derivada por el agente ";

export const PREFIJO_TAREA_SIN_RESPUESTA = "Contactar a ";
export const SUFIJO_TAREA_SIN_RESPUESTA = ": pidió hablar con una persona y nadie respondió";

export function whereTareaDelPedido(organizationId: string, contactId: string) {
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

// ¿Hay una tarea del pedido todavía abierta para este contacto? Si la hay, ni
// la derivación ni la devolución crean otra.
export function findTareaAbiertaDelPedido(organizationId: string, contactId: string, db: Db) {
  return db.activity.findFirst({
    where: { ...whereTareaDelPedido(organizationId, contactId), completedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}
