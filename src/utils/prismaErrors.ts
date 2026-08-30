import { Prisma } from "@prisma/client";
import { AppError } from "./AppError";

// ---------------------------------------------------------------------------
// Los códigos de error de Prisma que se traducen CENTRALMENTE, en errorHandler
// — M-11 (c) de docs/auditoria-2026-08-29.md.
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
// ---------------------------------------------------------------------------

export function traducirErrorDePrisma(err: unknown): AppError | undefined {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }

  switch (err.code) {
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
