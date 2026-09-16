import { Badge } from "../../design-system/Badge";
import { formatDateTime } from "../../design-system/detailFormat";
import { Table } from "../../design-system/Table";
import { formatDate } from "../opportunity/format";
import { formatMoney, quoteTotal, vehicleLabel } from "./format";
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_VARIANT } from "./labels";
import type { Quote } from "./types";

export interface QuoteDetailProps {
  quote: Quote;
}

// ---------------------------------------------------------------------------
// Una cotización en solo lectura: estado, quién y cuándo, la unidad cotizada,
// el desglose (precio ofertado + líneas = total) y la validez. Lo usan la
// activa y cada entrada del historial, así las dos se leen igual y lo que se
// imprime es exactamente lo que se ve.
// ---------------------------------------------------------------------------
export function QuoteDetail({ quote }: QuoteDetailProps) {
  return (
    <div className="ds-quote">
      <p className="ds-quote-meta">
        <Badge variant={QUOTE_STATUS_VARIANT[quote.status]}>
          {QUOTE_STATUS_LABEL[quote.status]}
        </Badge>
        <span>
          Creada el {formatDateTime(quote.createdAt)} por {quote.createdBy.fullName}
        </span>
      </p>
      {quote.vehicle ? (
        <p className="ds-quote-vehicle">Unidad: {vehicleLabel(quote.vehicle)}</p>
      ) : null}
      <Table>
        <thead>
          <tr>
            <th>Concepto</th>
            <th className="ds-quote-amount">Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Precio ofertado</td>
            <td className="ds-quote-amount">{formatMoney(quote.amount, quote.currency)}</td>
          </tr>
          {quote.lines.map((line, index) => (
            // Índice como key: las líneas de una cotización guardada no se
            // reordenan ni cambian mientras se muestran.
            <tr key={index}>
              <td>{line.description}</td>
              <td className="ds-quote-amount">{formatMoney(line.amount, quote.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="ds-quote-total">
            <th scope="row">Total</th>
            <td className="ds-quote-amount">{formatMoney(quoteTotal(quote), quote.currency)}</td>
          </tr>
        </tfoot>
      </Table>
      <p className="ds-quote-validity">
        {quote.validUntil
          ? `Válida hasta el ${formatDate(quote.validUntil)}`
          : "Sin fecha de validez"}
      </p>
    </div>
  );
}
