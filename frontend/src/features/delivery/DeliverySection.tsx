import { useState, type FormEvent } from "react";
import { minimoDeFecha } from "../opportunity/boardMove";
import { useConfirm } from "../../design-system/useConfirm";
import { EmptyState } from "../../design-system/EmptyState";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { formatDateTime } from "../../design-system/detailFormat";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import type { Opportunity } from "../opportunity/types";
import { vehicleLabel } from "../quote/format";
import { DELIVERY_STATUS_LABEL, DELIVERY_STATUS_VARIANT } from "./labels";
import { confirmQuestion } from "./confirmQuestion";
import { useConfirmDelivery, useRevertDelivery, useUpdateDelivery } from "./mutations";
import { useOpportunityDelivery } from "./queries";
import type { Delivery, UpdateDeliveryInput } from "./types";

export interface DeliverySectionProps {
  opportunity: Pick<Opportunity, "id" | "status">;
  // PR-17: la entrega la opera solo ADMIN. Sin esto la tarjeta se ve
  // completa (estado, fecha, checklist) pero sin controles.
  puedeOperar: boolean;
}

// ---------------------------------------------------------------------------
// Tarjeta "Entrega" de la ficha de la oportunidad (§40 de
// docs/frontend-cambios-pendientes.md), debajo de Cotización.
//
// Solo aparece con la oportunidad GANADA y una entrega existente: la entrega
// nace sola en el backend al ganar con unidad vinculada, así que una ganada
// sin unidad (o una abierta/perdida) no tiene tarjeta. Mientras carga tampoco
// se muestra nada, para no hacer aparecer y desaparecer una tarjeta vacía.
// Un error de red sí se muestra: callarlo escondería una entrega que existe.
//
// Mientras está pendiente, cada cambio (tildar, agregar o quitar un ítem,
// cambiar la fecha) se guarda al instante con un PATCH, sin botón Guardar: el
// checklist se completa en el mostrador, de a un ítem. Los controles se
// deshabilitan mientras hay un PATCH en curso, para que dos cambios rápidos
// no se pisen mandando cada uno la lista entera. La fecha se guarda al salir
// del campo y no en cada onChange: tipear un año dígito a dígito mandaría
// "0002-09-30" y compañía.
//
// Una vez entregada todo queda en solo lectura, con quién y cuándo. Lo único
// que queda es "Revertir entrega", para una confirmada por error: vuelve a
// pendiente y la unidad a Vendido, y queda en el historial de la unidad.
//
// PR-17: el vendedor la ve en lectura (puedeOperar = false): sin Quitar,
// Agregar, Confirmar ni Revertir, y la fecha y los tildes deshabilitados. Las
// escrituras siguen siendo authorize("ADMIN") en el backend.
// ---------------------------------------------------------------------------
export function DeliverySection({ opportunity, puedeOperar }: DeliverySectionProps) {
  const isWon = opportunity.status === "WON";
  const deliveryQuery = useOpportunityDelivery(opportunity.id, { enabled: isWon });

  if (!isWon || deliveryQuery.isLoading) return null;

  if (deliveryQuery.isError) {
    return (
      <div className="ds-form ds-stack ds-delivery-section">
        <Card heading="Entrega" aria-label="Entrega">
          <ErrorState>
            No pudimos cargar la entrega
            {deliveryQuery.error instanceof Error ? `: ${deliveryQuery.error.message}` : "."}
          </ErrorState>
        </Card>
      </div>
    );
  }

  const delivery = deliveryQuery.data?.data[0];
  if (!delivery) return null;

  // key: si la entrega cambia de id (no debería), el estado local de la fecha
  // y del ítem nuevo arranca de cero.
  return (
    <DeliveryCard
      key={delivery.id}
      opportunityId={opportunity.id}
      delivery={delivery}
      puedeOperar={puedeOperar}
    />
  );
}

interface DeliveryCardProps {
  opportunityId: string;
  delivery: Delivery;
  puedeOperar: boolean;
}

