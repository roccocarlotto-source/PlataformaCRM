import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../design-system/useConfirm";
import { PageHeader } from "../../design-system/PageHeader";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { DetailList, type DetailSection } from "../../design-system/DetailList";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { formatDateTime } from "../../design-system/detailFormat";
import { CHANNEL_LABEL } from "../agent/labels";
import { ConversationBriefCard } from "./ConversationBriefCard";
import { ConversationReplyCard } from "./ConversationReplyCard";
import { CreateVoucherDialog } from "../voucher/CreateVoucherDialog";
import {
  DELIVERY_STATUS_LABEL,
  MARCA_SIN_RESPUESTA,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
} from "./labels";
import { useCloseConversation, useRetryConversationMessage } from "./mutations";
import { puedeAtender } from "./permissions";
import { useConversation } from "./queries";
import type { Conversation, ConversationMessage } from "./types";

// ---------------------------------------------------------------------------
// El hilo de una conversación (ítem 66 de
// docs/frontend-cambios-pendientes.md): quién habló con quién, y todo lo que
// se dijeron, en orden.
//
// RESPONDER (I-03): la tarjeta ConversationReplyCard, debajo del hilo. Existe
// solo para WhatsApp, que ENTREGA el mensaje; el widget web solo recibe la
// respuesta a su propio mensaje, así que ahí la tarjeta explica por qué no se
// puede. Un envío que Meta rechazó queda en su burbuja con "Reintentar".
//
// DOS USOS, UN SOLO COMPONENTE (ítem 73). Sin el prop `id` es la pantalla de
// /conversations/:id, igual que nació; con él es el contenido del pop up que
// abre la bandeja al clickear una fila, que es como se lee normalmente desde
// el ítem 73. La ruta se dejó viva a propósito, por si algo linkea directo a
// una conversación. Lo único que cambia entre los dos usos es el encabezado:
// adentro del Modal no va, porque el Modal ya tiene el suyo.
//
// LO OTRO QUE SE ESCRIBE DESDE ACÁ: el brief (ConversationBriefCard, ítem 73)
// y el cierre manual ("Cerrar conversación", ítem 168). Ninguno de los dos es
// un mensaje. El botón de cerrar va acá y no en la bandeja: la lista sigue sin
// acciones.
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
//
// SIN HERRAMIENTAS. El hilo muestra solo lo que se dijeron el cliente, el
// agente, el vendedor y las automatizaciones. Hasta acá también pintaba
// Message.toolCalls con ToolCallBlock, y eso dejaba a la vista los argumentos
// y resultados crudos de cada tool (la lista de search_vehicles con códigos
// internos y precios de lista, por ejemplo). Eso es diagnóstico y se sigue
// viendo en el probador, que es donde sirve.
//
// SE REFRESCA SOLA (queries.ts, cada 5 s). Por eso un error de un refetch no
// reemplaza la pantalla por el ErrorState: desmontaría la tarjeta "Responder"
// y con ella el borrador, y el <ol> del hilo, y con él el scroll de quien
// estaba leyendo más arriba. El error solo se muestra si no hay nada cargado.
// ---------------------------------------------------------------------------

// Lo que la burbuja muestra de un mensaje, o null si no tiene nada visible
// (y entonces no hay burbuja). Dos casos:
//   - sin texto: un turno del agente que solo ejecutó tools, o un contenido
//     vacío por cualquier otra razón;
//   - un saliente del agente o de una automatización cuyo texto es JSON (un
//     objeto o una lista): el resultado de una tool que se coló como
//     contenido. runAgentTurn no guarda mensajes así, pero si alguno existe
//     no es algo que se le dijo al cliente. Solo para esos dos autores: lo
//     que escribe una persona (cliente o vendedor) se muestra siempre.
function textoVisible(message: ConversationMessage): string | null {
  const texto = message.content.trim();
  if (texto.length === 0) return null;
  if (
    (message.senderType === "AGENT" || message.senderType === "AUTOMATION") &&
    pareceJson(texto)
  ) {
    return null;
  }
  return message.content;
}

function pareceJson(texto: string): boolean {
  const primero = texto[0];
  if (primero !== "{" && primero !== "[") return false;
  try {
    const valor: unknown = JSON.parse(texto);
    return typeof valor === "object" && valor !== null;
  } catch {
    return false;
  }
}

