import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { countSignificantBefore, positionAfterSignificant } from "./currencyFormat";
import { formatInteger, isDigit, parseInteger } from "./integerFormat";

// ---------------------------------------------------------------------------
// Input de cantidad entera con separador de miles en vivo (ítem 23 de
// docs/frontend-cambios-pendientes.md): "150000" se ve "150.000" mientras se
// tipea, sin coma ni decimales nunca. Hoy lo usa Kilometraje en la ficha de
// vehículo.
//
// Calca el mecanismo de CurrencyInput.tsx — leer el comentario de cabecera
// de ese archivo por el porqué de un type="text" y por el cuidado del cursor
// al reformatear — pero sin su parte decimal: no hay coma que reconocer, un
// punto tipeado no es un decimal (se descarta como cualquier otro carácter
// que no sea dígito) y al salir del campo no hay nada que completar. Es un
// componente hermano y no un CurrencyInput con "cero decimales" para no
// meter esos tres condicionales en el componente más delicado del sistema
// de diseño; las funciones de cursor sí se comparten (currencyFormat.ts),
// con "solo dígitos" como criterio de carácter significativo.
//
// El contrato hacia afuera es el mismo string canónico que los formularios
// ya guardaban: "150000" (sin separadores, "" si está vacío).
// ---------------------------------------------------------------------------

export interface IntegerInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> {
  // Valor canónico: "150000" o "". Nunca el texto formateado.
  value: string;
  onChange: (value: string) => void;
}

export function IntegerInput({ value, onChange, onBlur, ...rest }: IntegerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [display, setDisplay] = useState(() => formatInteger(value));
  // Mismo criterio que CurrencyInput: si el padre cambia `value` por su
  // cuenta, el texto se rehace desde ese valor; mientras lo que se ve siga
  // representando el mismo valor, se respeta lo tipeado. Derivación durante
  // el render, sin useEffect, para no pintar un frame con el texto viejo.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseInteger(display) !== value) {
      setDisplay(formatInteger(value));
    }
  }

  // Posición del cursor a aplicar después del render. Es estado (un objeto
  // nuevo por tecla) y no un ref a propósito: si lo tipeado se descarta
  // entero (una coma en "1.500"), el texto no cambia, un ref no provocaría
  // render y el efecto no correría; mientras tanto React restaura el valor
  // controlado en el DOM y el cursor se va al final. Con estado hay render y
  // el efecto corre después de esa restauración, que es lo que importa.
  const [pendingCursor, setPendingCursor] = useState<{ position: number } | null>(null);
  useLayoutEffect(() => {
    if (pendingCursor && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursor.position, pendingCursor.position);
    }
  }, [pendingCursor]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const typed = event.target.value;
    const cursor = event.target.selectionStart ?? typed.length;
    const nextDisplay = formatInteger(typed);
    setPendingCursor({
      position: positionAfterSignificant(
        nextDisplay,
        countSignificantBefore(typed, cursor, isDigit),
        isDigit,
      ),
    });
    setDisplay(nextDisplay);
    const nextValue = parseInteger(nextDisplay);
    setSyncedValue(nextValue);
    if (nextValue !== value) onChange(nextValue);
  }

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      onBlur={(event) => {
        setDisplay(formatInteger(value));
        onBlur?.(event);
      }}
    />
  );
}
