import { useState } from "react";
import { Check, Eye, Link2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Badge, type BadgeVariant } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { buildPublicResolutionUrl } from "../../lib/publicUrl";
import { BranchSelect } from "../branch/BranchSelect";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { useDeleteQrCode } from "./mutations";
import { QrFormDialog } from "./QrFormDialog";
import { QrImageDialog } from "./QrImageDialog";
import { QrSendDialog } from "./QrSendDialog";
import { useQrCodes } from "./queries";
import {
  estadoDeQr,
  type QrCode,
  type QrCodeSortBy,
  type QrCodeStatus,
  type SortOrder,
} from "./types";

const PAGE_SIZE = 20;

// Lo que se muestra cuando una sucursal no se pudo resolver (fuera de las
// primeras 100, o un fallo puntual de esa request) — mismo criterio que
// ApiKeyListPage con una fuente que no resuelve.
const SIN_RESOLVER = "—";

const ESTADO_LABEL: Record<QrCodeStatus, string> = {
  SIN_RECLAMAR: "Sin reclamar",
  USADO: "Usado",
  ACTIVO: "Activo",
};

// Color del badge de estado, decidido acá y no en Badge (ver Badge.tsx). Sin
// reclamar es el único estado en que el QR no redirige a nadie: es el que
// tiene que llamar la atención.
const ESTADO_BADGE: Record<QrCodeStatus, BadgeVariant> = {
  SIN_RECLAMAR: "danger",
  USADO: "neutral",
  ACTIVO: "success",
};

// Tamaño de los íconos de las acciones de fila (export "Reseñas QR": 15px,
// trazo 1.5). Son decorativos: el nombre accesible del botón sigue siendo
// solo su texto.
const ICONO = { size: 15, strokeWidth: 1.5, "aria-hidden": true } as const;

// Qué diálogo está abierto y sobre qué QR. Uno solo a la vez: los cuatro
// (crear, editar, imagen, enviar) son Modal, y dos superpuestos no tienen
// sentido.
type Dialogo =
  | { kind: "crear" }
  | { kind: "editar"; qr: QrCode }
  | { kind: "imagen"; qr: QrCode }
  | { kind: "enviar"; qr: QrCode };