// De qué lado va cada mensaje. Lo decide `direction` y no `senderType`, y es
// a propósito: los dos enums son ortogonales en el schema (la dirección dice
// por dónde viajó el mensaje, el tipo de emisor dice quién lo escribió), y
// del lado del contacto va lo que ENTRÓ. Quién lo escribió lo dice el rótulo
// de la burbuja, que es donde esa información se lee sin ambigüedad.
function ladoDelMensaje(message: ConversationMessage): "contacto" | "agente" {
  return message.direction === "INBOUND" ? "contacto" : "agente";
}

// Los autores posibles. El de una persona es el nombre real cuando el
// backend lo resolvió (senderUser); el fallback cubre el caso raro de un
// mensaje HUMAN cuyo usuario ya no se puede resolver. AUTOMATION (WA-1) no
// lleva el nombre del agente: el mensaje lo mandó una regla, no el agente.
// Una respuesta escrita desde la bandeja de Meta (Business Suite, la app de
// Instagram) y no desde este CRM: llega como eco y se guarda con el id que le
// dio Meta. Las que salen del CRM por Messenger o Instagram no llevan ese id.
// Meta no dice quién la escribió: el nombre es el de quien tiene asignada la
// conversación, y la aclaración evita atribuírsela sin más.
function respondidoDesdeMeta(message: ConversationMessage, conversation: Conversation): boolean {
  return (
    message.senderType === "HUMAN" &&
    message.externalMessageId !== null &&
    (conversation.channel === "MESSENGER" || conversation.channel === "INSTAGRAM")
  );
}

