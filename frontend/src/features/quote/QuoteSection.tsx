import { useState } from "react";
import { useConfirm } from "../../design-system/useConfirm";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { formatDate } from "../opportunity/format";
import type { Opportunity } from "../opportunity/types";
import { formatMoney } from "../../design-system/currencyFormat";
import { quoteTotal } from "./format";
import { QUOTE_STATUS_LABEL } from "./labels";
import {
  useCreateQuote,
  useRevertQuoteAcceptance,
  useTransitionQuote,
  useUpdateQuoteContent,
} from "./mutations";
import { useOpportunityQuotes } from "./queries";
import { QuoteDetail } from "./QuoteDetail";
import { QuoteFormPanel } from "./QuoteFormPanel";
import { formValuesForEdit, formValuesForNew, type QuoteInputFromForm } from "./quoteForm";
import type { Quote, QuoteTransition } from "./types";

export interface QuoteSectionProps {
  opportunity: Pick<Opportunity, "id" | "title" | "amount" | "currency">;
  // PR-17: ADMIN, o el vendedor en una oportunidad que tiene asignada. Sin
  // esto la sección queda en lectura (sin botones de escritura).
  puedeCotizar: boolean;
  // Revertir una aceptación: solo ADMIN.
  puedeRevertir: boolean;
}

type PanelState = { mode: "create" } | { mode: "edit"; quote: Quote } | null;

// Confirmación de las dos transiciones finales: la rechazada no tiene vuelta
// atrás, y la aceptada bloquea crear otra y solo un ADMIN la revierte, así
// que un clic suelto no alcanza. Mismo window.confirm que los "Eliminar" de
// los listados.
const CONFIRM: Partial<Record<QuoteTransition, string>> = {
  ACCEPTED:
    "¿Marcar la cotización como aceptada? No se van a poder crear cotizaciones nuevas para esta oportunidad, y solo un administrador puede deshacerlo.",
  REJECTED: "¿Marcar la cotización como rechazada? No se puede deshacer.",
};

const CONFIRM_REVERTIR =
  "¿Revertir la aceptación? La cotización vuelve a quedar enviada, y se puede volver a cotizar sobre ella.";

