# Archivos de ejemplo de la importación

Datos **inventados** para los tests del asistente de importación
(`docs/importacion-de-datos.md`). Ninguna persona, empresa, email ni teléfono
es real: los emails son de `example.com` y los teléfonos, números de fantasía.

- `contactos.csv`: separador `;`, como lo exporta Excel en español.
  `{{VENDEDOR}}` lo reemplaza el test por el email de un usuario de prueba. Trae
  a propósito una fila con email inválido (C-003), una con una sola palabra en
  el nombre (C-002), una nota que empieza con `=` en la fila que falla (C-003), un vendedor que no
  existe (C-004) y el mismo cliente dos veces (C-001).
- `empresas.csv`: una fila sin nombre (E-03), que tiene que fallar.
