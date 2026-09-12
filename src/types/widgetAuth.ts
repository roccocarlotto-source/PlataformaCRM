import type { Request } from "express";

// ---------------------------------------------------------------------------
// Contexto del widget del canal Web — el TERCER camino de autenticación
// (docs/ai-agent-architecture.md, nota del paso 5b bajo §6).
//
// DELIBERADAMENTE NO ES AuthContext NI IngestContext, NI LOS EXTIENDE, NI
// COMPARTE NADA CON ELLOS. Mismo razonamiento que types/ingest.ts, aplicado a
// un tercer llamador:
//
//   - No es AuthContext: un embed token no tiene usuario ni rol. Reutilizarlo
//     obligaría a un `userId` falso o nullable, y a partir de ahí cualquier
//     handler que reciba un AuthContext no puede distinguir una sesión de
//     persona de una credencial pública de un sitio ajeno.
//   - No es IngestContext: una API key de ingesta escribe DATOS al CRM
//     (contactos, eventos) con el privilegio de una integración; un embed
//     token solo puede escribir MENSAJES al loop de orquestación de UN agente,
//     y es público por diseño (vive en el JS del sitio del cliente). Compartir
//     el tipo haría que un handler de ingesta aceptara, sin que el compilador
//     diga nada, la credencial de menor privilegio del sistema.
//
// Al ser tres tipos disjuntos, un handler del widget NO COMPILA si intenta
// leer `role`, `userId` o `sourceId`, y ningún handler de negocio ni de
// ingesta compila si recibe un WidgetAuthContext. La garantía es del
// compilador, no de la disciplina. Si alguna vez un handler pareciera
// necesitar dos de los tres a la vez, la ruta está mal ubicada.
//
// SOBRE embedTokenId — misma desviación y mismo motivo que apiKeyId en
// IngestContext: el rate limit del widget cuenta POR TOKEN y corre DESPUÉS de
// authenticateEmbedToken; sin embedTokenId en el contexto, su keyGenerator no
// tendría de dónde sacar la clave de conteo. Es un UUID de fila, NO material
// criptográfico: el secreto nunca entra a este objeto, ni entero ni en parte.
//
// SOBRE branchId — está acá porque el Contact placeholder y la Conversation
// que el endpoint crea cuelgan de la sucursal del agente, y traerlo en el
// mismo round-trip de la autenticación (findEmbedTokenByHash ya lo trae)
// evita una segunda lectura del Agent en cada mensaje.
// ---------------------------------------------------------------------------
export interface WidgetAuthContext {
  organizationId: string;
  agentId: string;
  branchId: string;
  embedTokenId: string;
}

// Para controllers que corren después de `authenticateEmbedToken`: `widgetAuth`
// ya no es opcional. Mismo patrón que AuthenticatedRequest e IngestRequest,
// tipo distinto a propósito.
export interface WidgetRequest extends Request {
  widgetAuth: WidgetAuthContext;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentar Express.Request EXIGE namespace: así lo declaran los propios @types/express y no hay equivalente con módulos ES.
  namespace Express {
    interface Request {
      // Separado de `auth` (types/auth.ts) y de `ingest` (types/ingest.ts) a
      // propósito: tres propiedades distintas porque son tres caminos de
      // autenticación distintos. Ninguna ruta del sistema debería tener más
      // de una definida a la vez.
      widgetAuth?: WidgetAuthContext;
    }
  }
}
