import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { Card } from "../../design-system/Card";
import { DetailList, type DetailSection } from "../../design-system/DetailList";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { formatDateTime } from "../../design-system/detailFormat";
import { CHANNEL_LABEL } from "../agent/labels";
import { ToolCallBlock } from "../agent/ToolCallBlock";
import { ConversationBriefCard } from "./ConversationBriefCard";
import { STATUS_BADGE_VARIANT, STATUS_LABEL } from "./labels";
import { useConversation } from "./queries";
import { parseToolCalls } from "./toolCalls";
import type { Conversation, ConversationMessage } from "./types";

// ---------------------------------------------------------------------------
// El hilo de una conversación (ítem 66 de
// docs/frontend-cambios-pendientes.md): quién habló con quién, y todo lo que
// se dijeron, en orden.
//
// ES SOLO LECTURA, Y LA PANTALLA TERMINA AHÍ: no hay caja de texto, no hay
// "Responder", no hay "Cerrar conversación". No es una omisión de esta
// pantalla sino del sistema entero: guardar un Message OUTBOUND no lo
// ENTREGA por el canal —el widget web solo puede recibir la respuesta a su
// propio mensaje, y WhatsApp todavía no existe (paso 6 de
// docs/ai-agent-architecture.md §9)—, así que un botón "Responder" mostraría
// como enviado algo que el contacto nunca va a recibir. Hay un test que
// afirma que acá no hay ningún control para escribir, justamente para que
// nadie lo agregue sin resolver antes la entrega.
//
// DOS USOS, UN SOLO COMPONENTE (ítem 73). Sin el prop `id` es la pantalla de
// /conversations/:id, igual que nació; con él es el contenido del pop up que
// abre la bandeja al clickear una fila, que es como se lee normalmente desde
// el ítem 73. La ruta se dejó viva a propósito, por si algo linkea directo a
// una conversación. Lo único que cambia entre los dos usos es el encabezado:
// adentro del Modal no va, porque el Modal ya tiene el suyo.
//
// LO QUE SÍ SE ESCRIBE DESDE ACÁ, y es la única escritura de toda la feature:
// el brief (ConversationBriefCard). Sigue sin haber forma de responder ni de
// cerrar una conversación, por el motivo de abajo — un brief no es un mensaje
// y no se entrega por ningún canal.
//
// FUERA DE AdminRoute, como el listado. El único gate por rol de toda la
// feature está abajo, en el link a la ficha del contacto, y es por una razón
// concreta: /contacts/:id/edit SÍ vive dentro de AdminRoute, así que a un
// USER ese link lo mandaría a /companies. El nombre se muestra igual, sin
// link — que el dato esté a la vista y no sea navegable informa más que
// esconderlo, mismo criterio que el campo deshabilitado de BranchSelect.
//
// LAS BURBUJAS SON LAS DEL PROBADOR (ítem 65), literalmente las mismas clases
// .ds-chat*: los dos muestran el mismo hilo del mismo modelo, y dos lenguajes
// visuales distintos para lo mismo serían una inconsistencia, no una
// decisión. Lo único nuevo es .ds-chat-bubble--humano, porque acá sí aparece
// un tercer autor que el probador no puede producir: una persona de la
// organización contestando después de una derivación.
// ---------------------------------------------------------------------------

// De qué lado va cada mensaje. Lo decide `direction` y no `senderType`, y es
// a propósito: los dos enums son ortogonales en el schema (la dirección dice
// por dónde viajó el mensaje, el tipo de emisor dice quién lo escribió), y
// del lado del contacto va lo que ENTRÓ. Quién lo escribió lo dice el rótulo
// de la burbuja, que es donde esa información se lee sin ambigüedad.
function ladoDelMensaje(message: ConversationMessage): "contacto" | "agente" {
  return message.direction === "INBOUND" ? "contacto" : "agente";
}

// Los tres autores posibles. El de una persona es el nombre real cuando el
// backend lo resolvió (senderUser); el fallback cubre el caso raro de un
// mensaje HUMAN cuyo usuario ya no se puede resolver.
function autorDelMensaje(message: ConversationMessage, conversation: Conversation): string {
  switch (message.senderType) {
    case "CONTACT":
      return `${conversation.contact.firstName} ${conversation.contact.lastName}`;
    case "AGENT":
      return conversation.agent.name;
    case "HUMAN":
    default:
      return message.senderUser?.fullName ?? "Un integrante del equipo";
  }
}

function claseDeBurbuja(message: ConversationMessage): string {
  // Solo el mensaje de una persona lleva modificador: el del contacto ya se
  // distingue por el lado y el color que le da .ds-chat-row--contacto, y el
  // del agente es la burbuja base.
  return message.senderType === "HUMAN"
    ? "ds-chat-bubble ds-chat-bubble--humano"
    : "ds-chat-bubble";
}