function DeliveryCard({ opportunityId, delivery, puedeOperar }: DeliveryCardProps) {
  const confirm = useConfirm();
  const updateMutation = useUpdateDelivery(opportunityId);
  const confirmMutation = useConfirmDelivery(opportunityId);
  const revertMutation = useRevertDelivery(opportunityId);

  const savedDate = delivery.scheduledAt ? delivery.scheduledAt.slice(0, 10) : "";
  const [scheduledAt, setScheduledAt] = useState(savedDate);
  const [newItem, setNewItem] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Editable = pendiente y con permiso. Sin permiso, todo como si estuviera
  // entregada: se ve, no se toca.
  const editable = delivery.status === "PENDING" && puedeOperar;
  const isBusy = updateMutation.isPending || confirmMutation.isPending || revertMutation.isPending;
  const locked = !editable || isBusy;

  async function save(input: UpdateDeliveryInput) {
    setActionError(null);
    try {
      await updateMutation.mutateAsync({ id: delivery.id, input });
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No pudimos guardar la entrega");
      return false;
    }
  }

  function toggle(index: number) {
    void save({
      checklist: delivery.checklist.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item,
      ),
    });
  }

  function remove(index: number) {
    void save({ checklist: delivery.checklist.filter((_, i) => i !== index) });
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = newItem.trim();
    if (!label) return;
    if (await save({ checklist: [...delivery.checklist, { label, checked: false }] })) {
      setNewItem("");
    }
  }

  function commitDate() {
    if (scheduledAt === savedDate) return;
    void save({ scheduledAt: scheduledAt || null });
  }

  async function handleConfirm() {
    if (
      !(await confirm(confirmQuestion(delivery.checklist), { confirmLabel: "Confirmar entrega" }))
    )
      return;
    setActionError(null);
    try {
      await confirmMutation.mutateAsync(delivery.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No pudimos confirmar la entrega");
    }
  }

  async function handleRevert() {
    if (
      !(await confirm(
        "¿Revertir la entrega? Vuelve a quedar pendiente y la unidad pasa de Entregado a Vendido. Queda registrado en el historial de la unidad.",
        { confirmLabel: "Revertir entrega", danger: true },
      ))
    )
      return;
    setActionError(null);
    try {
      await revertMutation.mutateAsync(delivery.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No pudimos revertir la entrega");
    }
  }

  return (
    <div className="ds-form ds-stack ds-delivery-section">
      <Card heading="Entrega" aria-label="Entrega">
        <div className="ds-delivery">
          <p className="ds-delivery-meta">
            <Badge variant={DELIVERY_STATUS_VARIANT[delivery.status]}>
              {DELIVERY_STATUS_LABEL[delivery.status]}
            </Badge>
            {delivery.status === "DELIVERED" ? (
              <span>
                Entregada el {formatDateTime(delivery.deliveredAt)}
                {delivery.deliveredBy ? ` por ${delivery.deliveredBy.fullName}` : ""}
              </span>
            ) : null}
          </p>
          {delivery.vehicle ? (
            <p className="ds-delivery-vehicle">Unidad: {vehicleLabel(delivery.vehicle)}</p>
          ) : null}

          <FormField label="Fecha programada">
            <input
              type="date"
              min={minimoDeFecha(savedDate)}
              value={scheduledAt}
              disabled={locked}
              onChange={(event) => setScheduledAt(event.target.value)}
              onBlur={commitDate}
            />
          </FormField>

          <h3 className="ds-delivery-subtitle">Qué se entrega</h3>
          {delivery.checklist.length === 0 ? (
            <EmptyState>La lista de lo que se entrega está vacía.</EmptyState>
          ) : (
            <ul className="ds-delivery-checklist">
              {delivery.checklist.map((item, index) => (
                // Índice como key: los ítems no tienen id propio, y el orden
                // solo cambia al quitar uno, que vuelve a renderizar la lista
                // con lo que devolvió el backend.
                <li key={index}>
                  <FormField label={item.label}>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={locked}
                      onChange={() => toggle(index)}
                    />
                  </FormField>
                  {editable ? (
                    <Button
                      disabled={isBusy}
                      aria-label={`Quitar: ${item.label}`}
                      onClick={() => remove(index)}
                    >
                      Quitar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {editable ? (
            // <form> propio para que Enter agregue el ítem. No está anidado:
            // la sección vive fuera del <form> de la oportunidad.
            <form className="ds-delivery-add" onSubmit={add}>
              <FormField label="Agregar ítem">
                <input
                  type="text"
                  value={newItem}
                  maxLength={200}
                  disabled={isBusy}
                  onChange={(event) => setNewItem(event.target.value)}
                />
              </FormField>
              <Button type="submit" disabled={isBusy || newItem.trim() === ""}>
                Agregar
              </Button>
            </form>
          ) : null}
        </div>

        {puedeOperar ? (
          <div className="ds-delivery-actions">
            <Button
              variant="primary"
              disabled={locked}
              loading={confirmMutation.isPending}
              onClick={handleConfirm}
            >
              Confirmar entrega
            </Button>
            {delivery.status === "DELIVERED" ? (
              <Button disabled={isBusy} loading={revertMutation.isPending} onClick={handleRevert}>
                Revertir entrega
              </Button>
            ) : null}
          </div>
        ) : null}
        {actionError ? <ErrorState>{actionError}</ErrorState> : null}
      </Card>
    </div>
  );
}
