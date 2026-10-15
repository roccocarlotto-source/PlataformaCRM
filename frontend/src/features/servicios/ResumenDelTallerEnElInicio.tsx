import { Link } from "react-router-dom";
import { Card } from "../../design-system/Card";
import { useResumenDelTaller } from "./queries";

// ---------------------------------------------------------------------------
// El bloque del taller en el inicio (docs/servicios.md §4.7, S11): solo los
// totales de las tres primeras tarjetas y el link al resumen, donde están las
// listas (decisión de Rocco, 2026-10-15). Lo monta DashboardPage SOLO con el
// módulo Servicios: sin él, el inicio no cambia.
// ---------------------------------------------------------------------------

export function ResumenDelTallerEnElInicio() {
  const resumen = useResumenDelTaller();
  const totales = resumen.data
    ? [
        { label: "Autos en el taller", valor: resumen.data.enElTaller.total },
        { label: "Listos para retirar", valor: resumen.data.listosParaRetirar.total },
        {
          label: "Esperando aprobación hace más de 24 h",
          valor: resumen.data.esperandoAprobacion.total,
        },
      ]
    : null;

  return (
    <Card heading="Taller">
      {resumen.isLoading ? <p className="ds-hint">Cargando…</p> : null}
      {resumen.isError ? <p role="alert">No pudimos cargar el resumen del taller.</p> : null}
      {totales ? (
        <dl className="ds-card-grid">
          {totales.map(({ label, valor }) => (
            <div key={label} className="ds-kpi">
              <dt className="ds-kpi-label">{label}</dt>
              <dd className="ds-kpi-value">{valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p>
        <Link to="/taller">Ver el resumen del taller</Link>
      </p>
    </Card>
  );
}
