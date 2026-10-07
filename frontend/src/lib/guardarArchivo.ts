// Le ofrece al navegador un archivo para guardar (un SVG del QR, un CSV del
// informe de una importación): un link temporal a un Blob, clickeado y
// liberado. Sin dependencias.
export function guardarArchivo(blob: Blob, nombre: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = nombre;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
