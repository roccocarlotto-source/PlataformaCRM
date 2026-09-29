// ---------------------------------------------------------------------------
// Lecturas independientes en paralelo SIN cambiar qué error ve el cliente —
// F6 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub) (PR "menos idas a la base").
//
// Con Render y Supabase en regiones distintas, cada ida a la base cuesta
// ~100 ms, y lo que más pesa en un request es la cantidad de queries EN SERIE.
// Varias validaciones de un mismo request (el dueño existe, la empresa
// existe, la etapa es del pipeline…) no dependen entre sí y se pueden
// disparar juntas.
//
// El problema de Promise.all es que rechaza con el PRIMER error EN EL TIEMPO:
// si dos validaciones fallan, el 400 que recibe el cliente dependería de cuál
// contestó antes la base, y dejaría de ser el de siempre. Esto espera a todas
// y relanza el primer error EN EL ORDEN DECLARADO, que es el orden en que
// antes corrían en serie. Mismo resultado observable, menos tiempo.
//
// Solo para LECTURAS: una escritura en paralelo puede quedar hecha aunque
// otra falle, cosa que en serie no pasaba.
// ---------------------------------------------------------------------------
export async function enParalelo<T extends readonly unknown[]>(tareas: {
  [K in keyof T]: Promise<T[K]>;
}): Promise<T> {
  const resultados = await Promise.allSettled(tareas);
  const valores: unknown[] = [];
  for (const resultado of resultados) {
    if (resultado.status === "rejected") {
      throw resultado.reason;
    }
    valores.push(resultado.value);
  }
  return valores as unknown as T;
}
