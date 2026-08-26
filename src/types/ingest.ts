import type { Request } from "express";

// ---------------------------------------------------------------------------
// Contexto de la ingesta — el SEGUNDO camino de autenticación
// (docs/ingestion-architecture.md §3).
//
// DELIBERADAMENTE NO ES AuthContext, NI LO EXTIENDE, NI COMPARTE NADA CON ÉL.
//
// Una API key no tiene usuario ni rol. Reutilizar AuthContext obligaría a un
// `userId` falso o nullable, y a partir de ahí cualquier handler que reciba un
// AuthContext no puede distinguir una sesión de persona de una credencial de
// máquina — que es exactamente el agujero que después nadie ve (§8, tercer
// ítem de la lista de errores conocidos).
//
// Al ser dos tipos disjuntos, un handler de ingesta NO COMPILA si intenta leer
// `role` o `userId`, y un handler de negocio no compila si recibe un
// IngestContext. La garantía es del compilador, no de la disciplina.
//
// Si alguna vez un handler pareciera necesitar los dos a la vez, eso no es un
// problema de tipos: es señal de que la ruta está mal ubicada. Preguntar antes
// de fusionarlos.
//
// SOBRE apiKeyId — la única desviación respecto del shape literal de §3
// (`{ organizationId, sourceId }`), y está acá porque el rate limit de esta
// misma etapa se define POR CLAVE (no por IP, no por organización) y corre
// DESPUÉS de authenticateApiKey. Sin apiKeyId en el contexto, su keyGenerator
// no tendría de dónde sacar la clave de conteo. La alternativa —colgar
// apiKeyId de `req` por separado— parte en dos algo que es una sola cosa.
//
// apiKeyId es un UUID de fila, NO material criptográfico: no permite derivar
// la clave ni un fragmento suyo. El secreto nunca entra a este objeto, ni
// entero ni en parte.
// ---------------------------------------------------------------------------
export interface IngestContext {
  organizationId: string;
  sourceId: string;
  apiKeyId: string;
}

// Para controllers que corren después de `authenticateApiKey`: `ingest` ya no
// es opcional. Mismo patrón que AuthenticatedRequest, tipo distinto a
// propósito.
export interface IngestRequest extends Request {
  ingest: IngestContext;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentar Express.Request EXIGE namespace: así lo declaran los propios @types/express y no hay equivalente con módulos ES.
  namespace Express {
    interface Request {
      // Separado de `auth` (types/auth.ts) a propósito: son dos propiedades
      // distintas porque son dos caminos de autenticación distintos. Ninguna
      // ruta del sistema debería tener las dos definidas a la vez.
      ingest?: IngestContext;
    }
  }
}
