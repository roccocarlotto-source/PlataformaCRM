// Ubica la celda de una fila de tabla por el texto de su <th>, no por índice
// numérico. Los listados migrados al design system reordenan o agregan
// columnas; una aserción por índice se rompe con cada reorden, una por
// cabecera no. Nació en ContactListPage.test.tsx y se extrajo cuando
// StageListPage.test.tsx necesitó lo mismo.
export function cellByHeader(row: HTMLElement | null, header: string): HTMLElement | undefined {
  const headers = Array.from(row?.closest("table")?.querySelectorAll("th") ?? []).map((th) =>
    th.textContent?.trim(),
  );
  const index = headers.indexOf(header);
  return index === -1 ? undefined : row?.querySelectorAll("td")[index];
}
