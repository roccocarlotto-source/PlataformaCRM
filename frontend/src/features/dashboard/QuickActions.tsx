import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Card } from "../../design-system/Card";

// Mismo booleano ya expuesto por AuthContext que usa AppLayout.tsx — sin
// RBAC nuevo, sin GET /api/users. Las 4 rutas de creación son ADMIN-only
// (AdminRoute en router.tsx); para USER, esta sección directamente no se
// renderiza.
//
// Se ven como botones secundarios pero siguen siendo <Link>: son navegación
// (href real, abrir en otra pestaña, rol "link" para el lector de pantalla),
// no acciones de formulario. Un <Button> con onClick={navigate} perdería
// todo eso. Es el mismo criterio de .ds-link-button para la variante
// primaria ("Nueva empresa" en CompanyListPage); acá se reutilizan las
// clases de .ds-button--secondary directamente.
const ACTIONS: Array<{ to: string; label: string }> = [
  { to: "/companies/new", label: "Nueva empresa" },
  { to: "/contacts/new", label: "Nuevo contacto" },
  { to: "/opportunities/new", label: "Nueva oportunidad" },
  { to: "/activities/new", label: "Nueva actividad" },
];

export function QuickActions() {
  const { me } = useAuth();

  if (me?.role !== "ADMIN") {
    return null;
  }

  return (
    <Card aria-label="Acciones rápidas" heading="Acciones rápidas">
      <nav className="ds-card-actions">
        {ACTIONS.map(({ to, label }) => (
          <Link key={to} to={to} className="ds-button ds-button--secondary">
            {label}
          </Link>
        ))}
      </nav>
    </Card>
  );
}
