import { AppError } from "./AppError";

// ---------------------------------------------------------------------------
// Un entrante de WhatsApp, Messenger o Instagram que no se pudo guardar:
// ¿Meta tiene que volver a mandarlo? (FABLE-C-01 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local.)
//
// Antes el webhook contestaba 200 siempre: si la base no respondía —un
// arranque en frío, el pool agotado, un timeout— el mensaje se contaba como
// "fallido" en un log, Meta lo daba por entregado y no quedaba ni el Message
// ni el job. Ahora ese fallo hace que el webhook conteste 503 y Meta reintenta
// el lote; los mensajes del lote que sí se guardaron caen en el dedup por
// wamid/mid, así que la reentrega no duplica nada.
//
// LO QUE NO SE REINTENTA: un AppError operacional de 4xx es una regla de
// negocio que dijo que no, y va a decir lo mismo en cada reentrega. Pedirle a
// Meta que insista con eso solo deja el lote rebotando hasta que Meta lo
// descarte. Todo lo demás (la base, la red, un bug) se reintenta: perder el
// mensaje de un cliente es peor que recibir dos veces un lote.
// ---------------------------------------------------------------------------
export function esFalloReintentable(err: unknown): boolean {
  return !(err instanceof AppError && err.isOperational && err.statusCode < 500);
}

// El status con el que el webhook le pide a Meta que reintente.
export const STATUS_PARA_QUE_META_REINTENTE = 503;
