import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { useConfirm } from "../../design-system/useConfirm";
import { cancelarLote, configurarLote, confirmarLote, decidirFilas } from "./api";
import { ACCION, ORDEN_DE_PLANES, PLAN, POLITICAS, etiquetaDeCampo, textoDeValor } from "./labels";
import { importacionKeys, useFilas } from "./queries";
import type {
  DetalleDelLote,
  FilaDelLote,
  OpcionesDeImportacion,
  Politica,
  TipoDePlan,
  TipoImportable,
} from "./types";

// ---------------------------------------------------------------------------
// Pasos 5 a 7 del asistente (docs/importacion-de-datos.md §8.1): qué se crea,
// qué se actualiza, qué choca y qué falla, fila por fila y por qué; la
// decisión por fila en los choques; y confirmar. Las filas van como tarjetas,
// no como tabla: en el celular una tabla de 10 columnas no se lee.
// ---------------------------------------------------------------------------

const POR_PAGINA = 20;

// Lo que identifica a la fila a simple vista: el nombre y el email, según
// el mapeo, o las dos primeras columnas.
function resumenDeFila(fila: FilaDelLote, mapeo: Record<string, string>): string {
  const columna = (destino: string) => Object.entries(mapeo).find(([, d]) => d === destino)?.[0];
  const valor = (destino: string) => {
    const c = columna(destino);
    const v = c ? fila.rawPayload[c] : null;
    return v === null || v === undefined || String(v).trim() === "" ? null : String(v);
  };
  const nombre =
    valor("fullName") ??
    valor("name") ??
    valor("subject") ??
    ([valor("make"), valor("model"), valor("year")].filter(Boolean).join(" ") || null) ??
    valor("body") ??
    ([valor("firstName"), valor("lastName")].filter(Boolean).join(" ") || null);
  const extra =
    valor("email") ??
    valor("contactEmail") ??
    valor("contactExternalId") ??
    valor("stockCode") ??
    valor("licensePlate") ??
    valor("externalId");
  const partes = [nombre, extra].filter((p): p is string => p !== null);
  if (partes.length > 0) return partes.join(" · ");
  return Object.values(fila.rawPayload)
    .slice(0, 2)
    .map((v) => textoDeValor(v))
    .join(" · ");
}

const DECISIONES = [{ value: "LOTE" as const, label: "La del lote" }, ...POLITICAS];

