import { SearchX } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../design-system/EmptyState";
import { AuthShell } from "../features/auth/AuthShell";

// Vive en su propio archivo, y no es organización por gusto: router.tsx exporta
// `router`, que NO es un componente, así que cualquier componente declarado ahí
// rompe el fast refresh de Vite (react-refresh/only-export-components). Separarlo
// costó un archivo y un import — la alternativa era un disable sobre un aviso que
// tenía razón.
//
// "Placeholder" y público a propósito: un 404 no expone datos de negocio, así que
// no hace falta resolver sesión antes de mostrarlo.
//
// La tarjeta centrada de AuthShell y no el shell de la app: la ruta `*` está
// fuera de ProtectedRoute, así que puede verla alguien sin sesión. "Ir al
// inicio" lleva a "/", que a su vez manda a /login si no hay sesión.
export function NotFoundPlaceholder() {
  return (
    <AuthShell>
      <EmptyState
        title="Página no encontrada"
        icon={SearchX}
        action={
          <Link className="ds-link-button" to="/">
            Ir al inicio
          </Link>
        }
      >
        La dirección que abriste no existe o cambió.
      </EmptyState>
    </AuthShell>
  );
}
