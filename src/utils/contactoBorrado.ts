import { AppError } from "./AppError";

// ---------------------------------------------------------------------------
// UN CONTACTO CON LOS DATOS PERSONALES BORRADOS QUEDA EN SOLO LECTURA
// (data-classification.md §5.2, 2026-10-12).
//
// Después del borrado a pedido del titular, la fila sigue (etapa, fechas,
// turnos) pero ya no describe a nadie. Escribirle algo nuevo —editarla,
// marcarla sin interés, darle un cupón, unirla, agendarle un turno, cargarle
// una nota, una tarea o una oportunidad— volvería a meter datos de la persona
// donde se acaban de borrar, o no tendría a quién dirigirse. Todo eso responde
// 409 con este mensaje.
//
// Lo que SIGUE permitido: darlo de baja, repetir el borrado (lo pendiente de
// Google), y cancelar, reprogramar o marcar atendidos sus turnos: son registro
// y no agregan datos. Las tareas que crea el sistema (automatizaciones) tampoco
// pasan por acá: un 409 ahí solo haría que el outbox las reintente.
// ---------------------------------------------------------------------------

export const MENSAJE_CONTACTO_BORRADO =
  "Este contacto tiene los datos personales borrados: queda en solo lectura.";

export function exigirContactoConDatos(contacto: { personalDataErasedAt: Date | null }): void {
  if (contacto.personalDataErasedAt !== null) {
    throw new AppError(MENSAJE_CONTACTO_BORRADO, 409);
  }
}
