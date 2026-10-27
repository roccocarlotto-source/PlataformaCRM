import { MessagesSquare } from "lucide-react";
import { usePendientesCount } from "../features/conversation/queries";
import { SidebarLink } from "./Sidebar";

// ---------------------------------------------------------------------------
// "Conversaciones" en el menú, de primer nivel y con el número de las que
// esperan a una persona (UX-02 de docs-privados/auditoria-2026-10-21/
// informe-etapa-2.md, local). Antes estaba plegada adentro de Contactos y sin
// número: un mensaje derivado esperaba hasta que alguien se acordara de entrar.
//
// Un solo componente para los dos menús (automotora y clínica). El número lo
// calcula el backend para quien mira (ADMIN, toda la organización; Recepción,
// sus sedes; USER, lo suyo y lo que no tiene a nadie asignado). En la bandeja,
// el filtro "Mis pendientes" muestra exactamente esas conversaciones.
// ---------------------------------------------------------------------------
export function ConversacionesLink() {
  const pendientes = usePendientesCount();
  const total = pendientes.data?.total ?? 0;
  return (
    <SidebarLink
      to={total > 0 ? "/conversations?pendientes=true" : "/conversations"}
      icon={MessagesSquare}
      contador={total}
      contadorLabel={`${total} ${total === 1 ? "pendiente" : "pendientes"}`}
    >
      Conversaciones
    </SidebarLink>
  );
}
