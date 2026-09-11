import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import {
  countSignificantBefore,
  DECIMAL_SEPARATOR,
  formatAmount,
  formatAmountWhileTyping,
  parseAmount,
  positionAfterSignificant,
} from "./currencyFormat";

// ---------------------------------------------------------------------------
// Input de monto con formato uruguayo en vivo (ítem 18.A de
// docs/frontend-cambios-pendientes.md): punto cada 3 dígitos de la parte
// entera y coma para los decimales. "20000,5" se ve "20.000,5" mientras se
// tipea y "20.000,50" al salir del campo.
//
// El contrato hacia afuera es el mismo string canónico que los formularios ya
// guardaban en su estado: "20000.5" (punto decimal, sin separador de miles,
// "" si está vacío), que Number() convierte tal cual. El formato es SOLO de
// presentación: el backend sigue recibiendo el número real. Las funciones de
// parseo/formato viven en currencyFormat.ts.
//
// Por qué no un <input type="number">: ningún navegador admite separadores de
// miles en un input numérico nativo. Así que es un type="text" con
// inputMode="decimal" (teclado numérico en el celular) y formateo/parseo a
// mano. Sin dependencia nueva: package.json no tiene librería de máscaras y
// una función con Intl alcanza.
//
// EL PUNTO DELICADO de este patrón es el cursor: al reformatear el valor
// controlado, el navegador manda el cursor al final. Para tipear en medio de
// "1.234.567" sin que el cursor salte, handleChange cuenta cuántos caracteres
// significativos (dígitos y la coma) quedan a la izquierda del cursor en lo
// que la persona escribió, y después del render vuelve a poner el cursor
// detrás del mismo carácter significativo en el texto formateado
// (useLayoutEffect, antes de que se pinte). Los puntos de miles no cuentan
// porque van y vienen con el formato.
//
// Genérico a propósito: hoy lo usa Monto de Oportunidad; los precios de
// VehicleFormPage tienen el mismo problema y pueden adoptarlo en otro ítem
// sin tocar nada de acá.
// ---------------------------------------------------------------------------

export interface CurrencyInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> {
  // Valor canónico: "20000.5", "20000" o "". Nunca el texto formateado.
  value: string;
  onChange: (value: string) => void;
}

export function CurrencyInput({ value, onChange, onBlur, ...rest }: CurrencyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [display, setDisplay] = useState(() => formatAmount(value));
  // El valor canónico del que se derivó `display` la última vez. Si el padre
  // cambia `value` por su cuenta (p. ej. handleVehicleChange vacía Monto al
  // vincular una unidad), el texto se rehace desde ese valor; mientras lo que
  // se ve siga representando el mismo valor (p. ej. "20.000," frente a
  // "20000"), se respeta lo tipeado. Derivación durante el render, sin
  // useEffect: evita un frame con el texto viejo.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseAmount(display) !== value) {
      setDisplay(formatAmount(value));
    }
  }

  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCursor.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
      pendingCursor.current = null;
    }
  });

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const typed = event.target.value;
    const cursor = event.target.selectionStart ?? typed.length;
    // Un punto tipeado es un decimal (numpad, o costumbre): en "20.000" no hay
    // forma ni motivo de agregar otro punto de miles a mano. Se lo convierte
    // en coma solo si todavía no hay separador decimal; si ya lo hay, el
    // parseo lo descarta como cualquier otro carácter extraño.
    const nativeData = (event.nativeEvent as InputEvent).data;
    const typedWithSeparator =
      nativeData === "." && cursor > 0 && !typed.includes(DECIMAL_SEPARATOR)
        ? `${typed.slice(0, cursor - 1)}${DECIMAL_SEPARATOR}${typed.slice(cursor)}`
        : typed;
    const nextDisplay = formatAmountWhileTyping(typedWithSeparator);
    pendingCursor.current = positionAfterSignificant(
      nextDisplay,
      countSignificantBefore(typedWithSeparator, cursor),
    );
    setDisplay(nextDisplay);
    const nextValue = parseAmount(nextDisplay);
    setSyncedValue(nextValue);
    if (nextValue !== value) onChange(nextValue);
  }

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      onBlur={(event) => {
        setDisplay(formatAmount(value));
        onBlur?.(event);
      }}
    />
  );
}
