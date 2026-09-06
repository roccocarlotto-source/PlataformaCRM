import type { ReactNode } from "react";
import { Card } from "../../design-system/Card";

// Contenedor de las pantallas de autenticación: centra una tarjeta angosta
// en la página (.ds-auth-shell, design-system.css). Existe para que cada
// rama de render de LoginPage, ForgotPasswordPage, ResetPasswordPage y
// AcceptInvitationPage se envuelva con una sola línea en vez de repetir el
// mismo par div + Card nueve veces. Solo presentación: no sabe nada de
// sesión ni de estado.
//
// La Card va sin `heading`: el título de cada pantalla es su propio <h1>,
// que queda adentro de la tarjeta como primer elemento. Un <h2> de tarjeta
// (14px) no es un título de página, y las ramas sin título (errores,
// reintentos) no tendrían qué poner ahí.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="ds-auth-shell">
      <Card>{children}</Card>
    </div>
  );
}
