import { useMutation } from "@tanstack/react-query";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { Spinner } from "../../design-system/Spinner";
import { guardarArchivo } from "../../lib/guardarArchivo";
import { descargarCsv } from "./api";
import { RESULTADOS } from "./labels";
import type { DetalleDelLote } from "./types";

// ---------------------------------------------------------------------------
// El progreso (vista previa o importación corriendo en segundo plano) y el
// informe final (docs/importacion-de-datos.md §8.1, paso 8): creados,
// actualizados, sin cambios, omitidos y fallidos, con el CSV de las filas
// fallidas para corregir y volver a subir y el de los cambios hechos.
// ---------------------------------------------------------------------------

export function ProgresoDelLote({ detalle }: { detalle: DetalleDelLote }) {
  const { lote, resumen } = detalle;
  if (lote.status === "ANALYZING") {
    return (
      <Card heading="Calculando la vista previa">
        <p role="status">
          <Spinner size="sm" /> Revisando las {lote.rowCount} filas contra lo que ya hay en el CRM…
        </p>
      </Card>
    );
  }
  const hechas = (resumen.porEstado.PROCESSED ?? 0) + (resumen.porEstado.FAILED ?? 0);
  return (
    <Card heading="Importando">
      <p role="status">
        <Spinner size="sm" /> {hechas} de {resumen.total} filas. Corre en segundo plano: se puede
        cerrar esta pantalla y volver más tarde.
      </p>
    </Card>
  );
}

export function InformeDelLote({
  organizationId,
  detalle,
  onNueva,
}: {
  organizationId: string;
  detalle: DetalleDelLote;
  onNueva: () => void;
}) {
  const { lote } = detalle;
  const resumen = lote.counters?.final ?? detalle.resumen;
  const fallidas = resumen.porEstado.FAILED ?? 0;
  const actualizadas = resumen.porResultado.UPDATED ?? 0;

  const descarga = useMutation({
    mutationFn: async (cual: "failed" | "changes") => {
      const blob = await descargarCsv(organizationId, lote.id, cual);
      guardarArchivo(blob, cual === "failed" ? "filas-fallidas.csv" : "cambios.csv");
    },
  });

  return (
    <Card heading="Informe">
      <div className="ds-kpi-row">
        {Object.entries(RESULTADOS).map(([clave, label]) => (
          <div key={clave} className="ds-kpi">
            <span className="ds-kpi-label">{label}</span>
            <span className="ds-kpi-value">{resumen.porResultado[clave] ?? 0}</span>
          </div>
        ))}
        <div className="ds-kpi">
          <span className="ds-kpi-label">Fallidas</span>
          <span className="ds-kpi-value">{fallidas}</span>
        </div>
      </div>
      {fallidas > 0 ? (
        <p className="ds-hint">
          El CSV de fallidas trae las columnas originales y el motivo de cada fila: se corrige y se
          vuelve a subir con el mismo sistema de origen.
        </p>
      ) : null}
      {actualizadas > 0 ? (
        <p className="ds-hint">
          Lo actualizado no se deshace: el CSV de cambios trae el antes y el después de cada campo.
        </p>
      ) : null}
      {descarga.isError ? (
        <ErrorState>
          No pudimos descargar el archivo
          {descarga.error instanceof Error ? `: ${descarga.error.message}` : "."}
        </ErrorState>
      ) : null}
      <div className="ds-card-actions">
        {fallidas > 0 ? (
          <Button type="button" variant="secondary" onClick={() => descarga.mutate("failed")}>
            Descargar filas fallidas
          </Button>
        ) : null}
        {actualizadas > 0 ? (
          <Button type="button" variant="secondary" onClick={() => descarga.mutate("changes")}>
            Descargar cambios
          </Button>
        ) : null}
        <Button type="button" onClick={onNueva}>
          Nueva importación
        </Button>
      </div>
    </Card>
  );
}
