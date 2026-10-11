// ¿La sesión de esta pestaña se abrió escribiendo una contraseña?
//
// Desde el frontend no hay forma de preguntarle a Supabase "¿este usuario
// tiene contraseña?": el objeto User no la expone (ni un flag), y las
// identities muestran el proveedor "email" igual para quien la eligió que
// para quien solo abrió el link de la invitación. Lo que sí es confiable es el
// claim `amr` (Authentication Methods References) del access token: GoTrue
// anota ahí CÓMO se abrió la sesión — "password" para signInWithPassword,
// "invite"/"otp" para el link de una invitación, "recovery" para el de
// recuperación — y lo conserva en cada refresh del token.
//
// Si incluye "password", la persona ACABA de ingresar con su contraseña: la
// tiene, sin ambigüedad. Es el caso real del bug: eligió una contraseña con
// "¿Olvidaste tu contraseña?" (ResetPasswordPage la guarda y cierra la
// sesión), después ingresó por /login y LoginPage la manda a aceptar.
//
// Si no incluye "password" (link de la invitación) no se puede saber: lo
// normal es que todavía no tenga, y se le pide como siempre. Si igual ya tenía
// una y escribe la misma, AcceptInvitationPage toma el same_password como
// éxito (ver esMismaContrasena en mensajesDeAuth.ts).
//
// Se lee el token a mano y no con supabase.auth.mfa.getAuthenticatorAssuranceLevel()
// (que decodifica lo mismo) para no sumar una llamada asincrónica más dentro
// del callback de onAuthStateChange. Ante cualquier token raro, false: el
// camino de siempre, que pide contraseña.
export function sesionIniciadaConContrasena(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  const partes = accessToken.split(".");
  if (partes.length !== 3) return false;
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const conRelleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(conRelleno), (caracter) => caracter.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const amr = (payload as { amr?: unknown } | null)?.amr;
    return (
      Array.isArray(amr) &&
      amr.some(
        (entrada: unknown) =>
          typeof entrada === "object" &&
          entrada !== null &&
          (entrada as { method?: unknown }).method === "password",
      )
    );
  } catch {
    return false;
  }
}
