import { useAuth } from "../../auth/AuthContext";
import { Notice } from "../../design-system/Notice";
import { AVISO_SIN_SEDES, sedesDeQuienEntra } from "./sedes";

// El aviso de una Recepción de clínica que no tiene sedes (docs/rubros.md
// §11.5): puede entrar y ver pacientes, pero la agenda, las conversaciones y
// las tareas de sede le llegan vacías. Para cualquier otro usuario no
// renderiza nada.
export function AvisoSinSedes() {
  const { me } = useAuth();
  const sedes = sedesDeQuienEntra(me);
  if (sedes === null || sedes.length > 0) return null;
  return (
    <Notice tone="warning" alert={false}>
      {AVISO_SIN_SEDES}
    </Notice>
  );
}
