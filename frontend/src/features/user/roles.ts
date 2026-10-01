// Rótulo de un rol para la UI. El valor ("ADMIN" / "USER") es el del contrato
// con el backend y no cambia; lo que se muestra es la palabra que ya usa el pie
// de la sidebar (AppLayout). Role.name es `string` en el contrato, así que un
// nombre desconocido se muestra tal cual en vez de quedar en blanco.
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  USER: "Usuario",
};

export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}
