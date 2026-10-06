// Las opciones de un campo de lista escritas una por renglón, sin vacías ni
// repetidas. Fuera del componente del formulario para que ese archivo
// exporte solo el componente (react-refresh).
export function opcionesDesdeTexto(texto: string): string[] {
  const vistas = new Set<string>();
  const opciones: string[] = [];
  for (const renglon of texto.split("\n")) {
    const opcion = renglon.trim();
    if (opcion.length === 0 || vistas.has(opcion)) continue;
    vistas.add(opcion);
    opciones.push(opcion);
  }
  return opciones;
}
