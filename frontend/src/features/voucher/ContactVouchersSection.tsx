import { Badge } from "../../design-system/Badge";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { formatDateOnly } from "../../design-system/detailFormat";
import { VOUCHER_STATUS_LABEL, VOUCHER_STATUS_VARIANT } from "./labels";
import { useContactVouchers } from "./queries";

// ---------------------------------------------------------------------------
// Tarjeta "Cupones" de la ficha del contacto: todos sus cupones, los de la
// regla y los creados a mano, con su estado. Solo lectura: crear es el botón
// "Crear cupón" del encabezado, y canjear, la pantalla de escaneo. Reusa las
// filas de la tarjeta de Pagos (.ds-payment-list) para no sumar estilos.
// ---------------------------------------------------------------------------

export function ContactVouchersSection({ contactId }: { contactId: string }) {
  const query = useContactVouchers(contactId);
  const vouchers = query.data?.data ?? [];

  // Mismo envoltorio que las tarjetas de la oportunidad (PaymentSection): el
  // ancho y el centrado de .ds-form.
  return (
    <div className="ds-form ds-stack">
      <Card heading="Cupones">
        {query.isLoading ? <LoadingState variant="lines" /> : null}
        {query.isError ? <ErrorState>No pudimos cargar los cupones.</ErrorState> : null}
        {query.isSuccess && vouchers.length === 0 ? (
          <EmptyState>Este contacto todavía no tiene cupones.</EmptyState>
        ) : null}
        {vouchers.length > 0 ? (
          <ul className="ds-payment-list" aria-label="Cupones del contacto">
            {vouchers.map((voucher) => (
              <li key={voucher.id} className="ds-payment-row">
                <span className="ds-payment-data">
                  {voucher.label} · {voucher.status === "CONSUMED" ? "canjeado el " : "vence el "}
                  {formatDateOnly(
                    voucher.status === "CONSUMED" ? voucher.consumedAt : voucher.expiresAt,
                  )}
                  {voucher.origin === "AUTOMATION" ? " · por regla" : ""}
                </span>
                <Badge variant={VOUCHER_STATUS_VARIANT[voucher.status]}>
                  {VOUCHER_STATUS_LABEL[voucher.status]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
