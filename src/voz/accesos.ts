import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Quién puede pedir turnos de voz. La plataforma de voz manda un secreto por
// agente en `Authorization: Bearer`, y acá se guarda solo su hash (mismo
// criterio que las API keys): con el hash no se puede llamar al endpoint.
//
// PROTOTIPO SIN TABLA: los accesos viven en VOZ_ACCESOS (config/env.ts), un
// JSON con una entrada por número. La organización y el agente salen de acá,
// nunca del cuerpo del request; la sucursal, del agente. Cuando haya más de un
// cliente, esto pasa a una tabla sin cambiar quién lo usa.
//
// Este archivo no importa env: env.ts lo usa para rechazar un JSON roto al
// arrancar, y no al primer llamado.
// ---------------------------------------------------------------------------

const accesosSchema = z.array(
  z.object({
    hash: z.string().regex(/^[0-9a-f]{64}$/, "hash tiene que ser un SHA-256 en hexadecimal"),
    organizationId: z.string().guid(),
    agentId: z.string().guid(),
    numero: z.string().min(1),
  }),
);

export type AccesoDeVoz = z.infer<typeof accesosSchema>[number];

// Lanza si el texto no es la lista esperada.
export function leerAccesosDeVoz(texto: string): AccesoDeVoz[] {
  return accesosSchema.parse(JSON.parse(texto));
}

// El hash de los bytes exactos que llegan, sin trim ni normalización.
export function hashDelSecretoDeVoz(secreto: string): string {
  return createHash("sha256").update(secreto, "utf8").digest("hex");
}

// Recorre TODOS los accesos y compara en tiempo constante, así el tiempo de
// respuesta no dice cuánto se parecía el secreto ni cuántos accesos hay antes.
export function buscarAccesoDeVoz(
  accesos: readonly AccesoDeVoz[],
  secreto: string,
): AccesoDeVoz | null {
  const hash = Buffer.from(hashDelSecretoDeVoz(secreto), "hex");
  let encontrado: AccesoDeVoz | null = null;
  for (const acceso of accesos) {
    if (timingSafeEqual(hash, Buffer.from(acceso.hash, "hex"))) {
      encontrado = acceso;
    }
  }
  return encontrado;
}
