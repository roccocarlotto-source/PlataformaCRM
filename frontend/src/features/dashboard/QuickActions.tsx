import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

// Mismo booleano ya expuesto por AuthContext que usa AppLayout.tsx — sin
// RBAC nuevo, sin GET /api/users. Las 4 rutas de creación son ADMIN-only
// (AdminRoute en router.tsx); para USER, esta sección directamente no se
// renderiza.
export function QuickActions() {
  const { me } = useAuth();

  if (me?.role !== "ADMIN") {
    return null;
  }

  return (
    <section aria-label="Acciones rápidas">
      <h2>Acciones rápidas</h2>
      <nav>
        <Link to="/companies/new">Nueva empresa</Link>
        <Link to="/contacts/new">Nuevo contacto</Link>
        <Link to="/opportunities/new">Nueva oportunidad</Link>
        <Link to="/activities/new">Nueva actividad</Link>
      </nav>
    </section>
  );
}
