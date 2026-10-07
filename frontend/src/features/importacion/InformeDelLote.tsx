import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "../../design-system/useConfirm";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { Spinner } from "../../design-system/Spinner";
import { guardarArchivo } from "../../lib/guardarArchivo";
import { descargarCsv, deshacerLote } from "./api";
import { importacionKeys } from "./queries";
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
  if (lote.status === "UNDOING") {
    return (
      <Card heading="Deshaciendo">
        <p role="status">
          <Spinner size="sm" /> Dando de baja lo que creó esta importación…
        </p>
      </Card>
    );
  }
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

const TIPO_EN_PLURAL: Record<string, string> = {
  CONTACT: "contactos",
  COMPANY: "empresas",
  ACTIVITY: "actividades",
  VEHICLE: "vehículos",
};
const TIPO_EN_SINGULAR: Record<string, string> = {
  CONTACT: "Contacto",
  COMPANY: "Empresa",
  ACTIVITY: "Actividad",
  VEHICLE: "Vehículo",
};

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
  const fotos = detalle.fotos ?? null;
  const fotosConProblemas = (fotos?.FAILED ?? 0) + (fotos?.SKIPPED ?? 0);

  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const deshacer = useMutation({
    mutationFn: () => deshacerLote(organizationId, lote.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: importacionKeys.all }),
  });
  const deshecho = lote.counters?.deshacer;

  async function alDeshacer() {
    const ok = await confirm(
      "Se dan de baja los registros que creó esta importación. Lo que ya tuvo uso en el CRM (una conversación, una oportunidad, una nota cargada a mano) se deja y se informa. Lo que la importación actualizó no se revierte.",
      { confirmLabel: "Deshacer", danger: true },
    );
    if (ok) deshacer.mutate();
  }

  const descarga = useMutation({
    mutationFn: async (cual: "failed" | "changes" | "photos") => {
      const blob = await descargarCsv(organizationId, lote.id, cual);
      const nombres = {
        failed: "filas-fallidas.csv",
        changes: "cambios.csv",
        photos: "fotos-no-bajadas.csv",
      };
      guardarArchivo(blob, nombres[cual]);
    },
  });

  return (
    <Card heading={lote.status === "UNDONE" ? "Informe (deshecha)" : "Informe"}>
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
      {fotos ? (
        <p role="status">
          Fotos: {fotos.DONE ?? 0} bajadas
          {(fotos.PENDING ?? 0) > 0 ? `, ${String(fotos.PENDING)} bajándose` : ""}
          {fotosConProblemas > 0 ? `, ${String(fotosConProblemas)} sin bajar` : ""}.
        </p>
      ) : null}
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
      {deshecho ? (
        <div className="ds-stack">
          <p>
            Se dieron de baja{" "}
            {Object.entries(deshecho.borrados)
              .map(([tipo, n]) => `${n} ${TIPO_EN_PLURAL[tipo] ?? tipo}`)
              .join(", ") || "0 registros"}
            . {deshecho.totalOmitidos > 0 ? `Se dejaron ${deshecho.totalOmitidos}:` : ""}
          </p>
          {deshecho.omitidos.length > 0 ? (
            <ul className="ds-stack">
              {deshecho.omitidos.map((o) => (
                <li key={o.id} className="ds-hint">
                  {TIPO_EN_SINGULAR[o.tipo] ?? o.tipo} {o.id.slice(0, 8)}: {o.motivo}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {lote.errorMessage ? <ErrorState>{lote.errorMessage}</ErrorState> : null}
      {deshacer.isError ? (
        <ErrorState>
          No pudimos deshacer
          {deshacer.error instanceof Error ? `: ${deshacer.error.message}` : "."}
        </ErrorState>
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
        {fotosConProblemas > 0 ? (
          <Button type="button" variant="secondary" onClick={() => descarga.mutate("photos")}>
            Descargar fotos sin bajar
          </Button>
        ) : null}
        <Button type="button" onClick={onNueva}>
          Nueva importación
        </Button>
        {lote.status === "DONE" ? (
          <Button
            type="button"
            variant="danger"
            loading={deshacer.isPending}
            onClick={() => void alDeshacer()}
          >
            Deshacer lo creado
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
