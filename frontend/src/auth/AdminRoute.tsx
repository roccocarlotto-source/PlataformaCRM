import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useToastSiHay } from "../design-system/useToast";
import { useAuth } from "./AuthContext";
import { esClinica } from "./vocabulario";

// Restricción de UX/autorización visual sobre rutas de escritura de Company
// (create/edit) — vive DENTRO de ProtectedRoute, nunca antes: asume que la
// sesión ya está resuelta (status==="authenticated", `me` poblado).
// La autorización real sigue siendo exclusivamente authorize("ADMIN") en el
// backend; esto solo evita que un USER complete un formulario que el
// backend va a rechazar con 403 recién al guardar.
//
// ISSUE-020 (QA de la primera clínica): en una clínica, Recepción que abre una
// pantalla de configuración (un link guardado, la URL escrita) volvía al
// inicio sin saber por qué. Ahora un aviso lo dice. Solo en una clínica: la
// automotora sigue exactamente como antes (docs/rubros.md §0.3).
export const AVISO_SOLO_ADMIN = "Esa pantalla es solo para administradores.";

export function AdminRoute() {
  const { me } = useAuth();
  const toast = useToastSiHay();
  const rebota = me?.role !== "ADMIN";
  const avisa = rebota && esClinica(me);

  useEffect(() => {
    if (avisa) toast?.show(AVISO_SOLO_ADMIN, { tono: "aviso" });
  }, [avisa, toast]);

  if (rebota) {
    return <Navigate to="/companies" replace />;
  }

  return <Outlet />;
}
