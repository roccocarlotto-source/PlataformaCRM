import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { formatRelativeTime } from "../../design-system/detailFormat";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { Table } from "../../design-system/Table";
import { BranchSelect } from "../branch/BranchSelect";
import { AYUDA } from "../guia/anclas";
import { ESTADOS_ABIERTOS, puedePasar } from "./estados";
import { descripcionDe, ETIQUETA_DE_ESTADO, nombreDe } from "./formato";
import { useOrdenes } from "./queries";
import { TransicionDialog } from "./TransicionDialog";
import type { EstadoDeOrden, OrdenDeLista } from "./types";

/** Lo que oye un lector de pantalla al arrastrar. Los de dnd-kit por defecto
 *  salen en inglés y con el id interno ("Draggable item 0456… was dropped over
 *  droppable area EN_TRABAJO": prueba de S4a). */
function anunciosDelTablero(todas: OrdenDeLista[]): Announcements {
  const numero = (id: UniqueIdentifier) => todas.find((o) => o.id === id)?.numero ?? "La orden";
  const columna = (id: UniqueIdentifier) => ETIQUETA_DE_ESTADO[id as EstadoDeOrden] ?? String(id);
  return {
    onDragStart: ({ active }) => `Moviendo ${numero(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${numero(active.id)} sobre ${columna(over.id)}.`
        : `${numero(active.id)} fuera de las columnas.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${numero(active.id)} soltada en ${columna(over.id)}.`
        : `${numero(active.id)} soltada fuera de las columnas: no se movió.`,
    onDragCancel: ({ active }) => `Se canceló el movimiento de ${numero(active.id)}.`,
  };
}

// Taller → Órdenes (docs/servicios.md §4.2). Tablero por defecto, con una
// columna por estado abierto; arrastrar una tarjeta abre el diálogo de la
// transición, y solo se puede soltar en una columna permitida. La lista es la
// alternativa, con los estados finales y la búsqueda. La sucursal y la vista
// elegidas quedan recordadas en este navegador.

const CLAVE_SUCURSAL = "servicios:ordenes:sucursal";
const CLAVE_VISTA = "servicios:ordenes:vista";
const PAGE_SIZE = 20;

function recordado(clave: string): string {
  try {
    return localStorage.getItem(clave) ?? "";
  } catch {
    return "";
  }
}

function recordar(clave: string, valor: string) {
  try {
    if (valor) localStorage.setItem(clave, valor);
    else localStorage.removeItem(clave);
  } catch {
    // Sin almacenamiento (ventana privada): solo no se recuerda.
  }
}

export function OrdenesPage() {
  const [sucursal, setSucursal] = useState(() => recordado(CLAVE_SUCURSAL));
  const [vista, setVista] = useState<"tablero" | "lista">(() =>
    recordado(CLAVE_VISTA) === "lista" ? "lista" : "tablero",
  );

  return (
    <div>
      <PageHeader
        help={AYUDA.ordenes}
        title="Órdenes de servicio"
        actions={
          <Link to="/taller/ordenes/nueva" className="ds-link-button">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nueva orden
          </Link>
        }
      />
      <div className="ds-filters">
        <BranchSelect
          id="ordenes-sucursal"
          label="Sucursal"
          value={sucursal || undefined}
          emptyOptionLabel="Todas"
          onChange={(id) => {
            setSucursal(id);
            recordar(CLAVE_SUCURSAL, id);
          }}
        />
        <Select
          id="ordenes-vista"
          label="Vista"
          value={vista}
          options={[
            { value: "tablero", label: "Tablero" },
            { value: "lista", label: "Lista" },
          ]}
          onChange={(v) => {
            const nueva = v === "lista" ? "lista" : "tablero";
            setVista(nueva);
            recordar(CLAVE_VISTA, nueva);
          }}
        />
      </div>
      {vista === "tablero" ? (
        <Tablero sucursal={sucursal || undefined} />
      ) : (
        <Lista sucursal={sucursal || undefined} />
      )}
    </div>
  );
}

// --- Tablero ---------------------------------------------------------------

