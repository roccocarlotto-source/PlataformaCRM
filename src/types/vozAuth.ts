import type { Request } from "express";
import type { AccesoDeVoz } from "../voz/accesos";

// Lo que deja authenticateVoz: un tipo propio, como WidgetRequest, porque acá
// tampoco hay usuario ni rol. La organización y el agente salen del acceso.
export interface VozRequest extends Request {
  vozAcceso: AccesoDeVoz;
}