export function QrListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura para no-ADMIN es cortesía de UX: la
  // autorización real la sigue aplicando authorize("ADMIN") en el backend
  // (POST/PATCH/DELETE /api/qr). Ver imagen, enviar y copiar link son de
  // solo lectura y quedan para cualquier rol: que alguien del mostrador le
  // mande el QR a un cliente es exactamente el caso de uso de un USER.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<QrCodeSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);
  // Respaldo cuando el portapapeles no está disponible: el link se muestra
  // como texto seleccionable en vez de fallar en silencio.
  const [linkParaCopiarAMano, setLinkParaCopiarAMano] = useState<string | null>(null);

  const qrCodesQuery = useQrCodes({
    page,
    pageSize: PAGE_SIZE,
    branchId,
    sortBy,
    sortOrder,
  });

  // Exactamente la misma query que BranchSelect (mismo key): una sola request
  // alimenta el filtro y la resolución de nombres de las filas.
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSucursal = new Map(
    (branchesQuery.data?.data ?? []).map((branch) => [branch.id, branch.name]),
  );

  const deleteMutation = useDeleteQrCode();

  function handleDelete(id: string) {
    if (
      !window.confirm(
        "¿Eliminar este QR? Deja de funcionar de inmediato; no se puede deshacer desde acá.",
      )
    ) {
      return;
    }
    deleteMutation.mutate(id);
  }

  async function handleCopyLink(qr: QrCode) {
    let url: string;
    try {
      url = buildPublicResolutionUrl(qr.id);
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiadoId(qr.id);
      setLinkParaCopiarAMano(null);
    } catch {
      setCopiadoId(null);
      setLinkParaCopiarAMano(url);
    }
  }

  function handleSaved(saved: QrCode, eraCreacion: boolean) {
    // Tras crear, se abre directo la imagen del QR nuevo — el equivalente del
    // panel "QR nuevo" del Dashboard original. Tras editar, solo se cierra.
    setDialogo(eraCreacion ? { kind: "imagen", qr: saved } : null);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Códigos QR</h1>
        {isAdmin ? (
          <Button variant="primary" onClick={() => setDialogo({ kind: "crear" })}>
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Generar QR digital
          </Button>
        ) : null}
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <BranchSelect
            id="qr-list-branch"
            label="Sucursal"
            value={branchId}
            emptyOptionLabel="Todas"
            onChange={(nuevo) => {
              setBranchId(nuevo || undefined);
              setPage(1);
            }}
          />
          <label>
            Ordenar por
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as QrCodeSortBy)}
            >
              <option value="createdAt">Fecha de creación</option>
              <option value="displayNumber">Número</option>
            </select>
          </label>
          <label>
            Orden
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as SortOrder)}
            >
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
          </label>
        </div>

        {qrCodesQuery.isLoading ? <LoadingState /> : null}

        {qrCodesQuery.isError ? (
          <ErrorState>
            No pudimos cargar los códigos QR
            {qrCodesQuery.error instanceof Error ? `: ${qrCodesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteMutation.isError ? (
          <ErrorState>
            No pudimos eliminar el QR
            {deleteMutation.error instanceof Error ? `: ${deleteMutation.error.message}` : "."}
          </ErrorState>
        ) : null}

        {linkParaCopiarAMano ? (
          <p className="ds-hint">
            No pudimos copiar el link automáticamente. Copialo a mano:{" "}
            <code>{linkParaCopiarAMano}</code>
          </p>
        ) : null}

        {qrCodesQuery.isSuccess && qrCodesQuery.data.data.length === 0 ? (
          <EmptyState>Todavía no hay códigos QR para mostrar.</EmptyState>
        ) : null}

        {qrCodesQuery.isSuccess && qrCodesQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Nombre</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Destino</th>
                <th>Tipo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {qrCodesQuery.data.data.map((qr) => (
                <tr key={qr.id}>
                  <td>{qr.displayNumber ?? SIN_RESOLVER}</td>
                  <td className="ds-cell-primary">{qr.name ?? SIN_RESOLVER}</td>
                  <td>
                    {qr.branchId
                      ? (nombreDeSucursal.get(qr.branchId) ?? SIN_RESOLVER)
                      : SIN_RESOLVER}
                  </td>
                  <td>
                    <Badge variant={ESTADO_BADGE[estadoDeQr(qr)]}>
                      {ESTADO_LABEL[estadoDeQr(qr)]}
                    </Badge>
                  </td>
                  <td
                    className="ds-cell-muted ds-cell-truncate"
                    title={qr.destinationUrl ?? undefined}
                  >
                    {qr.destinationUrl ?? SIN_RESOLVER}
                  </td>
                  <td>
                    {qr.qrType === "SINGLE_USE" ? (
                      <Badge variant="info">Un solo uso</Badge>
                    ) : (
                      <Badge variant="neutral">Reusable</Badge>
                    )}
                  </td>
                  <td>
                    {/* Mismas acciones, mismos textos y mismos íconos que antes;
                      solo cambia el contenedor: un menú de 3 puntos en vez de la
                      fila de botones (docs/frontend-cambios-pendientes.md §8).
                      "Copiar link" lleva keepOpen porque su confirmación es el
                      propio ítem pasando a decir "¡Copiado!": cerrar el menú al
                      elegirla la escondería. */}
                    <ActionsMenu
                      actions={[
                        {
                          label: "Ver imagen",
                          icon: <Eye {...ICONO} />,
                          onClick: () => setDialogo({ kind: "imagen", qr }),
                        },
                        {
                          label: "Enviar",
                          icon: <Send {...ICONO} />,
                          onClick: () => setDialogo({ kind: "enviar", qr }),
                        },
                        {
                          label: copiadoId === qr.id ? "¡Copiado!" : "Copiar link",
                          icon: copiadoId === qr.id ? <Check {...ICONO} /> : <Link2 {...ICONO} />,
                          onClick: () => void handleCopyLink(qr),
                          keepOpen: true,
                        },
                        ...(isAdmin
                          ? [
                              {
                                label: "Editar",
                                icon: <Pencil {...ICONO} />,
                                onClick: () => setDialogo({ kind: "editar", qr }),
                              },
                              {
                                label: "Eliminar",
                                icon: <Trash2 {...ICONO} />,
                                onClick: () => handleDelete(qr.id),
                                destructive: true,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {qrCodesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={qrCodesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>

      {dialogo?.kind === "crear" ? (
        <QrFormDialog
          onClose={() => setDialogo(null)}
          onSaved={(saved) => handleSaved(saved, true)}
        />
      ) : null}
      {dialogo?.kind === "editar" ? (
        <QrFormDialog
          qr={dialogo.qr}
          onClose={() => setDialogo(null)}
          onSaved={(saved) => handleSaved(saved, false)}
        />
      ) : null}
      {dialogo?.kind === "imagen" ? (
        <QrImageDialog qr={dialogo.qr} onClose={() => setDialogo(null)} />
      ) : null}
      {dialogo?.kind === "enviar" ? (
        <QrSendDialog qr={dialogo.qr} onClose={() => setDialogo(null)} />
      ) : null}
    </div>
  );
}
