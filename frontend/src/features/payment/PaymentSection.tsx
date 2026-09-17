import { useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { CurrencyInput } from "../../design-system/CurrencyInput";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { formatDate } from "../opportunity/format";
import type { Opportunity } from "../opportunity/types";
import { formatMoney } from "../quote/format";
import { PAYMENT_METHOD_LABEL } from "./labels";
import { useCreatePayment, useDeletePayment, useUpdatePayment } from "./mutations";
import {
  formValuesForEdit,
  formValuesForNew,
  toPaymentInput,
  validatePaymentForm,
  type PaymentFormValues,
} from "./paymentForm";
import { useOpportunityPayments } from "./queries";
import { paymentTotals } from "./totals";
import type { Payment, PaymentMethod } from "./types";

export interface PaymentSectionProps {
  opportunity: Pick<Opportunity, "id" | "amount" | "currency">;
}

const METHODS = Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[];

// Qué formulario está abierto: ninguno, el de alta, o la edición de un pago.
// Uno a la vez, para que no haya dos borradores compitiendo.
type Editing = null | { mode: "create" } | { mode: "edit"; paymentId: string };

// ---------------------------------------------------------------------------
// Tarjeta "Pagos" de la ficha de la oportunidad (§43 de
// docs/frontend-cambios-pendientes.md), la última: el cobro cierra el proceso
// comercial, después de cotización, entrega y permuta.
//
// Se muestra SIEMPRE en edición, sin gating por estado, como Permuta: se cobra
// una seña con la oportunidad abierta y cuotas con la ganada. Es informativa:
// nada de lo que se carga acá bloquea la entrega ni el cierre.
//
// El historial se pide aparte (GET /payments?opportunityId=), más nuevo
// primero. Alta y edición en un formulario inline; borrar pide
// window.confirm. El total "Pagado / Saldo" se calcula en el cliente
// (totals.ts) y solo suma los pagos en la moneda ACTUAL de la oportunidad.
//
// Vive en OpportunityFormPage, que es ADMIN-only: no hay gating por rol acá,
// las escrituras son authorize("ADMIN") en el backend.
// ---------------------------------------------------------------------------
export function PaymentSection({ opportunity }: PaymentSectionProps) {
  const paymentsQuery = useOpportunityPayments(opportunity.id);
  const createMutation = useCreatePayment(opportunity.id);
  const updateMutation = useUpdatePayment(opportunity.id);
  const deleteMutation = useDeletePayment(opportunity.id);

  const [editing, setEditing] = useState<Editing>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const payments = paymentsQuery.data?.data ?? [];
  const truncated =
    paymentsQuery.data !== undefined && paymentsQuery.data.pagination.total > payments.length;
  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  async function handleCreate(values: PaymentFormValues) {
    setActionError(null);
    try {
      await createMutation.mutateAsync(toPaymentInput(values));
      setEditing(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo guardar el pago");
    }
  }

  async function handleUpdate(payment: Payment, values: PaymentFormValues) {
    setActionError(null);
    try {
      await updateMutation.mutateAsync({ id: payment.id, input: toPaymentInput(values) });
      setEditing(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo guardar el pago");
    }
  }

  async function handleDelete(payment: Payment) {
    if (!window.confirm(`¿Borrar este pago de ${formatMoney(payment.amount, payment.currency)}?`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(payment.id);
      if (editing?.mode === "edit" && editing.paymentId === payment.id) setEditing(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo borrar el pago");
    }
  }

  function openForm(next: Editing) {
    setActionError(null);
    setEditing(next);
  }

  const totals = paymentTotals(payments, opportunity);

  return (
    <div className="ds-form ds-stack ds-payment-section">
      <Card heading="Pagos" aria-label="Pagos">
        <div className="ds-payment">
          {paymentsQuery.isError ? (
            <ErrorState>
              No pudimos cargar los pagos
              {paymentsQuery.error instanceof Error ? `: ${paymentsQuery.error.message}` : "."}
            </ErrorState>
          ) : paymentsQuery.isLoading ? null : (
            <>
              {payments.length === 0 ? (
                <p className="ds-hint">Todavía no se registraron pagos.</p>
              ) : (
                <ul className="ds-payment-list" aria-label="Pagos registrados">
                  {payments.map((payment) =>
                    editing?.mode === "edit" && editing.paymentId === payment.id ? (
                      <li key={payment.id}>
                        <PaymentForm
                          initialValues={formValuesForEdit(payment)}
                          submitLabel="Guardar"
                          isSubmitting={updateMutation.isPending}
                          onSubmit={(values) => handleUpdate(payment, values)}
                          onCancel={() => openForm(null)}
                        />
                      </li>
                    ) : (
                      <li key={payment.id} className="ds-payment-row">
                        <span className="ds-payment-data">
                          {formatDate(payment.paidAt)} ·{" "}
                          {formatMoney(payment.amount, payment.currency)} ·{" "}
                          {PAYMENT_METHOD_LABEL[payment.method]}
                        </span>
                        <span className="ds-payment-row-actions">
                          <Button
                            disabled={isBusy}
                            aria-label={`Editar el pago de ${formatMoney(payment.amount, payment.currency)} del ${formatDate(payment.paidAt)}`}
                            onClick={() => openForm({ mode: "edit", paymentId: payment.id })}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="danger"
                            disabled={isBusy}
                            aria-label={`Borrar el pago de ${formatMoney(payment.amount, payment.currency)} del ${formatDate(payment.paidAt)}`}
                            onClick={() => handleDelete(payment)}
                          >
                            Borrar
                          </Button>
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              )}

              <p className="ds-payment-total">
                Pagado: {formatMoney(totals.paid, opportunity.currency)} de{" "}
                {formatMoney(opportunity.amount, opportunity.currency)} · Saldo:{" "}
                {formatMoney(totals.balance, opportunity.currency)}
              </p>
              {totals.excludedCount > 0 ? (
                <p className="ds-hint">
                  {totals.excludedCount === 1
                    ? "1 pago en otra moneda no incluido en el total."
                    : `${totals.excludedCount} pagos en otra moneda no incluidos en el total.`}
                </p>
              ) : null}
              {truncated ? (
                <p className="ds-hint">
                  Se muestran los {payments.length} pagos más recientes: el total solo suma esos.
                </p>
              ) : null}
            </>
          )}

          {editing?.mode === "create" ? (
            <PaymentForm
              initialValues={formValuesForNew()}
              submitLabel="Agregar"
              isSubmitting={createMutation.isPending}
              onSubmit={handleCreate}
              onCancel={() => openForm(null)}
            />
          ) : (
            <div>
              <Button
                variant="primary"
                disabled={isBusy || paymentsQuery.isError}
                onClick={() => openForm({ mode: "create" })}
              >
                Agregar pago
              </Button>
            </div>
          )}
        </div>
        {actionError ? <ErrorState>{actionError}</ErrorState> : null}
      </Card>
    </div>
  );
}

interface PaymentFormProps {
  initialValues: PaymentFormValues;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: (values: PaymentFormValues) => Promise<void>;
  onCancel: () => void;
}

// <form> propio para que Enter guarde. No está anidado: la sección vive fuera
// del <form> de la oportunidad.
function PaymentForm({
  initialValues,
  submitLabel,
  isSubmitting,
  onSubmit,
  onCancel,
}: PaymentFormProps) {
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validatePaymentForm(values);
    setValidationError(error);
    if (error) return;
    void onSubmit(values);
  }

  return (
    <form className="ds-payment-form" aria-label="Pago" onSubmit={handleSubmit}>
      <div className="ds-payment-fields">
        <FormField label={<span className="ds-required">Monto</span>}>
          <CurrencyInput
            value={values.amount}
            onChange={(amount) => setValues((current) => ({ ...current, amount }))}
          />
        </FormField>
        <FormField label={<span className="ds-required">Método</span>}>
          <select
            value={values.method}
            onChange={(event) =>
              setValues((current) => ({ ...current, method: event.target.value as PaymentMethod }))
            }
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABEL[method]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={<span className="ds-required">Fecha</span>}>
          <input
            type="date"
            value={values.paidAt}
            onChange={(event) =>
              setValues((current) => ({ ...current, paidAt: event.target.value }))
            }
          />
        </FormField>
      </div>
      {validationError ? <ErrorState>{validationError}</ErrorState> : null}
      <div className="ds-payment-form-actions">
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : submitLabel}
        </Button>
        <Button disabled={isSubmitting} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