function Tablero({ sucursal }: { sucursal: string | undefined }) {
  const ordenes = useOrdenes({ estados: [...ESTADOS_ABIERTOS], branchId: sucursal, pageSize: 200 });
  const [arrastrando, setArrastrando] = useState<OrdenDeLista | null>(null);
  const [transicion, setTransicion] = useState<{
    orden: OrdenDeLista;
    hacia: EstadoDeOrden;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  if (ordenes.isLoading) return <LoadingState variant="rows" />;
  if (ordenes.isError || !ordenes.data) {
    return <ErrorState>No pudimos cargar las órdenes.</ErrorState>;
  }
  const todas = ordenes.data.data;

  function alEmpezar(event: DragStartEvent) {
    setArrastrando(todas.find((o) => o.id === event.active.id) ?? null);
  }

  function alSoltar(event: DragEndEvent) {
    setArrastrando(null);
    const orden = todas.find((o) => o.id === event.active.id);
    const hacia = event.over?.id as EstadoDeOrden | undefined;
    if (!orden || !hacia || hacia === orden.status) return;
    // La columna ya no acepta lo no permitido (useDroppable disabled); esto es
    // el cinturón por si el teclado la alcanza igual.
    if (!puedePasar(orden.status, hacia)) return;
    setTransicion({ orden, hacia });
  }

  return (
    <>
      {ordenes.data.pagination.total > todas.length ? (
        <p className="ds-hint">
          {`Se muestran ${todas.length} de ${ordenes.data.pagination.total} órdenes abiertas. Elegí una sucursal o usá la lista.`}
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={alEmpezar}
        onDragEnd={alSoltar}
        onDragCancel={() => setArrastrando(null)}
        accessibility={{
          announcements: anunciosDelTablero(todas),
          screenReaderInstructions: {
            draggable:
              "Para mover una orden de estado, presioná Espacio o Enter, movela con las flechas y volvé a presionar Espacio para soltarla. Escape cancela.",
          },
        }}
      >
        {/* Ajustado: las cinco columnas abiertas se reparten el ancho y entran
          en 1366–1440 px sin scroll (prueba de S4a). El tablero de
          oportunidades sigue con columnas fijas. */}
        <div className="ds-board ds-board--ajustado">
          {ESTADOS_ABIERTOS.map((estado) => (
            <Columna
              key={estado}
              estado={estado}
              ordenes={todas.filter((o) => o.status === estado)}
              permitida={
                arrastrando === null ||
                arrastrando.status === estado ||
                puedePasar(arrastrando.status, estado)
              }
            />
          ))}
        </div>
      </DndContext>
      {transicion ? (
        <TransicionDialog
          orden={transicion.orden}
          hacia={transicion.hacia}
          onClose={() => setTransicion(null)}
        />
      ) : null}
    </>
  );
}

function Columna({
  estado,
  ordenes,
  permitida,
}: {
  estado: EstadoDeOrden;
  ordenes: OrdenDeLista[];
  permitida: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: estado, disabled: !permitida });
  const className = [
    "ds-board-column",
    isOver && permitida ? "ds-board-column--over" : null,
    permitida ? null : "ds-board-column--disabled",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      ref={setNodeRef}
      className={className}
      aria-labelledby={`taller-${estado}`}
      aria-disabled={!permitida || undefined}
      style={permitida ? undefined : { opacity: 0.5 }}
    >
      <div className="ds-board-column-bar" aria-hidden="true" />
      <div className="ds-board-column-header">
        <h2 id={`taller-${estado}`} className="ds-board-column-title">
          {ETIQUETA_DE_ESTADO[estado]}
        </h2>
        <span className="ds-board-count" aria-label={`${ordenes.length} órdenes`}>
          {ordenes.length}
        </span>
      </div>
      <div className="ds-board-cards">
        {ordenes.map((o) => (
          <Tarjeta key={o.id} orden={o} />
        ))}
      </div>
    </section>
  );
}

function Tarjeta({ orden }: { orden: OrdenDeLista }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: orden.id,
  });
  return (
    <article
      ref={setNodeRef}
      className={`ds-board-card${isDragging ? " ds-board-card--dragging" : ""}`}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
      {...listeners}
      {...attributes}
    >
      <div className="ds-board-card-title">
        <Link to={`/taller/ordenes/${orden.id}`}>{orden.numero}</Link>
      </div>
      <div className="ds-board-card-meta">
        <div>
          {[descripcionDe(orden.vehiculo), orden.vehiculo.licensePlate].filter(Boolean).join(" · ")}
        </div>
        <div>{nombreDe(orden.contact)}</div>
      </div>
      <div className="ds-board-card-footer">
        <span className="ds-cell-muted">{orden.assignee?.fullName ?? "Sin encargado"}</span>
        <span className="ds-cell-muted" title={orden.enEstadoDesde}>
          {formatRelativeTime(orden.enEstadoDesde)}
        </span>
      </div>
    </article>
  );
}

