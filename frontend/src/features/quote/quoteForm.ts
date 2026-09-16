import type { Quote, QuoteLineInput } from "./types";

// ---------------------------------------------------------------------------
// Estado del formulario de cotización y su traducción al contrato. Funciones
// puras, sin React (quoteForm.test.ts), mismo criterio que boardMove.ts.
//
// Los importes viven como VALOR CANÓNICO de CurrencyInput ("24150.5"), que no
// admite signo. Por eso una línea no guarda un importe negativo: guarda el
// importe positivo y su tipo (accesorio o descuento), y el signo se pone al
// armar el body. Es también lo que se le pide a quien carga la línea: nadie
// tipea "-500" para un descuento.
// ---------------------------------------------------------------------------

export type QuoteLineKind = "extra" | "discount";

export interface QuoteLineFormValue {
  description: string;
  kind: QuoteLineKind;
  amount: string;
}

export interface QuoteFormValues {
  amount: string;
  currency: string;
  // "YYYY-MM-DD" o "" (sin fecha de validez).
  validUntil: string;
  lines: QuoteLineFormValue[];
}

export const EMPTY_LINE: QuoteLineFormValue = { description: "", kind: "extra", amount: "" };

// Number() para el canónico sin ceros de relleno ("1500.00" -> "1500"), el
// mismo trato que toFormValues de OpportunityFormPage.
function canonical(amount: string): string {
  return String(Math.abs(Number(amount)));
}

function linesFromQuote(quote: Pick<Quote, "lines">): QuoteLineFormValue[] {
  return quote.lines.map((line) => ({
    description: line.description,
    kind: Number(line.amount) < 0 ? "discount" : "extra",
    amount: canonical(line.amount),
  }));
}

// Editar un borrador: todo tal cual está guardado.
export function formValuesForEdit(quote: Quote): QuoteFormValues {
  return {
    amount: canonical(quote.amount),
    currency: quote.currency,
    // Lectura ISO -> slice(0, 10): nunca new Date(iso) + formato local.
    validUntil: quote.validUntil?.slice(0, 10) ?? "",
    lines: linesFromQuote(quote),
  };
}

// Una cotización NUEVA arranca de la activa si la hay (el caso típico es
// "le bajo el precio": mismos accesorios, otro número), y si no, del monto y
// la moneda de la oportunidad. La validez arranca vacía siempre: es una
// oferta nueva y su plazo se decide de nuevo.
export function formValuesForNew(
  active: Quote | null,
  opportunity: { amount: string; currency: string },
): QuoteFormValues {
  if (active) {
    return {
      amount: canonical(active.amount),
      currency: active.currency,
      validUntil: "",
      lines: linesFromQuote(active),
    };
  }
  return {
    amount: Number(opportunity.amount) > 0 ? canonical(opportunity.amount) : "",
    currency: opportunity.currency || "USD",
    validUntil: "",
    lines: [],
  };
}

// El primer problema que impide guardar, o null. Mensajes en el tono de los
// del resto de los formularios ("Elegí un pipeline antes de guardar.").
export function validateQuoteForm(values: QuoteFormValues): string | null {
  if (values.amount === "") {
    return "Cargá el precio ofertado antes de guardar.";
  }
  for (const [index, line] of values.lines.entries()) {
    if (line.description.trim() === "") {
      return `La línea ${index + 1} necesita una descripción.`;
    }
    if (line.amount === "") {
      return `La línea ${index + 1} necesita un importe.`;
    }
  }
  return null;
}

export interface QuoteInputFromForm {
  amount: number;
  currency: string;
  lines: QuoteLineInput[];
  validUntil: string | null;
}

// El mismo body sirve para crear (más opportunityId) y para editar un
// borrador: el PATCH de contenido acepta los cuatro campos. validUntil vacío
// viaja como null explícito, que en edición limpia la fecha.
export function toQuoteInput(values: QuoteFormValues): QuoteInputFromForm {
  return {
    amount: Number(values.amount),
    currency: values.currency,
    lines: values.lines.map((line) => ({
      description: line.description.trim(),
      amount: line.kind === "discount" ? -Number(line.amount) : Number(line.amount),
    })),
    validUntil: values.validUntil || null,
  };
}