// ---------------------------------------------------------------------------
// Sección "Cotización" de la ficha de la oportunidad (§39 de
// docs/frontend-cambios-pendientes.md): la cotización activa arriba, con las
// acciones que admite su estado, y el historial de las anteriores en solo
// lectura. Cuál es la activa lo dice el backend (activeQuoteId); acá no se
// recalcula.
//
// Acciones por estado de la activa:
//   - Borrador: Editar, Enviar, Nueva cotización.
//   - Enviada: Marcar aceptada, Marcar rechazada, Nueva cotización.
//   - Rechazada / Vencida: Nueva cotización.
//   - Aceptada: Nueva cotización deshabilitada, con el motivo a la vista (el
//     backend la rechaza igual con 409). Un ADMIN ve además "Revertir
//     aceptación" (PR-17).
// "Imprimir" siempre que haya una activa: window.print() con el CSS de
// impresión de .ds-quote-printable, que deja en la hoja solo la cotización.
//
// PR-17: quién escribe lo decide OpportunityFormPage (puedeCotizar,
// puedeRevertir), con la misma regla que el backend: ADMIN, o el vendedor en
// lo que tiene asignado. Sin permiso se ve todo y no hay botones de escritura.
// ---------------------------------------------------------------------------
export function QuoteSection({ opportunity, puedeCotizar, puedeRevertir }: QuoteSectionProps) {
  const confirm = useConfirm();
  const quotesQuery = useOpportunityQuotes(opportunity.id);
  const createMutation = useCreateQuote(opportunity.id);
  const editMutation = useUpdateQuoteContent(opportunity.id);
  const transitionMutation = useTransitionQuote(opportunity.id);
  const revertMutation = useRevertQuoteAcceptance(opportunity.id);

  const [panel, setPanel] = useState<PanelState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleTransition(quote: Quote, status: QuoteTransition) {
    const question = CONFIRM[status];
    if (question && !(await confirm(question, { confirmLabel: "Confirmar" }))) return;
    setActionError(null);
    try {
      await transitionMutation.mutateAsync({ id: quote.id, status });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No pudimos cambiar el estado");
    }
  }

  async function handleRevert(quote: Quote) {
    if (!(await confirm(CONFIRM_REVERTIR, { confirmLabel: "Revertir" }))) return;
    setActionError(null);
    try {
      await revertMutation.mutateAsync(quote.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No pudimos revertir la aceptación");
    }
  }

  async function handleCreate(input: QuoteInputFromForm) {
    await createMutation.mutateAsync(input);
    setActionError(null);
    setPanel(null);
  }

  async function handleEdit(quote: Quote, input: QuoteInputFromForm) {
    await editMutation.mutateAsync({ id: quote.id, input });
    setActionError(null);
    setPanel(null);
  }

  let body;
  let active: Quote | null = null;
  let history: Quote[] = [];

  if (quotesQuery.isLoading) {
    body = <LoadingState variant="rows" />;
  } else if (quotesQuery.isError) {
    body = (
      <ErrorState>
        No pudimos cargar las cotizaciones
        {quotesQuery.error instanceof Error ? `: ${quotesQuery.error.message}` : "."}
      </ErrorState>
    );
  } else if (quotesQuery.data) {
    const { data, activeQuoteId } = quotesQuery.data;
    active = data.find((quote) => quote.id === activeQuoteId) ?? null;
    history = data.filter((quote) => quote.id !== activeQuoteId);
  }

  const isBusy = transitionMutation.isPending || revertMutation.isPending;
  const createBlocked = active?.status === "ACCEPTED";

  if (!body) {
    body = active ? (
      <>
        <div className="ds-quote-printable">
          {/* Solo en papel: en pantalla el título de la tarjeta ya dice qué
              es y de qué oportunidad. */}
          <div className="ds-print-only">
            <h1>Cotización</h1>
            <p>{opportunity.title}</p>
          </div>
          <QuoteDetail quote={active} />
        </div>
        <div className="ds-quote-actions">
          {puedeCotizar && active.status === "DRAFT" ? (
            <>
              <Button
                variant="primary"
                disabled={isBusy}
                loading={isBusy && transitionMutation.variables?.status === "SENT"}
                onClick={() => handleTransition(active, "SENT")}
              >
                Enviar
              </Button>
              <Button disabled={isBusy} onClick={() => setPanel({ mode: "edit", quote: active })}>
                Editar
              </Button>
            </>
          ) : null}
          {puedeCotizar && active.status === "SENT" ? (
            <>
              <Button
                variant="primary"
                disabled={isBusy}
                loading={isBusy && transitionMutation.variables?.status === "ACCEPTED"}
                onClick={() => handleTransition(active, "ACCEPTED")}
              >
                Marcar aceptada
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                loading={isBusy && transitionMutation.variables?.status === "REJECTED"}
                onClick={() => handleTransition(active, "REJECTED")}
              >
                Marcar rechazada
              </Button>
            </>
          ) : null}
          {puedeRevertir && active.status === "ACCEPTED" ? (
            <Button
              disabled={isBusy}
              loading={revertMutation.isPending}
              onClick={() => handleRevert(active)}
            >
              Revertir aceptación
            </Button>
          ) : null}
          {puedeCotizar ? (
            <Button disabled={isBusy || createBlocked} onClick={() => setPanel({ mode: "create" })}>
              Nueva cotización
            </Button>
          ) : null}
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>
        {puedeCotizar && createBlocked ? (
          <p className="ds-hint ds-quote-blocked">
            Esta cotización fue aceptada: no se pueden crear cotizaciones nuevas para esta
            oportunidad.
          </p>
        ) : null}
      </>
    ) : (
      <>
        <EmptyState>Todavía no hay cotizaciones para esta oportunidad.</EmptyState>
        {puedeCotizar ? (
          <div className="ds-quote-actions">
            <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>
              Nueva cotización
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="ds-form ds-stack ds-quote-section">
      <Card heading="Cotización" aria-label="Cotización">
        {body}
        {actionError ? <ErrorState>{actionError}</ErrorState> : null}
      </Card>

      {quotesQuery.data ? (
        <Card
          heading="Historial de cotizaciones"
          aria-label="Historial de cotizaciones"
          className="ds-quote-history"
        >
          {history.length === 0 ? (
            <EmptyState>No hay cotizaciones anteriores.</EmptyState>
          ) : (
            <ul className="ds-quote-history-list">
              {history.map((quote) => (
                <li key={quote.id}>
                  {/* <details> nativo: cada entrada se abre para ver el
                      desglose completo sin sumar estado ni controles. */}
                  <details>
                    <summary>
                      {formatDate(quote.createdAt)} ·{" "}
                      {formatMoney(quoteTotal(quote), quote.currency)} ·{" "}
                      {QUOTE_STATUS_LABEL[quote.status]}
                    </summary>
                    <QuoteDetail quote={quote} />
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {panel?.mode === "create" ? (
        <QuoteFormPanel
          title="Nueva cotización"
          initialValues={formValuesForNew(active, opportunity)}
          supersedeNotice={active?.status === "DRAFT" || active?.status === "SENT"}
          onSubmit={handleCreate}
          onClose={() => setPanel(null)}
          isSubmitting={createMutation.isPending}
        />
      ) : null}
      {panel?.mode === "edit" ? (
        <QuoteFormPanel
          title="Editar cotización"
          initialValues={formValuesForEdit(panel.quote)}
          onSubmit={(input) => handleEdit(panel.quote, input)}
          onClose={() => setPanel(null)}
          isSubmitting={editMutation.isPending}
        />
      ) : null}
    </div>
  );
}