// --- Lista -----------------------------------------------------------------

type FiltroDeEstado = "ABIERTAS" | "TODAS" | EstadoDeOrden;

function Lista({ sucursal }: { sucursal: string | undefined }) {
  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState<FiltroDeEstado>("ABIERTAS");
  const [busqueda, setBusqueda] = useState("");
  const estados =
    estado === "ABIERTAS" ? [...ESTADOS_ABIERTOS] : estado === "TODAS" ? undefined : [estado];
  const ordenes = useOrdenes({
    page,
    pageSize: PAGE_SIZE,
    estados,
    branchId: sucursal,
    q: busqueda.trim() || undefined,
  });

  return (
    <div className="ds-list-card">
      <h2 className="ds-filters-title">Filtros</h2>
      <div className="ds-filters">
        <label>
          <span className="ds-sr-only">Buscar</span>
          <input
            type="search"
            placeholder="Buscar por número, matrícula o cliente"
            value={busqueda}
            onChange={(event) => {
              setBusqueda(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <Select
          id="ordenes-estado"
          label="Estado"
          value={estado}
          options={[
            { value: "ABIERTAS", label: "Abiertas" },
            { value: "TODAS", label: "Todas" },
            ...Object.entries(ETIQUETA_DE_ESTADO).map(([valor, rotulo]) => ({
              value: valor as EstadoDeOrden,
              label: rotulo,
            })),
          ]}
          onChange={(v) => {
            setEstado((v || "ABIERTAS") as FiltroDeEstado);
            setPage(1);
          }}
        />
      </div>
      {ordenes.isLoading ? <LoadingState variant="rows" /> : null}
      {ordenes.isError ? <ErrorState>No pudimos cargar las órdenes.</ErrorState> : null}
      {ordenes.isSuccess && ordenes.data.data.length === 0 ? (
        <EmptyState
          title={
            busqueda.trim()
              ? `Ninguna orden coincide con «${busqueda.trim()}»`
              : estado === "ABIERTAS"
                ? "No hay órdenes abiertas"
                : "No hay órdenes en este estado"
          }
          icon={ClipboardList}
        >
          {!busqueda.trim() && estado === "ABIERTAS"
            ? "Las entregadas y canceladas se ven eligiendo Todas en Estado."
            : null}
        </EmptyState>
      ) : null}
      {ordenes.isSuccess && ordenes.data.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Estado</th>
              <th>Vehículo</th>
              <th>Cliente</th>
              <th>Encargado</th>
              <th>Sucursal</th>
            </tr>
          </thead>
          <tbody>
            {ordenes.data.data.map((o) => (
              <tr key={o.id}>
                <td className="ds-cell-primary">
                  <Link to={`/taller/ordenes/${o.id}`}>{o.numero}</Link>
                </td>
                <td>
                  <Badge
                    variant={
                      o.status === "CANCELADO"
                        ? "danger"
                        : o.status === "ENTREGADO"
                          ? "success"
                          : "info"
                    }
                  >
                    {ETIQUETA_DE_ESTADO[o.status]}
                  </Badge>
                </td>
                <td>
                  {[descripcionDe(o.vehiculo), o.vehiculo.licensePlate].filter(Boolean).join(" · ")}
                </td>
                <td>{nombreDe(o.contact)}</td>
                <td>{o.assignee?.fullName ?? "—"}</td>
                <td className="ds-cell-muted">{o.branch.name}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {ordenes.isSuccess ? (
        <Pagination
          page={page}
          totalPages={ordenes.data.pagination.totalPages}
          onPrevious={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
      ) : null}
    </div>
  );
}