function TarjetaDeFila({
  fila,
  tipo,
  mapeo,
  opciones,
  onDecidir,
  decidiendo,
}: {
  fila: FilaDelLote;
  tipo: TipoImportable;
  mapeo: Record<string, string>;
  opciones: OpcionesDeImportacion;
  onDecidir: (decision: Politica | null) => void;
  decidiendo: boolean;
}) {
  const plan = fila.plan;
  if (!plan) return null;
  const cambios = (plan.cambios ?? []).filter((c) => c.accion !== "igual");
  const decidible = plan.existenteId !== undefined;
  return (
    <li className="ds-list-card">
      <div className="ds-stack">
        <div className="ds-card-actions">
          <Badge variant={PLAN[plan.tipo].variant}>{PLAN[plan.tipo].label}</Badge>
          <strong>
            Fila {fila.rowNumber ?? "?"}: {resumenDeFila(fila, mapeo)}
          </strong>
        </div>
        {(plan.errores ?? []).map((e) => (
          <p key={e} className="ds-hint" role="alert">
            {e}
          </p>
        ))}
        {plan.advertencias.map((a) => (
          <p key={a} className="ds-hint">
            {a}
          </p>
        ))}
        {plan.empresaNueva ? (
          <p className="ds-hint">Se crea la empresa «{plan.empresaNueva}».</p>
        ) : null}
        {cambios.length > 0 ? (
          <ul className="ds-stack">
            {cambios.map((c) => (
              <li key={c.campo}>
                <strong>{etiquetaDeCampo(tipo, c.campo, opciones.camposPersonalizados)}</strong> —{" "}
                {ACCION[c.accion]}: en el CRM «{textoDeValor(c.actual)}», en el archivo «
                {textoDeValor(c.entrante)}»{c.motivo ? ` (${c.motivo})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {decidible ? (
          <Select
            label={`Qué hacer con la fila ${fila.rowNumber ?? ""}`}
            value={fila.decision ?? "LOTE"}
            options={DECISIONES}
            disabled={decidiendo}
            onChange={(v) => {
              if (v) onDecidir(v === "LOTE" ? null : v);
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

export function PasoVistaPrevia({
  organizationId,
  detalle,
  opciones,
  onCambiarMapeo,
}: {
  organizationId: string;
  detalle: DetalleDelLote;
  opciones: OpcionesDeImportacion;
  onCambiarMapeo: () => void;
}) {
  const { lote, resumen } = detalle;
  const tipo = lote.entityType as TipoImportable;
  const ajustes = lote.config.ajustes;
  const mapeo = ajustes?.mapeo ?? {};
  const [pestana, setPestana] = useState<TipoDePlan | undefined>(undefined);
  const [page, setPage] = useState(1);
  const filas = useFilas(organizationId, lote.id, { tipo: pestana, page, pageSize: POR_PAGINA });
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const refrescar = () => queryClient.invalidateQueries({ queryKey: importacionKeys.all });

  const decidir = useMutation({
    mutationFn: ({ rowId, decision }: { rowId: string; decision: Politica | null }) =>
      decidirFilas(organizationId, lote.id, [rowId], decision),
    onSuccess: refrescar,
  });
  // "Mantener sincronizado cada N horas" (§7): solo un lote de stock que vino
  // de un link de Google Sheets. Apagada por defecto, 6 h sugeridas.
  const sincronizable = lote.originKind === "GOOGLE_SHEETS_LINK";
  const [sincronizar, setSincronizar] = useState(false);
  const [horas, setHoras] = useState("6");
  const [marcarFaltantes, setMarcarFaltantes] = useState(false);
  const horasValidas =
    Number.isInteger(Number(horas)) && Number(horas) >= 1 && Number(horas) <= 168;
  const confirmar = useMutation({
    mutationFn: () =>
      confirmarLote(
        organizationId,
        lote.id,
        sincronizable && sincronizar
          ? { intervalHours: Number(horas), marcarFaltantes }
          : undefined,
      ),
    onSuccess: refrescar,
  });
  const cancelar = useMutation({
    mutationFn: () => cancelarLote(organizationId, lote.id),
    onSuccess: refrescar,
  });
  const sinEmpresas = useMutation({
    mutationFn: () => {
      if (!ajustes) throw new Error("Sin ajustes");
      return configurarLote(organizationId, lote.id, { ...ajustes, crearEmpresas: false });
    },
    onSuccess: refrescar,
  });

  const empresasNuevas = lote.counters?.analisis?.empresasNuevas ?? 0;
  const conteo = (t: TipoDePlan) => resumen.porPlan[t] ?? 0;
  const totalPaginas = Math.max(1, Math.ceil((filas.data?.total ?? 0) / POR_PAGINA));

  async function alConfirmar() {
    const texto =
      `Se van a crear ${conteo("CREATE")}, actualizar ${conteo("UPDATE") + conteo("CONFLICT")} ` +
      `y van a fallar ${conteo("FAIL")} filas. Corre en segundo plano y se puede cerrar esta pantalla.`;
    if (await confirm(texto, { confirmLabel: "Importar" })) confirmar.mutate();
  }

  async function alCancelar() {
    if (
      await confirm("Se descarta este archivo y no se importa nada.", {
        confirmLabel: "Descartar",
        danger: true,
      })
    ) {
      cancelar.mutate();
    }
  }

  return (
    <div className="ds-stack">
      <Card heading="Vista previa">
        <div className="ds-kpi-row">
          {ORDEN_DE_PLANES.map((t) => (
            <div key={t} className="ds-kpi">
              <span className="ds-kpi-label">{PLAN[t].label}</span>
              <span className="ds-kpi-value">{conteo(t)}</span>
            </div>
          ))}
        </div>
        {empresasNuevas > 0 && ajustes?.crearEmpresas ? (
          <Notice title={`Se crearán ${empresasNuevas} empresas`}>
            <p>
              {(lote.counters?.analisis?.ejemplosDeEmpresasNuevas ?? []).join(", ")}
              {empresasNuevas > (lote.counters?.analisis?.ejemplosDeEmpresasNuevas.length ?? 0)
                ? "…"
                : ""}
            </p>
            <Button
              type="button"
              variant="secondary"
              loading={sinEmpresas.isPending}
              onClick={() => sinEmpresas.mutate()}
            >
              No crear empresas
            </Button>
          </Notice>
        ) : null}
        <div className="ds-card-actions" role="group" aria-label="Filtrar filas">
          <Button
            type="button"
            variant={pestana === undefined ? "primary" : "secondary"}
            aria-pressed={pestana === undefined}
            onClick={() => {
              setPestana(undefined);
              setPage(1);
            }}
          >
            Todas ({resumen.total})
          </Button>
          {ORDEN_DE_PLANES.filter((t) => conteo(t) > 0).map((t) => (
            <Button
              key={t}
              type="button"
              variant={pestana === t ? "primary" : "secondary"}
              aria-pressed={pestana === t}
              onClick={() => {
                setPestana(t);
                setPage(1);
              }}
            >
              {PLAN[t].label} ({conteo(t)})
            </Button>
          ))}
        </div>
        {filas.isLoading ? <LoadingState variant="rows" /> : null}
        {filas.isError ? (
          <ErrorState onRetry={() => void filas.refetch()}>No pudimos cargar las filas.</ErrorState>
        ) : null}
        {filas.data && filas.data.data.length === 0 ? <EmptyState>No hay filas.</EmptyState> : null}
        {filas.data ? (
          <ol className="ds-stack">
            {filas.data.data.map((fila) => (
              <TarjetaDeFila
                key={fila.id}
                fila={fila}
                tipo={tipo}
                mapeo={mapeo}
                opciones={opciones}
                decidiendo={decidir.isPending}
                onDecidir={(decision) => decidir.mutate({ rowId: fila.id, decision })}
              />
            ))}
          </ol>
        ) : null}
        {totalPaginas > 1 ? (
          <Pagination
            page={page}
            totalPages={totalPaginas}
            onPrevious={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPaginas, p + 1))}
          />
        ) : null}
      </Card>
      {sincronizable ? (
        <Card heading="Sincronización">
          <FormField label="Mantener sincronizado con la planilla">
            <input
              type="checkbox"
              checked={sincronizar}
              onChange={(e) => setSincronizar(e.target.checked)}
            />
          </FormField>
          {sincronizar ? (
            <>
              <FormField label="Cada cuántas horas (entre 1 y 168)">
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={horas}
                  onChange={(e) => setHoras(e.target.value)}
                />
              </FormField>
              <FormField label="Pasar a No disponible las unidades que desaparezcan de la planilla">
                <input
                  type="checkbox"
                  checked={marcarFaltantes}
                  onChange={(e) => setMarcarFaltantes(e.target.checked)}
                />
              </FormField>
              <p className="ds-hint">
                En cada sincronización se actualizan los campos mapeados; nada se borra.
              </p>
            </>
          ) : null}
        </Card>
      ) : null}
      {[confirmar, cancelar, decidir, sinEmpresas].map((m, i) =>
        m.isError ? (
          <ErrorState key={i}>
            {m.error instanceof Error ? m.error.message : "No pudimos hacerlo."}
          </ErrorState>
        ) : null,
      )}
      <div className="ds-card-actions">
        <Button
          type="button"
          loading={confirmar.isPending}
          disabled={sincronizable && sincronizar && !horasValidas}
          onClick={() => void alConfirmar()}
        >
          Confirmar e importar
        </Button>
        <Button type="button" variant="secondary" onClick={onCambiarMapeo}>
          Cambiar el mapeo
        </Button>
        <Button
          type="button"
          variant="danger"
          loading={cancelar.isPending}
          onClick={() => void alCancelar()}
        >
          Descartar
        </Button>
      </div>
    </div>
  );
}
