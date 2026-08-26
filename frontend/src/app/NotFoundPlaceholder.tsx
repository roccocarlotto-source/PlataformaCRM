// Vive en su propio archivo, y no es organización por gusto: router.tsx exporta
// `router`, que NO es un componente, así que cualquier componente declarado ahí
// rompe el fast refresh de Vite (react-refresh/only-export-components). Separarlo
// costó un archivo y un import — la alternativa era un disable sobre un aviso que
// tenía razón.
//
// "Placeholder" y público a propósito: un 404 no expone datos de negocio, así que
// no hace falta resolver sesión antes de mostrarlo.
export function NotFoundPlaceholder() {
  return <div>Página no encontrada</div>;
}
