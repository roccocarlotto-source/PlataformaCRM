import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { PageHeader } from "../../design-system/PageHeader";
import { Select } from "../../design-system/Select";
import { formatDateTime } from "../../design-system/detailFormat";
import { usePlatformOrganizations } from "../platformAdmin/queries";
import { InformeDelLote, ProgresoDelLote } from "./InformeDelLote";
import { TIPOS } from "./labels";
import { PasoArchivo } from "./PasoArchivo";
import { PasoMapeo } from "./PasoMapeo";
import { PasoVistaPrevia } from "./PasoVistaPrevia";
import { useFilas, useLote, useLotes, useOpciones } from "./queries";
import type { EstadoDelLote, Lote } from "./types";

// ---------------------------------------------------------------------------
// Plataforma → Importar datos (docs/importacion-de-datos.md §8): el asistente
// con el que el platform admin carga, en el alta de un cliente, lo que ese
// cliente ya tenía en otro sistema. La organización y el lote van en la URL
// (?organizationId=&batchId=): se puede cerrar la pantalla mientras importa y
// volver al mismo punto.
//
// Qué paso se muestra lo decide el ESTADO del lote, no un contador local:
//   STAGED      mapeo y ajustes          RUNNING  progreso
//   ANALYZING   progreso                 DONE     informe
//   READY       vista previa (o volver al mapeo)
// ---------------------------------------------------------------------------

const ESTADO: Record<EstadoDelLote, string> = {
  STAGED: "Sin configurar",
  ANALYZING: "Calculando",
  READY: "Vista previa lista",
  RUNNING: "Importando",
  DONE: "Terminada",
  CANCELLED: "Descartada",
  UNDOING: "Deshaciendo",
  UNDONE: "Deshecha",
};

function LoteEnCurso({
  organizationId,
  batchId,
  sugerido,
  onNueva,
}: {
  organizationId: string;
  batchId: string;
  sugerido: Record<string, string>;
  onNueva: () => void;
}) {
  const detalle = useLote(organizationId, batchId);
  const opciones = useOpciones(organizationId);
  const [editandoMapeo, setEditandoMapeo] = useState(false);
  const estado = detalle.data?.lote.status;
  const necesitaMuestra = estado === "STAGED" || editandoMapeo;
  const muestra = useFilas(organizationId, batchId, { page: 1, pageSize: 50 }, necesitaMuestra);

  if (detalle.isLoading || opciones.isLoading) return <LoadingState />;
  if (detalle.isError || !detalle.data) {
    return (
      <ErrorState onRetry={() => void detalle.refetch()}>
        No pudimos cargar la importación.
      </ErrorState>
    );
  }
  if (opciones.isError || !opciones.data) {
    return (
      <ErrorState onRetry={() => void opciones.refetch()}>
        No pudimos cargar los datos de la organización.
      </ErrorState>
    );
  }
  const { lote } = detalle.data;

  if (lote.status === "STAGED" || (lote.status === "READY" && editandoMapeo)) {
    return (
      <div className="ds-stack">
        {lote.errorMessage ? <Notice tone="danger">{lote.errorMessage}</Notice> : null}
        <PasoMapeo
          organizationId={organizationId}
          lote={lote}
          opciones={opciones.data}
          sugerido={sugerido}
          muestra={(muestra.data?.data ?? []).map((f) => f.rawPayload)}
          onGuardado={() => setEditandoMapeo(false)}
          onCancelar={lote.status === "READY" ? () => setEditandoMapeo(false) : undefined}
        />
      </div>
    );
  }
  if (lote.status === "ANALYZING" || lote.status === "RUNNING" || lote.status === "UNDOING") {
    return <ProgresoDelLote detalle={detalle.data} />;
  }
  if (lote.status === "READY") {
    return (
      <PasoVistaPrevia
        organizationId={organizationId}
        detalle={detalle.data}
        opciones={opciones.data}
        onCambiarMapeo={() => setEditandoMapeo(true)}
      />
    );
  }
  if (lote.status === "DONE") {
    return (
      <InformeDelLote organizationId={organizationId} detalle={detalle.data} onNueva={onNueva} />
    );
  }
  return (
    <Card heading={ESTADO[lote.status]}>
      <div className="ds-card-actions">
        <Button type="button" onClick={onNueva}>
          Nueva importación
        </Button>
      </div>
    </Card>
  );
}

function ImportacionesAnteriores({
  organizationId,
  onAbrir,
}: {
  organizationId: string;
  onAbrir: (lote: Lote) => void;
}) {
  const lotes = useLotes(organizationId);
  if (!lotes.data || lotes.data.data.length === 0) return null;
  return (
    <Card heading="Importaciones anteriores">
      <ul className="ds-stack">
        {lotes.data.data.map((lote) => (
          <li key={lote.id} className="ds-list-card">
            <div className="ds-card-actions">
              <Badge>{ESTADO[lote.status]}</Badge>
              <span>
                {TIPOS.find((t) => t.value === lote.entityType)?.label ?? lote.entityType} ·{" "}
                {lote.fileName ?? "sin nombre"} · {formatDateTime(lote.createdAt)}
              </span>
              <Button type="button" variant="secondary" onClick={() => onAbrir(lote)}>
                Abrir
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ImportarDatosPage() {
  const [params, setParams] = useSearchParams();
  const organizationId = params.get("organizationId") ?? "";
  const batchId = params.get("batchId") ?? "";
  const organizaciones = usePlatformOrganizations();
  const opciones = useOpciones(organizationId);
  // La sugerencia de mapeo solo viene en la respuesta de la subida.
  const [sugerido, setSugerido] = useState<Record<string, string>>({});

  function ir(cambios: { organizationId?: string; batchId?: string }) {
    const siguiente = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) siguiente.set(k, v);
      else siguiente.delete(k);
    }
    setParams(siguiente);
  }

  return (
    <div className="ds-form">
      <PageHeader
        title="Importar datos"
        subtitle="Contactos y empresas de otro sistema, para el alta de un cliente"
      />
      <div className="ds-stack">
        <Card heading="Organización">
          {organizaciones.isLoading ? <LoadingState /> : null}
          {organizaciones.isError ? (
            <ErrorState>No pudimos cargar las organizaciones.</ErrorState>
          ) : null}
          {organizaciones.isSuccess ? (
            <Select
              label="Organización"
              value={organizationId}
              options={organizaciones.data.map((o) => ({
                value: o.id,
                label: o.name,
                subtitle: o.slug,
              }))}
              emptyOption={{ label: "Elegir organización…" }}
              onChange={(id) => ir({ organizationId: id, batchId: "" })}
            />
          ) : null}
        </Card>

        {organizationId && batchId ? (
          <LoteEnCurso
            organizationId={organizationId}
            batchId={batchId}
            sugerido={sugerido}
            onNueva={() => ir({ batchId: "" })}
          />
        ) : null}

        {organizationId && !batchId ? (
          <>
            {opciones.isLoading ? <LoadingState /> : null}
            {opciones.isError ? (
              <ErrorState onRetry={() => void opciones.refetch()}>
                No pudimos cargar los datos de la organización.
              </ErrorState>
            ) : null}
            {opciones.data ? (
              <PasoArchivo
                organizationId={organizationId}
                opciones={opciones.data}
                onSubido={(subida) => {
                  setSugerido(subida.mapeoSugerido);
                  ir({ batchId: subida.lote.id });
                }}
              />
            ) : null}
            <ImportacionesAnteriores
              organizationId={organizationId}
              onAbrir={(lote) => ir({ batchId: lote.id })}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