function autorDelMensaje(message: ConversationMessage, conversation: Conversation): string {
  switch (message.senderType) {
    case "CONTACT":
      return `${conversation.contact.firstName} ${conversation.contact.lastName}`;
    case "AGENT":
      return conversation.agent.name;
    case "AUTOMATION":
      return "Automatización";
    case "HUMAN":
    default: {
      const nombre = message.senderUser?.fullName ?? "Un integrante del equipo";
      return respondidoDesdeMeta(message, conversation)
        ? `${nombre} · desde la bandeja de Meta`
        : nombre;
    }
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
  const confirm = useConfirm();
  const { id: idDeLaRuta } = useParams<{ id: string }>();
  const id = idDelProp ?? idDeLaRuta;
  const conversationQuery = useConversation(id);
  // `id ?? ""`: el hook no se puede llamar condicionalmente, y sin id la
  // pantalla nunca llega a mostrar el botón (la query queda deshabilitada).
  const cerrar = useCloseConversation(id ?? "");
  const reintentar = useRetryConversationMessage(id ?? "");
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";
  // B5: "Crear cupón" desde la conversación, el mismo diálogo y las mismas
  // reglas que en la ficha del contacto (#408). Para ADMIN y USER; el backend
  // decide (403 si el vendedor no es el dueño del contacto).
  const [creandoCupon, setCreandoCupon] = useState(false);
  // El pop up ya tiene su propio encabezado (el título del Modal) y su propio
  // cierre: repetir adentro un <h1> "Conversación" y un "Volver a
  // Conversaciones" que vuelve a donde ya se está sería ruido.
  const esPopup = idDelProp !== undefined;

  if (conversationQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  // Con datos ya cargados, un refetch que falla no tapa la pantalla: se sigue
  // mostrando lo último que llegó (ver la cabecera, SE REFRESCA SOLA).
  if (!conversationQuery.data) {
    return (
      <ErrorState>
        No pudimos cargar la conversación
        {conversationQuery.error instanceof Error ? `: ${conversationQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const conversation = conversationQuery.data;

  // Confirma antes, mismo patrón que el resto del repo: cerrar no se deshace
  // desde la pantalla, y el próximo mensaje del contacto abre una conversación
  // NUEVA en vez de seguir en esta.
  async function handleCerrar() {
    const confirmado = await confirm(
      "¿Cerrar esta conversación? Si el contacto vuelve a escribir, se abre una nueva.",
      { confirmLabel: "Cerrar conversación" },
    );
    if (!confirmado) return;
    cerrar.mutate();
  }
  const nombreDelContacto = `${conversation.contact.firstName} ${conversation.contact.lastName}`;
  const visibles = conversation.messages.flatMap((message) => {
    const texto = textoVisible(message);
    return texto === null ? [] : [{ message, texto }];
  });

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
            <>
              <Badge variant={STATUS_BADGE_VARIANT[conversation.status]}>
                {STATUS_LABEL[conversation.status]}
              </Badge>
              {conversation.humanRequestUnanswered ? (
                <>
                  {" "}
                  <Badge variant="danger">{MARCA_SIN_RESPUESTA}</Badge>
                </>
              ) : null}
            </>
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
        <PageHeader title="Conversación" back={{ to: "/conversations", label: "Conversaciones" }} />
      )}

      <div className="ds-stack">
        <Card heading="Datos de la conversación">
          <DetailList sections={sections} />
          <div className="ds-card-actions">
            {/* B5: el mismo diálogo que en la ficha del contacto, con la
                sucursal de la conversación ya elegida. */}
            <Button type="button" onClick={() => setCreandoCupon(true)}>
              Crear cupón
            </Button>
            {/* Solo mientras está abierta: una CLOSED no tiene nada que cerrar. */}
            {conversation.status !== "CLOSED" ? (
              <Button onClick={handleCerrar} disabled={cerrar.isPending} loading={cerrar.isPending}>
                {cerrar.isPending ? "Cerrando…" : "Cerrar conversación"}
              </Button>
            ) : null}
          </div>
          {creandoCupon ? (
            <CreateVoucherDialog
              contactId={conversation.contactId}
              branchIdInicial={conversation.branchId}
              onClose={() => setCreandoCupon(false)}
            />
          ) : null}
          {cerrar.error ? (
            <ErrorState>
              No pudimos cerrar la conversación
              {cerrar.error instanceof Error ? `: ${cerrar.error.message}` : "."}
            </ErrorState>
          ) : null}
        </Card>

        {/* El resumen va ANTES del hilo (ítem 73): la pregunta que trae a
            alguien a esta pantalla es "¿de qué va esto?", y leerlo entero es
            el plan B, no el primero. */}
        <ConversationBriefCard conversation={conversation} />

        <Card heading="Mensajes">
          {visibles.length === 0 ? (
            <EmptyState>Esta conversación todavía no tiene mensajes.</EmptyState>
          ) : (
            <ol className="ds-chat" aria-label="Mensajes de la conversación">
              {visibles.map(({ message, texto }) => {
                const lado = ladoDelMensaje(message);
                return (
                  <li key={message.id} className="ds-chat-item">
                    <div className={`ds-chat-row ds-chat-row--${lado}`}>
                      <div className={claseDeBurbuja(message)}>
                        <span className="ds-chat-author">
                          {autorDelMensaje(message, conversation)} ·{" "}
                          {formatDateTime(message.createdAt)}
                          {/* WA-1: el estado de entrega de un saliente por un
                              canal externo, en el mismo texto chico. El
                              motivo de un FAILED va en el title. */}
                          {message.deliveryStatus ? (
                            <span title={message.deliveryError ?? undefined}>
                              {" "}
                              · {DELIVERY_STATUS_LABEL[message.deliveryStatus]}
                            </span>
                          ) : null}
                        </span>
                        {texto}
                        {/* I-03: una respuesta de una persona que no salió
                            dice por qué, y se reintenta sobre el MISMO
                            mensaje. Solo quien atiende la conversación. */}
                        {message.senderType === "HUMAN" && message.deliveryStatus === "FAILED" ? (
                          <span className="ds-chat-failed">
                            <span className="ds-hint">
                              No pudimos enviar
                              {message.deliveryError ? `: ${message.deliveryError}` : "."}
                            </span>
                            {puedeAtender(me, conversation) && conversation.status !== "CLOSED" ? (
                              <Button
                                onClick={() => reintentar.mutate(message.id)}
                                disabled={reintentar.isPending}
                                loading={
                                  reintentar.isPending && reintentar.variables === message.id
                                }
                              >
                                Reintentar
                              </Button>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {reintentar.error ? (
            <ErrorState>
              No pudimos reintentar el envío
              {reintentar.error instanceof Error ? `: ${reintentar.error.message}` : "."}
            </ErrorState>
          ) : null}
        </Card>

        <ConversationReplyCard conversation={conversation} />
      </div>
    </div>
  );
}
