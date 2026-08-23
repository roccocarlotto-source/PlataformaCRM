import type { ReactNode } from "react";

export interface TableProps {
  children: ReactNode;
}

// R1.1 — envoltura puramente visual: cada ListPage sigue armando su propio
// <thead>/<tbody> con sus columnas (no se generaliza a un <Table
// columns={...} data={...}>, que reescribiría la lógica de render de las 8
// pantallas para un punto del Roadmap A que solo pide consistencia visual,
// no esa refactorización). El wrapper con overflow-x:auto es lo que
// permite que una tabla ancha haga scroll horizontal propio en vez de
// desbordar la página — real gap de las tablas actuales, sin solución hoy.
export function Table({ children }: TableProps) {
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">{children}</table>
    </div>
  );
}
