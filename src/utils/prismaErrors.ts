import { Prisma } from "@prisma/client";
import { AppError } from "./AppError";

// ---------------------------------------------------------------------------
// Los códigos de error de Prisma que se traducen CENTRALMENTE, en errorHandler
// — M-11 (c) de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub).
//
// POR QUÉ ESTOS TRES ACÁ Y P2002 NO. P2002 (constraint única violada) se
// traduce por servicio, cerca de cada escritura (pipeline.service,
// contact.service, stage.service, activity.service, onboarding.service), y
// tiene que ser así: el mensaje correcto depende de CUÁL constraint de negocio
// se violó —"ya existe un contacto con ese email" vs "ya existe una
// organización con ese nombre"— y eso solo lo sabe el servicio que hizo el
// insert. P2034, P2028 y P2003 son distintos: genéricos, transversales, no
// atados a una constraint nombrada; pueden pasar en cualquier escritura de
// cualquier servicio y ningún servicio individual tiene un mensaje mejor que
// el genérico. Sin esta traducción, quien los producía recibía un 500 con el
// mensaje crudo de Prisma —columnas, constraints, tablas: detalle interno.
//
// NO ES UN FALLBACK PARA LOS DEMÁS CÓDIGOS. Un P2002 (o cualquier otro) que
// llegue sin haber sido atrapado por su servicio sigue cayendo al 500 genérico
// de siempre, a propósito: devolver undefined es la forma de decir "de este no
// sé nada".
//
// ESTA TRADUCCIÓN TAMBIÉN CIERRA V-6 de docs-privados/auditoria-2026-08-29.md (local, no está en GitHub), y lo
// cierra sin que nadie haya tocado ningún lock. V-6 señalaba que toda
// $transaction de los services usa el timeout por defecto de Prisma (5 s) —
// sigue siendo así: solo outboxWorker.ts y el lote de importación lo ajustan—
// y que, bajo un lock de fila (lockOrganizationForUpdate, lockResourceForUpdate,
// etc.), una operación lenta hace que la siguiente venza con P2028 "→ 500 sin
// mensaje". Esa consecuencia dejó de ser cierta con M-11: el engine emite P2028
// justamente para la transacción expirada ("Transaction already closed: …
// expired transaction. The timeout for this transaction was N ms", verificado
// en el query engine de Prisma 5.22.0), y P2028 sale de acá como el 409 de
// arriba, con mensaje de reintento e isOperational, así que el cliente lo ve
// tal cual. Los catch de P2002 de los services relanzan todo lo demás, así
// que ningún P2028 se pierde en el camino. Lo fija errorHandler.test.ts (c).
// Ajustar el timeout por sitio sigue siendo posible si el volumen algún día lo
// pide; hoy no hay motivo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LA BASE NO RESPONDE. No es un error del request ni un bug: la base está
// caída, no se llega o cortó la conexión. Para el que llama es un 503 con
// Retry-After (reintentar más tarde tiene sentido), y para los workers es la
// señal de frenar hasta que vuelva (ver workers/esperaDeLaBase.ts).
//
// PrismaClientInitializationError es el cliente que no pudo conectarse al
// primer uso. P1001 (no se llega), P1002 (se llegó pero no respondió a
// tiempo), P1008 (la operación venció) y P1017 (el servidor cerró la
// conexión) son los mismos casos con el cliente ya conectado.
// ---------------------------------------------------------------------------
const CODIGOS_DE_CONEXION = new Set(["P1001", "P1002", "P1008", "P1017"]);

export function esErrorDeConexionALaBase(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  return err instanceof Prisma.PrismaClientKnownRequestError && CODIGOS_DE_CONEXION.has(err.code);
}

// Segundos que el 503 le sugiere esperar al cliente antes de reintentar.
export const REINTENTAR_DESPUES_DE_SEGUNDOS = 30;

export class BaseNoDisponibleError extends AppError {
  constructor() {
    super("El servicio no está disponible en este momento. Reintentá en unos segundos.", 503);
    Object.setPrototypeOf(this, BaseNoDisponibleError.prototype);
  }
}

export function traducirErrorDePrisma(err: unknown): AppError | undefined {
  if (esErrorDeConexionALaBase(err)) {
    return new BaseNoDisponibleError();
  }
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }

  switch (err.code) {
    // El pool de conexiones no dio una a tiempo: la base está saturada o
    // lenta. Para el que llama es lo mismo que la base caída (reintentar más
    // tarde), pero NO frena a los workers: no está caída.
    case "P2024":
      return new BaseNoDisponibleError();
    // Deadlock / write conflict detectado por Postgres, y transacción
    // interactiva expirada: reintentar la misma operación tiene sentido real.
    // El request no está mal armado.
    case "P2034":
    case "P2028":
      return new AppError("Hubo un conflicto temporal al procesar la operación. Reintentá.", 409);
    // Foreign key violada: el llamador referenció un id que no existe. Error
    // suyo, no transitorio.
    case "P2003":
      return new AppError("La operación hace referencia a un recurso que no existe.", 400);
    default:
      return undefined;
  }
}
