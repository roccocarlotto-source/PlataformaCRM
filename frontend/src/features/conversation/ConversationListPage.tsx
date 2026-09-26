import { useState } from "react";
import { Badge } from "../../design-system/Badge";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { Table } from "../../design-system/Table";
import { EMPTY_VALUE, formatDateTime } from "../../design-system/detailFormat";
import { AGENTS_PARA_SELECT, useAgents } from "../agent/queries";
import { CHANNEL_LABEL, CHANNEL_OPTIONS } from "../agent/labels";
import { BranchSelect } from "../branch/BranchSelect";
import { ConversationDetail } from "./ConversationDetail";
import { STATUS_BADGE_VARIANT, STATUS_LABEL, STATUS_OPTIONS } from "./labels";
import { useConversations } from "./queries";
import type { ConversationChannel, ConversationStatus } from "./types";

const PAGE_SIZE = 20;

// Largo del brief en la fila. No es el largo del brief: el resumen entero son
// 2 a 4 oraciones y entra cómodo en el pop up; acá se muestra el arranque, que
// es lo que sirve para decidir cuál abrir.
const BRIEF_EN_LA_FILA = 120;

function truncar(texto: string): string {
  const limpio = texto.trim().replace(/\s+/g, " ");
  return limpio.length > BRIEF_EN_LA_FILA
    ? `${limpio.slice(0, BRIEF_EN_LA_FILA).trimEnd()}…`
    : limpio;
}

