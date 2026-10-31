import { formatDateTime } from "../../design-system/detailFormat";
import { ErrorState } from "../../design-system/ErrorState";
import { useEstadoDelTokenDeWhatsapp } from "./queries";

// OPS-03: Meta rechaza el token de WhatsApp de la plataforma (código 190). Es
// uno solo para todas las organizaciones que usan la conexión global, y lo
// renueva el platform admin: por eso el aviso con qué hacer va acá. Las
// organizaciones afectadas ven el suyo en Configuración.
export function AvisoDelTokenDeWhatsapp() {
  const estado = useEstadoDelTokenDeWhatsapp();
  const desde = estado.data?.invalidoDesde;
  if (!desde) return null;
  return (
    <ErrorState>
      Meta rechaza el token de WhatsApp de la plataforma (WHATSAPP_ACCESS_TOKEN) desde el{" "}
      {formatDateTime(desde)}: no sale ningún WhatsApp de las organizaciones que usan la conexión
      global. Generá uno nuevo en Meta y cargalo en Render.
    </ErrorState>
  );
}
