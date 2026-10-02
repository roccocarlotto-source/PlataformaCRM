import { Navigate, useParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// /whatsapp-template y /whatsapp-template/:automationId eran la pantalla
// "Plantillas de WhatsApp" (ítems 160 y 181). Se retiró: la plantilla se arma
// sola al guardar la regla y su estado se ve en el formulario de la regla.
// Las rutas quedan como redirecciones para que un link o un marcador viejo
// lleve a donde ahora vive lo mismo: la lista de automatizaciones, o la regla.
// ---------------------------------------------------------------------------
export function WhatsappTemplateRedirect() {
  const { automationId } = useParams<{ automationId?: string }>();
  return (
    <Navigate to={automationId ? `/automations/${automationId}/edit` : "/automations"} replace />
  );
}