export interface ConversationDetailProps {
  // El id de la conversación a mostrar. SIN ÉL, sale de useParams() y el
  // componente es la pantalla de /conversations/:id, igual que siempre; CON
  // él, es el contenido del pop up que abre la bandeja (ítem 73), montado
  // dentro de un Modal que ya sabe qué fila se clickeó.
  //
  // Un prop opcional y no dos componentes: lo que se muestra es exactamente lo
  // mismo en los dos usos —los datos, el brief y el hilo entero—, y lo único
  // que cambia es de dónde sale el id. Partirlo en dos habría dejado dos
  // copias de la pantalla para mantener.
  //
  // useParams() se sigue llamando siempre, aunque el prop venga: un hook no se
  // puede llamar condicionalmente. Fuera de un Router devuelve {} sin romper,
  // así que no le pone ningún requisito al Modal que lo monte.
  id?: string;
}

export function ConversationDetail({ id: idDelProp }: ConversationDetailProps = {}) {
  const { id: idDeLaRuta } = useParams<{ id: string }>();
  const id = idDelProp ?? idDeLaRuta;
  const conversationQuery = useConversation(id);
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";
  // El pop up ya tiene su propio encabezado (el título del Modal) y su propio
  // cierre: repetir adentro un <h1> "Conversación" y un "Volver a
  // Conversaciones" que vuelve a donde ya se está sería ruido.
  const esPopup = idDelProp !== undefined;

  if (conversationQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (conversationQuery.isError || !conversationQuery.data) {
    return (
      <ErrorState>
        No pudimos cargar la conversación
        {conversationQuery.error instanceof Error ? `: ${conversationQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const conversation = conversationQuery.data;
  const nombreDelContacto = `${conversation.contact.firstName} ${conversation.contact.lastName}`;

  const sections: DetailSection[] = [
    {
      items: [
        {
          label: "Contacto",
          value: isAdmin ? (
            <Link to={`/contacts/${conversation.contactId}/edit`}>{nombreDelContacto}</Link>
          ) : (
            nombreDelContacto
          ),
        },
        { label: "Canal", value: CHANNEL_LABEL[conversation.channel] },
        {
          label: "Estado",
          value: (
            <Badge variant={STATUS_BADGE_VARIANT[conversation.status]}>
              {STATUS_LABEL[conversation.status]}
            </Badge>
          ),
        },
        { label: "Sucursal", value: conversation.branch.name },
        { label: "Agente", value: conversation.agent.name },
        { label: "Inicio", value: formatDateTime(conversation.createdAt) },
        { label: "Último mensaje", value: formatDateTime(conversation.lastMessageAt) },
      ],
    },
  ];

  return (
    <div className="ds-form">
      {/* Dentro del pop up no va: el Modal ya pone el título y el cierre. */}
      {esPopup ? null : (
        <div className="ds-page-header">
          <h1>Conversación</h1>
          <Link to="/conversations">Volver a Conversaciones</Link>
        </div>
      )}

      <div className="ds-stack">
        <Card heading="Datos de la conversación">
          <DetailList sections={sections} />
        </Card>

        {/* El resumen va ANTES del hilo (ítem 73): la pregunta que trae a
            alguien a esta pantalla es "¿de qué va esto?", y leerlo entero es
            el plan B, no el primero. */}
        <ConversationBriefCard conversation={conversation} />

        <Card heading="Mensajes">
          {conversation.messages.length === 0 ? (
            <EmptyState>Esta conversación todavía no tiene mensajes.</EmptyState>
          ) : (
            <ol className="ds-chat" aria-label="Mensajes de la conversación">
              {conversation.messages.map((message) => {
                const llamadas = parseToolCalls(message.toolCalls);
                const lado = ladoDelMensaje(message);
                return (
                  <li key={message.id} className="ds-chat-item">
                    {/* Las tool calls van ARRIBA de la burbuja porque es el
                        orden en que ocurrieron: el modelo las ejecuta y
                        recién después produce el texto de la respuesta.
                        Mismo orden que el probador. */}
                    {llamadas
                      ? llamadas.map((llamada) => (
                          <div key={llamada.id} className="ds-chat-row ds-chat-row--tool">
                            <ToolCallBlock llamada={llamada} />
                          </div>
                        ))
                      : null}
                    {/* Una forma que no reconocemos no se esconde: el JSON
                        crudo sigue diciendo más que nada. Ver toolCalls.ts. */}
                    {llamadas === null && message.toolCalls ? (
                      <div className="ds-chat-row ds-chat-row--tool">
                        <div className="ds-chat-tool">
                          <p className="ds-chat-tool-line">
                            Herramientas: <code>{JSON.stringify(message.toolCalls)}</code>
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <div className={`ds-chat-row ds-chat-row--${lado}`}>
                      <div className={claseDeBurbuja(message)}>
                        <span className="ds-chat-author">
                          {autorDelMensaje(message, conversation)} ·{" "}
                          {formatDateTime(message.createdAt)}
                        </span>
                        {message.content}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
