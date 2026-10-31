// ---------------------------------------------------------------------------
// La política de contraseña de Supabase Auth en producción (desde el
// 2026-10-23): al menos 8 caracteres, con letras y números. La exige el
// servidor; acá se repite para avisar ANTES de mandar el formulario, con el
// mismo texto que la guía de uso (SEG-C-10 y DOC-02 de
// docs-privados/auditoria-2026-10-21, local).
//
// "Letras" son las que cuenta Supabase: a-z y A-Z. Una ñ o una vocal con
// acento no cuentan como letra para el servidor, así que acá tampoco.
// ---------------------------------------------------------------------------

export const LARGO_MINIMO_DE_CONTRASENA = 8;

export const MENSAJE_DE_POLITICA_DE_CONTRASENA = `La contraseña tiene que tener al menos ${String(LARGO_MINIMO_DE_CONTRASENA)} caracteres, con letras y números`;

export function cumpleLaPoliticaDeContrasena(contrasena: string): boolean {
  return (
    contrasena.length >= LARGO_MINIMO_DE_CONTRASENA &&
    /[A-Za-z]/.test(contrasena) &&
    /[0-9]/.test(contrasena)
  );
}
