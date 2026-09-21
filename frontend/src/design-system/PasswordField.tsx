import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// ---------------------------------------------------------------------------
// Campo de contraseña con botón de mostrar/ocultar (ítem 82).
//
// POR QUÉ UN COMPONENTE Y NO UN FIX EN CADA PANTALLA: hay ocho campos de
// contraseña en tres pantallas (LoginPage, ResetPasswordPage y las tres ramas
// de AcceptInvitationPage), y el botón trae su propio estado, su aria-label
// dinámico y su CSS. Copiado ocho veces, cualquier corrección (un aria-label,
// el ::-ms-reveal de Edge) habría que repetirla ocho veces.
//
// POR QUÉ NO ENVUELVE A FormField: FormField ES un <label> que envuelve al
// control. Meter el botón adentro dejaría dos elementos "labelables" (input y
// button) bajo un mismo <label>, que el HTML no admite: un label rotula un
// único control. Se usa la misma raíz que Select.tsx —div.ds-field con un
// <label htmlFor> apuntando al input—, que se ve igual (el rótulo lleva
// .ds-field-label) y deja al input con el mismo nombre accesible de siempre:
// los tests lo siguen encontrando con getByLabelText("Contraseña").
//
// EL BOTÓN SÍ ESTÁ EN EL TAB, a diferencia del input escondido de
// FileInputButton: acá no hay nada invisible, y quien navega con teclado
// también puede querer revisar lo que escribió. Es type="button" para no
// disparar el submit del formulario que lo contiene, y su aria-label cambia
// con el estado ("Mostrar" / "Ocultar"): un nombre fijo con aria-pressed
// diría lo mismo en los dos estados y obligaría a interpretar el "presionado".
// ---------------------------------------------------------------------------

export interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  // Mismos atributos que llevaba cada <input type="password"> reemplazado:
  // difieren entre usos (current-password en el login, new-password en el
  // resto; minLength solo en el primer campo de cada par).
  autoComplete?: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
}: PasswordFieldProps) {
  const inputId = useId();
  // Cada instancia tiene su propio estado: en un par Contraseña + Confirmar,
  // mostrar una no muestra la otra.
  const [visible, setVisible] = useState(false);

  return (
    <div className="ds-field">
      <label className="ds-field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="ds-password-field">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="ds-password-field__toggle"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-controls={inputId}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
