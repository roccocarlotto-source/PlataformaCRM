/**
 * Carga 5 entradas de Base de Conocimiento DE PRUEBA en la sucursal de AutoMax.
 *
 * Por qué existe: el ítem 108 identificó que el agente deriva las consultas de
 * garantía, permuta, trámites, envíos y formas de pago porque la KB no tiene
 * nada sobre eso. Estas entradas son contenido de demo (cada una lo dice en el
 * título y en el texto), no políticas reales de un negocio.
 *
 * ATENCIÓN: pega contra la API de PRODUCCIÓN con la cuenta de AutoMax. No es
 * parte de ninguna suite ni de CI; se corre a mano y solo a propósito:
 *
 *   export SUPABASE_ANON_KEY=<anon key de PRODUCCIÓN>
 *   export AUTOMAX_EMAIL=roccocarlotto+automotora@gmail.com
 *   export AUTOMAX_PASSWORD=<la del doc de credenciales>
 *   npx tsx scripts/cargar-kb-automax-demo.ts
 *
 * Es idempotente por título: antes de crear, lista las entradas de la
 * sucursal y saltea cualquier título que ya exista.
 */

const SUPABASE_URL = "https://xfnywkwocszfcrukikkb.supabase.co";
const API = "https://plataformacrm.onrender.com";
const BRANCH_ID = "529ed9df-4f24-4759-8b48-f58494a310e1";

const ENTRADAS: { title: string; content: string }[] = [
  {
    title: "Garantía (contenido de demo, no real)",
    content:
      "[DATO DE PRUEBA, no una política real de AutoMax] Los 0km tienen garantía de fábrica de 3 años o 100.000 km, lo que ocurra primero, cubriendo motor, caja y componentes eléctricos originales. Los usados con menos de 5 años y 80.000 km llevan garantía de la concesionaria de 6 meses o 10.000 km sobre motor y caja, sin cubrir desgaste (pastillas, cubiertas, batería). La garantía no cubre daños por mal uso, accidente o modificaciones no autorizadas. Para reclamos hay que traer el vehículo a la sucursal con la orden de compra.",
  },
  {
    title: "Permuta (contenido de demo, no real)",
    content:
      "[DATO DE PRUEBA] Se toma cualquier marca y modelo como parte de pago, siempre que esté al día con la documentación (título, cédula, libre de multas y de embargos). La tasación se hace en persona, en la sucursal, y depende del estado general, kilometraje y años. El valor de tasación se descuenta del precio de lista del vehículo elegido. No se toman vehículos con juicios en trámite o con mora de patentes de más de un año.",
  },
  {
    title: "Trámites de transferencia (contenido de demo, no real)",
    content:
      "[DATO DE PRUEBA] La transferencia de titularidad la gestiona la concesionaria a través de un gestor habilitado, con costo aparte del precio del vehículo (a cargo del comprador). Se necesita cédula de identidad, comprobante de domicilio y, si es 0km, la factura de compra. El trámite demora entre 5 y 10 días hábiles. Hasta que se complete, el vehículo circula con el permiso provisorio que entrega la concesionaria en el momento de la entrega.",
  },
  {
    title: "Entrega y envíos (contenido de demo, no real)",
    content:
      "[DATO DE PRUEBA] La entrega es en el local de la sucursal. Para 0km el plazo es de 15 a 30 días desde la seña, según disponibilidad de stock de la marca. Los usados, sujetos a stock, se entregan en el momento o dentro de las 48 horas si necesitan preparación (service, detailing). No se hacen envíos a domicilio ni a otras ciudades por el momento; el cliente retira en el local.",
  },
  {
    title: "Formas de pago (contenido de demo, no real)",
    content:
      "[DATO DE PRUEBA] Se acepta transferencia bancaria, efectivo y financiación a través de entidades financieras asociadas (sujeta a aprobación crediticia, no la gestiona la concesionaria directamente). La seña para reservar una unidad es del 10% del precio de lista y es reembolsable dentro de las 48 horas si la operación no se concreta por causas del vendedor. El precio final se confirma en el momento de la compra, no por WhatsApp.",
  },
];

interface EntradaKb {
  id: string;
  title: string;
  isActive: boolean;
}

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

async function login(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: requerida("SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({
      email: requerida("AUTOMAX_EMAIL"),
      password: requerida("AUTOMAX_PASSWORD"),
    }),
  });
  if (!res.ok) throw new Error(`Login falló: ${res.status} ${await res.text()}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

async function listarEntradas(token: string): Promise<EntradaKb[]> {
  const todas: EntradaKb[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `${API}/api/knowledge-base?branchId=${BRANCH_ID}&page=${page}&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`GET knowledge-base falló: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: EntradaKb[];
      pagination: { totalPages: number };
    };
    todas.push(...body.data);
    if (page >= body.pagination.totalPages) return todas;
  }
}

async function main() {
  const token = await login();
  const existentes = new Set((await listarEntradas(token)).map((e) => e.title));

  for (const entrada of ENTRADAS) {
    if (existentes.has(entrada.title)) {
      console.log(`SALTEADA (ya existe): ${entrada.title}`);
      continue;
    }
    const res = await fetch(`${API}/api/knowledge-base`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: BRANCH_ID, ...entrada }),
    });
    if (!res.ok)
      throw new Error(`POST "${entrada.title}" falló: ${res.status} ${await res.text()}`);
    const creada = (await res.json()) as EntradaKb;
    console.log(`CREADA: ${creada.title} (${creada.id})`);
  }

  // Verificación final: las 5 tienen que estar presentes y activas.
  const finales = await listarEntradas(token);
  for (const { title } of ENTRADAS) {
    const e = finales.find((f) => f.title === title);
    console.log(`${e ? (e.isActive ? "OK activa" : "PRESENTE pero INACTIVA") : "FALTA"}: ${title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
