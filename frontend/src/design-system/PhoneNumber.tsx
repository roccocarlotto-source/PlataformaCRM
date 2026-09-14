import { formatPhoneGroups } from "./phoneFormat";

export interface PhoneNumberProps {
  value?: string | null;
}

// ---------------------------------------------------------------------------
// Teléfono de solo lectura. Si el valor sigue el patrón uruguayo que reconoce
// phoneFormat.ts, cada grupo va en un <span> dentro de un contenedor .ds-phone
// (flex con gap fijo: el espacio entre grupos es CSS, no un carácter). Si no,
// se muestra el texto crudo sin envolver — exactamente lo que el consumidor
// renderizaba antes con `value ?? ""`, para no cambiar nada cuando el formato
// no aplica. Color y tipografía se heredan del contexto.
// ---------------------------------------------------------------------------
export function PhoneNumber({ value }: PhoneNumberProps) {
  const groups = formatPhoneGroups(value);
  if (groups === null) return <>{value ?? ""}</>;
  return (
    <span className="ds-phone">
      {groups.map((group, index) => (
        <span key={index}>{group}</span>
      ))}
    </span>
  );
}