// ---------------------------------------------------------------------------
// Bandeja de conversaciones (ítem 66 de docs/frontend-cambios-pendientes.md):
// lo que hablaron los agentes de IA con los contactos, visible por fin desde
// el CRM.
//
// FUERA DE AdminRoute, a diferencia de Agentes de IA / Base de conocimiento /
// Automatizaciones (ver app/router.tsx): esas tres son pantallas de
// configuración, y esto es un dato del CRM que un vendedor necesita leer,
// como Contactos o Stock. GET /api/conversations es authenticate a secas.
// Por eso acá NO hay ningún gate `isAdmin`... salvo uno, en el detalle, y por
// una razón concreta: la ficha del contacto es ADMIN-only (ver
// ConversationDetail).
//
// SIN NINGUNA ACCIÓN: no hay "Nueva conversación", no hay menú de 3 puntos,
// no hay borrar. Una conversación no se crea a mano —la crea el loop del
// agente cuando entra un mensaje— y no se borra: es la transcripción de algo
// que pasó con un tercero. El único destino de una fila es su hilo.
//
// Y ESE HILO SE ABRE EN UN POP UP (ítem 73), no en una página aparte. Cambió
// porque leer la bandeja es ir entrando y saliendo de conversaciones, y cada
// ida a /conversations/:id perdía el listado entero —filtros, página, scroll—
// para devolverlo recién al volver. La ruta sigue existiendo para quien linkee
// directo; lo que cambió es el camino normal. El pop up no toca la URL: cerrar
// deja todo exactamente como estaba, que es el punto.
//
// EL ORDEN ES FIJO: lo último que se movió, arriba, que es lo que se espera
// de una bandeja. La API admite también ordenar por fecha de inicio
// (sortBy=createdAt) y no se expone control para eso: sería una preferencia
// sin caso de uso hoy, y el filtro de fecha —que sí lo tendría— no existe ni
// en el backend.
// ---------------------------------------------------------------------------
export function ConversationListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ConversationStatus | "">("");
  const [channel, setChannel] = useState<ConversationChannel | "">("");
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  // La conversación abierta en el pop up, o null (ítem 73). SIN SINCRONIZAR
  // CON LA URL, a propósito y es lo que Rocco pidió: ni querystring ni ruta
  // nueva. Cerrar el pop up devuelve al MISMO listado, con los mismos filtros
  // y en la misma página, sin un remount ni una vuelta al servidor — que es
  // justamente lo que la página aparte hacía mal.
  const [conversacionAbierta, setConversacionAbierta] = useState<string | null>(null);

  const conversationsQuery = useConversations({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
    channel: channel || undefined,
    branchId,
    agentId,
  });

  // Solo alimenta el filtro: los nombres de las filas vienen resueltos del
  // backend (conversationInclude), a diferencia de AgentListPage/
  // KnowledgeBaseListPage, que resuelven la sucursal contra esta misma query.
  // El motivo es el contacto: son miles y no entran en un pageSize de 100, así
  // que la fila tenía que traerlo resuelto igual — y una vez que la consulta
  // hace ese join, sumarle el agente y la sucursal no cuesta nada más.
  const agentsQuery = useAgents(AGENTS_PARA_SELECT);

  const conversations = conversationsQuery.data?.data ?? [];

  function aplicarFiltro(cambio: () => void) {
    cambio();
    setPage(1);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Conversaciones</h1>
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            {/* Solo para lectores de pantalla: el placeholder ya dice qué
                busca (docs/frontend-cambios-pendientes.md §4.b). */}
            <span className="ds-sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar por contacto"
              value={search}
              onChange={(event) => aplicarFiltro(() => setSearch(event.target.value))}
            />
          </label>
          <Select
            label="Estado"
            value={status}
            options={STATUS_OPTIONS}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => aplicarFiltro(() => setStatus(value))}
          />
          <Select
            label="Canal"
            value={channel}
            options={CHANNEL_OPTIONS}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => aplicarFiltro(() => setChannel(value))}
          />
          <BranchSelect
            id="conversation-list-branch"
            label="Sucursal"
            value={branchId}
            emptyOptionLabel="Todas"
            onChange={(nuevo) => aplicarFiltro(() => setBranchId(nuevo || undefined))}
          />
          <Select
            id="conversation-list-agent"
            label="Agente"
            value={agentId}
            options={(agentsQuery.data?.data ?? []).map((agent) => ({
              value: agent.id,
              label: agent.name,
            }))}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => aplicarFiltro(() => setAgentId(value || undefined))}
          />
        </div>

        {conversationsQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {conversationsQuery.isError ? (
          <ErrorState>
            No pudimos cargar las conversaciones
            {conversationsQuery.error instanceof Error
              ? `: ${conversationsQuery.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {conversationsQuery.isSuccess && conversations.length === 0 ? (
          <EmptyState>No hay conversaciones para mostrar.</EmptyState>
        ) : null}

        {conversationsQuery.isSuccess && conversations.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Contacto</th>
                <th>Canal</th>
                <th>Estado</th>
                <th>Sucursal</th>
                <th>Agente</th>
                <th>Último mensaje</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((conversation) => (
                <tr key={conversation.id}>
                  {/* Un <button> y no un <Link> desde el ítem 73: esto ya no
                      navega, abre el pop up. Sigue siendo un control y no un
                      onClick sobre la <tr> —se tabula, se activa con Enter y
                      tiene un nombre accesible—, que es lo que el comentario
                      original de este lugar cuidaba.

                      .ds-linklike lo deja con el aspecto del link que era: es
                      la misma acción para quien la usa, y cambiarle la pinta
                      habría sido un cambio de diseño que nadie pidió. */}
                  <td className="ds-cell-primary">
                    <button
                      type="button"
                      className="ds-linklike"
                      onClick={() => setConversacionAbierta(conversation.id)}
                    >
                      {conversation.contact.firstName} {conversation.contact.lastName}
                    </button>
                    {/* El brief truncado, debajo del nombre: es lo que deja
                        escanear la bandeja sin abrir una por una. Solo cuando
                        existe — una segunda línea vacía en cada fila sería
                        ruido, y la fila sin resumen ya se explica sola al
                        abrirla. */}
                    {conversation.brief ? (
                      <span className="ds-cell-secondary">{truncar(conversation.brief)}</span>
                    ) : null}
                  </td>
                  <td>{CHANNEL_LABEL[conversation.channel]}</td>
                  <td>
                    <Badge variant={STATUS_BADGE_VARIANT[conversation.status]}>
                      {STATUS_LABEL[conversation.status]}
                    </Badge>
                  </td>
                  <td>{conversation.branch.name}</td>
                  <td>{conversation.agent.name}</td>
                  {/* Sin mensajes todavía: la conversación existe (la creó el
                      primer turno) pero no hay fecha que mostrar. */}
                  <td>{formatDateTime(conversation.lastMessageAt) || EMPTY_VALUE}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {conversationsQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={conversationsQuery.data.pagination.totalPages}
            onPrevious={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        ) : null}
      </div>

      {/* El hilo, en un pop up (ítem 73). Variante "dialog" y no "panel": el
          contenido es de lectura y el único estado que se puede perder al
          cerrar es una edición del brief a medias, que se vuelve a escribir
          — nada parecido al secreto irreversible que motivó el panel. Por eso
          acá SÍ valen los dos gestos de descarte, click afuera y Escape.

          Se monta solo cuando hay una elegida, así que el detalle no se pide
          hasta que alguien abre una fila. */}
      {conversacionAbierta ? (
        <Modal title="Conversación" onClose={() => setConversacionAbierta(null)} variant="dialog">
          <ConversationDetail id={conversacionAbierta} />
        </Modal>
      ) : null}
    </div>
  );
}
