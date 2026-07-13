import { createBrowserRouter } from "react-router-dom";

// Placeholders puramente de M0: prueban que el router matchea una ruta
// exacta y el fallback, nada más. M1+ los reemplaza por pantallas reales
// (LoginPage, DashboardPage, etc.) bajo src/features/.
function HomePlaceholder() {
  return <div>Plataforma CRM</div>;
}

function NotFoundPlaceholder() {
  return <div>Página no encontrada</div>;
}

export const router = createBrowserRouter([
  { path: "/", element: <HomePlaceholder /> },
  { path: "*", element: <NotFoundPlaceholder /> },
]);
