import { useState } from "react";
import { Link } from "react-router-dom";
import { Car, Plus } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Avatar } from "../../design-system/Avatar";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { MultiSelect } from "../../design-system/MultiSelect";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { BranchSelect } from "../branch/BranchSelect";
import { useOwnerNames } from "../opportunity/relationResolution";
import { priceCell, unitTitle } from "./format";
import { CONDITION_LABELS, STATUS_BADGE_VARIANT, STATUS_LABELS } from "./labels";
import { useDeleteVehicle } from "./mutations";
import { useVehicles } from "./queries";
import type { VehicleCondition, VehicleSortBy, VehicleStatus, SortOrder } from "./types";
import { VehicleSummaryCards } from "./VehicleSummaryCards";

const PAGE_SIZE = 20;

// Opciones del filtro Estado, en el orden del enum; MultiSelect devuelve la
// selección en ese mismo orden.
const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as VehicleStatus[]).map((status) => ({
  value: status,
  label: STATUS_LABELS[status],
}));

// Listado de stock (Fase 3a del módulo de vehículos; la columna Foto y la
// unidad/precio compartidos con VehicleSelect en format.ts son de la 3b).
// Columna Unidad: unitTitle en una línea, el código interno chico debajo
// (ds-cell-caption). Plantilla:
// CompanyListPage. Lo que NO tiene, y por qué:
//   - "Reservar/Liberar" por fila: el estado de una unidad vinculada a una
//     Oportunidad lo controla ese vínculo (Fase 2c,
//     setVehicleStatusForOpportunityLink); un PATCH de status al lado
//     confundiría cuál de los dos caminos manda. Un cambio manual se hace
//     desde la ficha (sección Comercial).
//   - "Exportar" y selección múltiple: sin contraparte en el backend.
export function VehicleListPage() {
  const { me } = useAuth();
  // Cortesía de UX: la autorización real es authorize("ADMIN") en el backend.
  // Igual que en CompanyListPage, el mismo booleano gatea la columna del
  // vendedor: resolver assignedSalespersonId a nombre necesita GET /api/users,
  // que es ADMIN-only.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState("");
  const [statuses, setStatuses] = useState<VehicleStatus[]>([]);
  const [condition, setCondition] = useState<VehicleCondition | "">("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [minPriceUsd, setMinPriceUsd] = useState("");
  const [maxPriceUsd, setMaxPriceUsd] = useState("");
  const [consignmentOnly, setConsignmentOnly] = useState(false);
  const [sortBy, setSortBy] = useState<VehicleSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const vehiclesQuery = useVehicles({
    page,
    pageSize: PAGE_SIZE,
    branchId: branchId || undefined,
    status: statuses.length > 0 ? statuses : undefined,
    condition: condition || undefined,
    make: make || undefined,
    model: model || undefined,
    minPriceUsd: minPriceUsd ? Number(minPriceUsd) : undefined,
    maxPriceUsd: maxPriceUsd ? Number(maxPriceUsd) : undefined,
    consignmentOnly: consignmentOnly || undefined,
    sortBy,
    sortOrder,
  });

  const salespersonNames = useOwnerNames(isAdmin);
  const deleteVehicleMutation = useDeleteVehicle();

  function handleDelete(id: string) {
    if (!window.confirm("¿Dar de baja esta unidad?")) return;
    deleteVehicleMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Stock de vehículos</h1>
        {isAdmin ? (
          <Link to="/vehicles/new" className="ds-link-button">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nueva unidad
          </Link>
        ) : null}
      </div>

      <VehicleSummaryCards />

      <div className="ds-list-card">
        {/* Cada filtro resetea page a 1, como en CompanyListPage. El estado es
            multi-selección (statusListSchema del backend acepta la query
            repetida) y va en un MultiSelect y no en un <select multiple>: el
            nativo se renderiza como una lista siempre abierta y desentonaba
            con los demás filtros de la fila (docs/frontend-cambios-pendientes.md
            §1). Lo que se puede filtrar no cambió. */}
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <BranchSelect
            id="vehicle-filter-branch"
            label="Sucursal"
            value={branchId || undefined}
            onChange={(value) => {
              setBranchId(value);
              setPage(1);
            }}
            emptyOptionLabel="Todas"
          />
          <MultiSelect
            id="vehicle-filter-status"
            label="Estado"
            options={STATUS_OPTIONS}
            value={statuses}
            onChange={(value) => {
              setStatuses(value);
              setPage(1);
            }}
          />
          <label>
            Condición
            <select
              value={condition}
              onChange={(event) => {
                setCondition(event.target.value as VehicleCondition | "");
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              <option value="NEW">{CONDITION_LABELS.NEW}</option>
              <option value="USED">{CONDITION_LABELS.USED}</option>
            </select>
          </label>
          <label>
            Marca
            <input
              type="text"
              value={make}
              onChange={(event) => {
                setMake(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Modelo
            <input
              type="text"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Precio mín. (USD)
            <input
              type="number"
              min={0}
              value={minPriceUsd}
              onChange={(event) => {
                setMinPriceUsd(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Precio máx. (USD)
            <input
              type="number"
              min={0}
              value={maxPriceUsd}
              onChange={(event) => {
                setMaxPriceUsd(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={consignmentOnly}
              onChange={(event) => {
                setConsignmentOnly(event.target.checked);
                setPage(1);
              }}
            />
            Solo consignación
          </label>
          <label>
            Ordenar por
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as VehicleSortBy)}
            >
              <option value="createdAt">Fecha de alta</option>
              <option value="priceListUsd">Precio (USD)</option>
              <option value="stockEnteredAt">Ingreso al stock</option>
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

        {vehiclesQuery.isLoading ? <LoadingState /> : null}

        {vehiclesQuery.isError ? (
          <ErrorState>
            No pudimos cargar el stock
            {vehiclesQuery.error instanceof Error ? `: ${vehiclesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteVehicleMutation.isError ? (
          <ErrorState>
            No pudimos dar de baja la unidad
            {deleteVehicleMutation.error instanceof Error
              ? `: ${deleteVehicleMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {vehiclesQuery.isSuccess && vehiclesQuery.data.data.length === 0 ? (
          <EmptyState>No hay unidades para mostrar.</EmptyState>
        ) : null}

        {vehiclesQuery.isSuccess && vehiclesQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Foto</th>
                <th>Unidad</th>
                <th>Precio</th>
                <th>Estado</th>
                {isAdmin ? <th>Vendedor</th> : null}
                {isAdmin ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {vehiclesQuery.data.data.map((vehicle) => {
                // Sin vendedor y vendedor que no se pudo resolver muestran lo
                // mismo, "—", y sin nombre no hay avatar — mismo criterio que
                // la columna Owner de CompanyListPage.
                const salespersonName = vehicle.assignedSalespersonId
                  ? (salespersonNames.byId.get(vehicle.assignedSalespersonId) ?? null)
                  : null;
                return (
                  <tr key={vehicle.id}>
                    {/* La portada viene resuelta en lote con el listado
                        (coverPhotoUrl, Fase 3b); null es "sin fotos" o un
                        objeto que no se pudo firmar, y las dos se ven igual:
                        un placeholder, no una imagen rota. alt vacío: la
                        columna Unidad ya nombra la fila. */}
                    <td>
                      {vehicle.coverPhotoUrl ? (
                        <img src={vehicle.coverPhotoUrl} alt="" className="ds-thumb" />
                      ) : (
                        <span className="ds-thumb ds-thumb--empty" role="img" aria-label="Sin foto">
                          <Car size={20} strokeWidth={1.5} aria-hidden="true" />
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="ds-cell-stack">
                        <span className="ds-cell-primary">{unitTitle(vehicle)}</span>
                        <span className="ds-cell-caption">{vehicle.internalCode}</span>
                      </span>
                    </td>
                    <td>{priceCell(vehicle)}</td>
                    <td>
                      <Badge variant={STATUS_BADGE_VARIANT[vehicle.status]}>
                        {STATUS_LABELS[vehicle.status]}
                      </Badge>
                    </td>
                    {isAdmin ? (
                      <td>
                        {salespersonName ? (
                          <span className="ds-person">
                            <Avatar name={salespersonName} size="sm" decorative />
                            <span>{salespersonName}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    {isAdmin ? (
                      <td>
                        <Link to={`/vehicles/${vehicle.id}/edit`}>Editar</Link>{" "}
                        <Button variant="danger" onClick={() => handleDelete(vehicle.id)}>
                          Eliminar
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}

        {vehiclesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={vehiclesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
