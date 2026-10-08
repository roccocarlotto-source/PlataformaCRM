import { useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircleQuestion } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { ActionsMenu, type ActionsMenuAction } from "../../design-system/ActionsMenu";
import { Avatar } from "../../design-system/Avatar";
import { EMPTY_VALUE, formatDateTime, formatRelativeTime } from "../../design-system/detailFormat";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { Table } from "../../design-system/Table";
import { useConfirm } from "../../design-system/useConfirm";
import { CHANNEL_LABEL, CHANNEL_OPTIONS } from "../agent/labels";
import type { ConversationChannel } from "../agent/types";
import { useOwnerNames } from "../opportunity/relationResolution";
import { UserSelect } from "../user/UserSelect";
import { AsignarVendedorDialog } from "./AsignarVendedorDialog";
import { listConsultasSinIdentificar } from "./api";
import { etiquetaDelVehiculo } from "./labels";
import { MergeContactDialog } from "./MergeContactDialog";
import { useDescartarConsulta } from "./mutations";
import { contactKeys } from "./queries";
import type { ContactConConsulta } from "./types";

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// La pestaña "Consultas sin identificar" de Contactos (ítem 184 de
// docs/frontend-cambios-pendientes.md): quienes escribieron por un canal y
// todavía no dijeron quiénes son (nombre provisorio o incompleto, la regla del
// ítem 183) y no tienen ninguna oportunidad. Es un filtro calculado del
// backend (vista=consultas): cuando la persona da su nombre o se le crea una
// oportunidad, pasa sola a Clientes.
//
// Columnas: por dónde escribió, qué dijo por última vez, hace cuánto, qué
// vehículo le interesa y quién lo tiene asignado. Acciones por fila: abrir la
// conversación, asignar vendedor, crear una tarea de seguimiento, unir con un
// contacto existente y descartar. Las de escritura siguen D2: un USER ve
// solo abrir la conversación y crear la tarea; asignar, unir y descartar son
// de ADMIN (y el backend lo exige igual).
// ---------------------------------------------------------------------------
export function ConsultasSinIdentificarTab() {
  const confirm = useConfirm();
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<ConversationChannel | "">("");
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined);
  const [asignando, setAsignando] = useState<ContactConConsulta | null>(null);
  const [uniendo, setUniendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    channel: channel || undefined,
    ownerId,
  };
  // Bajo la misma raíz de cache que el listado de Clientes: las mutaciones de
  // contactos invalidan contactKeys.lists() y esto se refresca con ellas.
  const consultasQuery = useQuery({
    queryKey: contactKeys.list({ ...query, vista: "consultas" }),
    queryFn: ({ signal }) => listConsultasSinIdentificar(query, signal),
  });

  // Igual que la columna Asignado de Clientes: solo un ADMIN puede resolver
  // ownerId a nombre (GET /api/users es ADMIN-only), y el booleano gatea el
  // fetch.
  const ownerNames = useOwnerNames(isAdmin);
  function nombreDeAsignado(id: string | null): string | null {
    return id ? (ownerNames.byId.get(id) ?? null) : null;
  }

  const descartar = useDescartarConsulta();

  async function handleDescartar(consulta: ContactConConsulta) {
    const ok = await confirm(
      "¿Descartar esta consulta? Se cierran sus conversaciones y el contacto se da de baja. Si la persona vuelve a escribir, entra como una consulta nueva.",
      { confirmLabel: "Descartar", danger: true },
    );
    if (!ok) return;
    descartar.mutate(consulta.id);
  }

  function accionesDe(consulta: ContactConConsulta): ActionsMenuAction[] {
    return [
      ...(consulta.ultimaConsulta
        ? [
            {
              label: "Abrir la conversación",
              to: `/conversations/${consulta.ultimaConsulta.conversationId}`,
            },
          ]
        : []),
      ...(isAdmin ? [{ label: "Asignar vendedor", onClick: () => setAsignando(consulta) }] : []),
      {
        label: "Crear tarea de seguimiento",
        to: `/activities/new?contactId=${encodeURIComponent(consulta.id)}`,
      },
      ...(isAdmin
        ? [
            { label: "Unir con un contacto existente", onClick: () => setUniendo(consulta.id) },
            {
              label: "Descartar",
              onClick: () => void handleDescartar(consulta),
              destructive: true,
            },
          ]
        : []),
    ];
  }

  return (
    <>
      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            <span className="ds-sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar por nombre, email o teléfono"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <Select
            label="Canal"
            value={channel}
            options={CHANNEL_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => {
              setChannel(value);
              setPage(1);
            }}
          />
          {/* Solo ADMIN: el selector pide GET /api/users (ver UserSelect). */}
          {isAdmin ? (
            <UserSelect
              id="consultas-filter-owner"
              label="Vendedor"
              value={ownerId}
              onChange={(id) => {
                setOwnerId(id || undefined);
                setPage(1);
              }}
              emptyOptionLabel="Todos"
            />
          ) : null}
        </div>

        {consultasQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {consultasQuery.isError ? (
          <ErrorState>
            No pudimos cargar las consultas
            {consultasQuery.error instanceof Error ? `: ${consultasQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {descartar.isError ? (
          <ErrorState>
            No pudimos descartar la consulta
            {descartar.error instanceof Error ? `: ${descartar.error.message}` : "."}
          </ErrorState>
        ) : null}

        {aviso ? (
          <p className="ds-hint" role="status">
            {aviso}
          </p>
        ) : null}

        {consultasQuery.isSuccess && consultasQuery.data.data.length === 0 ? (
          <EmptyState title="No hay consultas sin identificar" icon={MessageCircleQuestion} />
        ) : null}

        {consultasQuery.isSuccess && consultasQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Consulta</th>
                <th>Canal</th>
                <th>Último mensaje</th>
                <th>Escribió</th>
                <th>Vehículo de interés</th>
                {isAdmin ? <th>Vendedor</th> : null}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {consultasQuery.data.data.map((consulta) => {
                const nombre = `${consulta.firstName} ${consulta.lastName}`.trim();
                const ultima = consulta.ultimaConsulta;
                const vendedor = nombreDeAsignado(consulta.ownerId);
                return (
                  <tr key={consulta.id}>
                    <td>
                      {/* El nombre provisorio abre la ficha igual que en
                          Clientes: ahí se puede completar el nombre real. */}
                      <span className="ds-person">
                        <Avatar name={nombre} size="sm" decorative />
                        <Link to={`/contacts/${consulta.id}/edit`}>{nombre}</Link>
                      </span>
                    </td>
                    <td className="ds-cell-fit">
                      {ultima ? CHANNEL_LABEL[ultima.channel] : EMPTY_VALUE}
                    </td>
                    {/* Recortado por el backend a lo que entra en una celda y,
                        encima, a dos líneas por CSS (.ds-cell-clamp), como el
                        resumen en la bandeja. */}
                    <td>
                      {ultima?.ultimoMensaje ? (
                        <span className="ds-cell-clamp" title={ultima.ultimoMensaje}>
                          {ultima.ultimoMensaje}
                        </span>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </td>
                    <td className="ds-cell-fit">
                      {ultima ? (
                        <time
                          dateTime={ultima.ultimoMensajeAt}
                          title={formatDateTime(ultima.ultimoMensajeAt)}
                        >
                          {formatRelativeTime(ultima.ultimoMensajeAt)}
                        </time>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </td>
                    <td>{etiquetaDelVehiculo(consulta.vehicleOfInterest) || EMPTY_VALUE}</td>
                    {isAdmin ? (
                      <td>
                        {vendedor ? (
                          <span className="ds-person">
                            <Avatar name={vendedor} size="sm" decorative />
                            <span>{vendedor}</span>
                          </span>
                        ) : (
                          EMPTY_VALUE
                        )}
                      </td>
                    ) : null}
                    <td>
                      <ActionsMenu
                        label={`Más acciones de ${nombre}`}
                        actions={accionesDe(consulta)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}

        {consultasQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={consultasQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>

      {asignando ? (
        <AsignarVendedorDialog
          contactId={asignando.id}
          ownerId={asignando.ownerId}
          onClose={() => setAsignando(null)}
        />
      ) : null}
      {uniendo ? (
        <MergeContactDialog
          contactId={uniendo}
          modo="seUne"
          onClose={() => setUniendo(null)}
          onMerged={(resultado) => {
            setUniendo(null);
            const total = Object.values(resultado.movidos).reduce((a, b) => a + b, 0);
            setAviso(
              total > 0
                ? `Consulta unida: ${total} registros pasaron al contacto existente.`
                : "Consulta unida al contacto existente.",
            );
          }}
        />
      ) : null}
    </>
  );
}
