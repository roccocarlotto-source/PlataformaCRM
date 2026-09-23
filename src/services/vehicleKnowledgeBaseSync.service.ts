import type { Vehicle, VehicleStatus } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import {
  createKnowledgeBaseEntry as createKnowledgeBaseEntryRepo,
  findGeneratedKnowledgeBaseEntriesByBranch,
  findKnowledgeBaseEntryBySourceVehicle,
  softDeleteKnowledgeBaseEntry,
  writeSyncedKnowledgeBaseEntry,
} from "../repositories/knowledgeBaseEntry.repository";
import { findManyVehicles } from "../repositories/vehicle.repository";
import {
  BODY_TYPE_LABELS,
  COLOR_FINISH_LABELS,
  CONDITION_LABELS,
  DRIVETRAIN_LABELS,
  FUEL_TYPE_LABELS,
  PUBLICATION_CURRENCY_LABELS,
  TRANSMISSION_LABELS,
  WARRANTY_LABELS,
} from "../utils/vehicleLabels";
import { deleteKnowledgeBaseEntry, validateBranchId } from "./knowledgeBaseEntry.service";

// ---------------------------------------------------------------------------
// Sincronizar el stock con la base de conocimiento (ítem 70 de
// docs/frontend-cambios-pendientes.md).
//
// EL PROBLEMA: para que un agente pueda hablar del stock, hasta hoy alguien
// tenía que copiar los datos del vehículo A MANO en una entrada de la base de
// conocimiento, y ese texto quedaba desactualizado en cuanto cambiaba un
// precio o se vendía la unidad. El stock real ya vive estructurado en
// `vehicles`; lo que faltaba era el puente.
//
// TRES DECISIONES QUE GOBIERNAN TODO ESTE ARCHIVO:
//
//   1. MANUAL, POR BOTÓN Y POR SUCURSAL. No hay ningún hook en el alta ni en
//      la edición de un vehículo. Automatizarla es una decisión de producto
//      aparte —y cara: reescribiría entradas en cada PATCH de una ficha—, no
//      una consecuencia de este ítem.
//   2. UNA ENTRADA POR VEHÍCULO, no una sola entrada gigante con el stock
//      entero. Se mantiene al día unidad por unidad, y ninguna se acerca al
//      tope de 10.000 caracteres por entrada por más que crezca el stock.
//   3. IDEMPOTENTE POR FK, no por título ni por texto: la entrada generada
//      lleva `sourceVehicleId`, y el UNIQUE (organization_id, source_vehicle_id)
//      hace imposible que una segunda corrida duplique nada.
//
// LO QUE ESTE SERVICE NUNCA HACE: tocar una entrada con `sourceVehicleId`
// null. Esas son las escritas a mano, y no se actualizan ni se dan de baja
// acá por más que su contenido se parezca al de una unidad.
// ---------------------------------------------------------------------------

// El tope del título en la base (VarChar(200), ver KnowledgeBaseEntry en
// schema.prisma) y el de cordura del contenido (el mismo 10.000 que el borde
// HTTP le exige a una entrada escrita a mano). Acá se respetan a mano porque
// esta escritura no pasa por Zod: la entrada no la escribe una persona.
const MAX_TITULO = 200;
const MAX_CONTENIDO = 10_000;

// Cuántos vehículos se traen por vuelta. El service pagina hasta agotar el
// stock que califica, así que NO es un tope silencioso: es el tamaño del lote.
// Una sucursal con 300 unidades publicadas hace dos vueltas, no pierde 100.
const LOTE_DE_VEHICULOS = 200;

export interface ResumenDeSincronizacion {
  creadas: number;
  actualizadas: number;
  dadasDeBaja: number;
}

// Números como los escribe (y los lee) alguien en Uruguay: "25.000",
// "15,5". Es el mismo formato que la pantalla del CRM le muestra a la persona
// que carga la ficha, y el texto que sale de acá lo termina leyendo un modelo
// que responde en castellano rioplatense.
const NUMERO = new Intl.NumberFormat("es-UY");

function formatearNumero(valor: number | Prisma.Decimal): string {
  return NUMERO.format(valor instanceof Prisma.Decimal ? valor.toNumber() : valor);
}

// ---------------------------------------------------------------------------
// EL CONTENIDO DE LA ENTRADA — LA ALLOWLIST.
//
// LEER ESTO ANTES DE AGREGAR UN CAMPO ACÁ. Lo que esta función escribe termina,
// palabra por palabra, dentro del system prompt de todos los agentes de la
// sucursal, y de ahí en la boca del agente frente a un desconocido en un chat
// público. Por eso NO vuelca la fila del vehículo: elige campo por campo.
//
// La lista de abajo es una lista de PERMITIDOS. El criterio por defecto para
// cualquier campo que no esté escrito acá —incluido uno que se agregue a
// `Vehicle` mañana— es NO INCLUIRLO hasta que alguien decida explícitamente lo
// contrario. Que un campo nuevo aparezca en la ficha no lo habilita a salir
// por la boca del agente.
//
// NUNCA PUEDEN APARECER, aunque estén cargados: `licensePlate`, `vin`,
// `engineNumber`, `minAcceptablePriceUsd` (el piso de negociación),
// `acquisitionCostUsd`, los ocho campos de consignación (datos personales de
// un tercero, docs/data-classification.md), `internalNotes` (su propio
// comentario en el schema dice "nunca sale por la API pública"),
// `licensePlateDebtLocal`, `lastTechnicalInspectionAt`, `titleHolder`,
// `titleReportRequested`, `assignedSalespersonId` y `tradeInOpportunityId`.
// Hay un test que arma una unidad con TODOS esos campos cargados y afirma que
// ninguno de esos valores aparece como substring del contenido generado
// (vehicleKnowledgeBaseSync.service.test.ts): si alguien rompe la allowlist,
// falla ahí y no en producción.
//
// LOS BOOLEANOS SOLO SE ESCRIBEN CUANDO SON true. El schema lo dice de los
// cuatro de documentación: "no marcada" es "no se afirma", no un dato que
// afirme lo contrario. Escribir "Único dueño: No" sería inventar una negación
// que nadie cargó, y el agente la repetiría como un hecho.
// ---------------------------------------------------------------------------
export function construirContenidoDeVehiculo(vehicle: Vehicle): string {
  const lineas: string[] = [];

  const agregar = (rotulo: string, valor: string | null | undefined) => {
    if (valor === null || valor === undefined || valor.trim() === "") return;
    lineas.push(`${rotulo}: ${valor}`);
  };
  // Un booleano solo aparece si es true (ver la cabecera).
  const agregarSi = (rotulo: string, valor: boolean) => {
    if (valor) lineas.push(`${rotulo}: Sí`);
  };

  agregar("Código interno", vehicle.internalCode);
  agregar("Condición", CONDITION_LABELS[vehicle.condition]);
  agregar("Marca", vehicle.make);
  agregar("Modelo", vehicle.model);
  agregar("Versión", vehicle.trim);
  agregar("Año", String(vehicle.year));
  agregar("Carrocería", vehicle.bodyType ? BODY_TYPE_LABELS[vehicle.bodyType] : null);
  // El kilometraje de un 0 km no dice nada (y un "0 km" leído como dato
  // cargado confunde más de lo que informa): solo se publica en un usado.
  if (vehicle.condition === "USED" && vehicle.mileage !== null) {
    agregar("Kilometraje", `${formatearNumero(vehicle.mileage)} km`);
  }

  agregar("Transmisión", vehicle.transmission ? TRANSMISSION_LABELS[vehicle.transmission] : null);
  agregar("Combustible", vehicle.fuelType ? FUEL_TYPE_LABELS[vehicle.fuelType] : null);
  agregar(
    "Cilindrada",
    vehicle.cylinderCapacityLiters ? `${formatearNumero(vehicle.cylinderCapacityLiters)} L` : null,
  );
  agregar("Tracción", vehicle.drivetrain ? DRIVETRAIN_LABELS[vehicle.drivetrain] : null);
  agregar("Potencia", vehicle.powerHp !== null ? `${formatearNumero(vehicle.powerHp)} HP` : null);
  agregar("Puertas", vehicle.doors !== null ? String(vehicle.doors) : null);
  agregar("Plazas", vehicle.seats !== null ? String(vehicle.seats) : null);
  agregar(
    "Consumo declarado",
    vehicle.declaredConsumptionKmL
      ? `${formatearNumero(vehicle.declaredConsumptionKmL)} km/L`
      : null,
  );

  agregar("Color exterior", vehicle.exteriorColor);
  agregar(
    "Terminación del color",
    vehicle.colorFinish ? COLOR_FINISH_LABELS[vehicle.colorFinish] : null,
  );
  agregar("Tapizado", vehicle.upholstery);

  // Los códigos de equipamiento se guardan normalizados ("AIRE_ACONDICIONADO")
  // y NO hay catálogo de códigos válidos —es texto libre normalizado, ver
  // frontend/src/features/vehicle/equipment.ts—, así que no hay ningún rótulo
  // que buscar: lo único honesto es deshacer la normalización que se puede
  // deshacer (el "_" era un espacio) y dejar el resto tal cual se cargó.
  if (vehicle.equipment.length > 0) {
    agregar(
      "Equipamiento",
      vehicle.equipment.map((codigo) => codigo.replace(/_/g, " ")).join(", "),
    );
  }

  agregar("Garantía", vehicle.warranty ? WARRANTY_LABELS[vehicle.warranty] : null);
  // El detalle solo tiene sentido con OTHER, que es cuando el service lo deja
  // cargado (applyWarrantyRule): con cualquier otro valor la columna está en
  // null, y chequear el enum además evita publicar un resto de dato viejo.
  if (vehicle.warranty === "OTHER") {
    agregar("Detalle de la garantía", vehicle.warrantyOther);
  }
  agregarSi("Único dueño", vehicle.singleOwner);
  agregarSi("Service oficial al día", vehicle.officialServiceUpToDate);
  agregarSi("Manual y llave de repuesto", vehicle.hasManualAndSpareKey);

  // -------------------------------------------------------------------------
  // PRECIOS. Dos reglas del negocio mandan sobre los dos números, y las dos
  // están en el schema: `priceOnRequest` es "se publica SIN mostrar el
  // número", y `publicationCurrency` dice en qué moneda se publica.
  //
  // Los dos campos están en la allowlist, pero publicarlos ignorando esas
  // reglas sería peor que no publicarlos: el agente diría un precio que la
  // agencia decidió no exhibir, o lo diría en una moneda en la que decidió no
  // publicar. Por eso la moneda filtra y "consultar precio" gana.
  // -------------------------------------------------------------------------
  if (vehicle.priceOnRequest) {
    lineas.push("Precio: a consultar (la agencia no publica el precio de esta unidad)");
  } else {
    const publicaUsd = vehicle.publicationCurrency !== "LOCAL_ONLY";
    const publicaLocal = vehicle.publicationCurrency !== "USD_ONLY";
    if (publicaUsd && vehicle.priceListUsd !== null) {
      agregar("Precio de lista en USD", formatearNumero(vehicle.priceListUsd));
    }
    if (publicaLocal && vehicle.priceListLocal !== null) {
      agregar("Precio de lista en moneda local", formatearNumero(vehicle.priceListLocal));
    }
    agregar("Se publica en", PUBLICATION_CURRENCY_LABELS[vehicle.publicationCurrency]);
  }

  agregarSi("Acepta permuta", vehicle.acceptsTradeIn);
  agregarSi("Financiación disponible", vehicle.financingAvailable);
  agregar("Ubicación", vehicle.physicalLocation);

  const texto =
    vehicle.publicDescription && vehicle.publicDescription.trim() !== ""
      ? `${lineas.join("\n")}\n\nDescripción:\n${vehicle.publicDescription.trim()}`
      : lineas.join("\n");

  // El único campo que puede desbordar el tope es la descripción pública
  // (hasta 10.000 caracteres por sí sola) y va ÚLTIMA justamente por eso: lo
  // que se recorta es su cola, nunca una ficha técnica a medias.
  return texto.length > MAX_CONTENIDO ? `${texto.slice(0, MAX_CONTENIDO - 1)}…` : texto;
}

// El título es lo que se ve en el listado de la base de conocimiento y lo que
// encabeza el bloque de la entrada en el prompt (armarSystemPrompt). El
// prefijo "Stock: " está para que se lea de un vistazo cuál de las entradas de
// una sucursal salió del stock; el código interno, para distinguir dos
// unidades del mismo modelo y año.
export function construirTituloDeVehiculo(vehicle: Vehicle): string {
  const titulo = [
    `Stock: ${vehicle.make} ${vehicle.model} ${vehicle.year}`,
    vehicle.internalCode,
  ].join(" — ");
  // make y model son VarChar(100) cada uno: juntos pueden pasarse del
  // VarChar(200) del título. El recorte es defensivo (un INSERT que se pasa lo
  // rechaza el motor con un 500), no una regla de producto.
  return titulo.length > MAX_TITULO ? titulo.slice(0, MAX_TITULO) : titulo;
}

// ---------------------------------------------------------------------------
// QUÉ VEHÍCULO CALIFICA.
//
// Las tres condiciones son independientes y hacen falta las tres:
//
//   - `publishOnWebsite: true` — la única puerta por la que una unidad sale
//     hacia afuera (ver el comentario de esa columna en schema.prisma).
//   - `status: AVAILABLE` — y NO alcanza con la anterior:
//     setVehicleStatusForOpportunityLink (vehicle.service.ts) cambia el status
//     a RESERVED/SOLD cuando la unidad se engancha a una oportunidad y NO
//     toca publishOnWebsite. Una unidad vendida sigue marcada como publicable,
//     así que sin este filtro el agente ofrecería autos ya vendidos.
//   - `deletedAt: null` — lo agrega el repositorio en toda lectura de negocio.
//
// Se lee por lotes hasta agotar el stock que califica. Entre lote y lote el
// stock puede moverse (alguien vende una unidad mientras corre la
// sincronización): es una foto manual, y la corrida siguiente la corrige.
// ---------------------------------------------------------------------------
async function buscarVehiculosQueCalifican(
  organizationId: string,
  branchId: string,
): Promise<Vehicle[]> {
  const vehiculos: Vehicle[] = [];
  for (let skip = 0; ; skip += LOTE_DE_VEHICULOS) {
    const lote = await findManyVehicles(
      organizationId,
      { branchId, publishOnWebsite: true, status: ["AVAILABLE"] },
      { skip, take: LOTE_DE_VEHICULOS },
      // Orden estable y barato: el índice nuevo resuelve el WHERE y el orden
      // acá solo tiene que ser determinístico para que la paginación no
      // repita ni saltee filas entre lotes.
      { sortBy: "createdAt", sortOrder: "asc" },
    );
    vehiculos.push(...lote);
    if (lote.length < LOTE_DE_VEHICULOS) return vehiculos;
  }
}

// ---------------------------------------------------------------------------
// LA SINCRONIZACIÓN.
//
// DÓNDE SE REUSA knowledgeBaseEntry.service.ts Y DÓNDE NO, que es la decisión
// de diseño de este archivo:
//
//   - La VALIDACIÓN DE LA SUCURSAL se reusa tal cual (validateBranchId), para
//     que un branchId de otra organización devuelva el mismo 400 con el mismo
//     mensaje que en el POST de una entrada. Corre UNA vez, no una por
//     vehículo.
//   - LA BAJA se reusa tal cual (deleteKnowledgeBaseEntry): es exactamente el
//     mismo soft delete que hace la pantalla, y duplicarlo sería tener dos
//     formas de dar de baja una entrada.
//   - EL ALTA Y LA ACTUALIZACIÓN van contra el REPOSITORIO. createKnowledgeBaseEntry
//     valida la sucursal y abre una transacción con lock por cada entrada:
//     correcto para el alta de a una desde la pantalla, y N transacciones con
//     N locks de la misma sucursal cuando las entradas son 200. Acá la
//     sucursal ya se validó una vez, el service existente no sabe escribir
//     `sourceVehicleId` ni revivir una entrada dada de baja, y esas dos cosas
//     son justamente lo propio de este camino.
//
// SIN TRANSACCIÓN ENVOLVENTE, a propósito: una sincronización de 200 unidades
// en una sola transacción sostiene un lock largo sobre filas que la pantalla y
// el agente están leyendo, y el resultado parcial de una corrida cortada a la
// mitad no es inconsistente —es stock a medio actualizar, que es exactamente
// lo que había antes de apretar el botón, y que la corrida siguiente termina
// de arreglar.
// ---------------------------------------------------------------------------
export async function sincronizarStockConBaseDeConocimiento(
  organizationId: string,
  branchId: string,
): Promise<ResumenDeSincronizacion> {
  await validateBranchId(organizationId, branchId);

  const vehiculos = await buscarVehiculosQueCalifican(organizationId, branchId);

  let creadas = 0;
  let actualizadas = 0;

  for (const vehiculo of vehiculos) {
    const titulo = construirTituloDeVehiculo(vehiculo);
    const contenido = construirContenidoDeVehiculo(vehiculo);

    // Busca INCLUIDAS las dadas de baja: el UNIQUE no es parcial, así que una
    // entrada borrada sigue ocupando el par (organización, vehículo) y lo que
    // corresponde es revivirla, no insertar otra.
    const existente = await findKnowledgeBaseEntryBySourceVehicle(organizationId, vehiculo.id);

    if (!existente) {
      await createKnowledgeBaseEntryRepo({
        organizationId,
        branchId,
        title: titulo,
        content: contenido,
        sourceVehicleId: vehiculo.id,
      });
      creadas++;
      continue;
    }

    if (existente.deletedAt !== null) {
      // Vuelve de una baja: la unidad se vendió (o se despublicó) y volvió a
      // calificar. Para la pantalla es una entrada nueva —no estaba— y por eso
      // se cuenta como creada, aunque la fila y su id sean los de antes.
      await writeSyncedKnowledgeBaseEntry(existente.id, organizationId, {
        branchId,
        title: titulo,
        content: contenido,
      });
      creadas++;
      continue;
    }

    // Nada cambió: no se escribe. Evita tocar updatedAt de 200 filas en cada
    // corrida y hace que el resumen diga algo verdadero — "0 actualizadas"
    // significa que el texto que el agente lee ya estaba al día.
    //
    // isActive NO se mira ni se pisa: desactivar una entrada es una decisión
    // del negocio ("hoy no quiero que el agente diga esto") y la
    // sincronización no la revierte.
    if (
      existente.branchId === branchId &&
      existente.title === titulo &&
      existente.content === contenido
    ) {
      continue;
    }

    await writeSyncedKnowledgeBaseEntry(existente.id, organizationId, {
      branchId,
      title: titulo,
      content: contenido,
    });
    actualizadas++;
  }

  // Las bajas: entradas VIVAS de esta sucursal que salieron de la
  // sincronización (sourceVehicleId no nulo) y cuyo vehículo ya no califica
  // —se vendió, se despublicó, se borró o se mudó de sucursal—. Las escritas a
  // mano no entran a esta consulta: exige sourceVehicleId no nulo.
  const califican = new Set(vehiculos.map((vehiculo) => vehiculo.id));
  const generadas = await findGeneratedKnowledgeBaseEntriesByBranch(organizationId, branchId);
  let dadasDeBaja = 0;
  for (const entrada of generadas) {
    if (entrada.sourceVehicleId !== null && califican.has(entrada.sourceVehicleId)) continue;
    await deleteKnowledgeBaseEntry(organizationId, entrada.id);
    dadasDeBaja++;
  }

  return { creadas, actualizadas, dadasDeBaja };
}

// ---------------------------------------------------------------------------
// LA BAJA INMEDIATA (ítem 152 de docs/matriz-de-datos-crm.md).
//
// La sincronización de arriba es una foto manual: se corre con el botón. Eso
// está bien para las ALTAS (publicar una unidad en la base es una decisión que
// se toma a propósito), pero no para las BAJAS: entre que una unidad se vende
// y alguien aprieta "Sincronizar", su entrada sigue viva y el agente la tiene
// en el prompt como disponible. El ítem 150 lo midió: vendida y sin
// sincronizar, "entrada viva (isActive=true)".
//
// Por eso toda escritura que puede sacar a una unidad de lo que califica
// —cambiar status, despublicarla, darla de baja— llama a esta función en su
// misma transacción. Solo da de baja: nunca crea ni actualiza, eso sigue
// siendo del botón. El criterio de "califica" es exactamente el de
// buscarVehiculosQueCalifican.
// ---------------------------------------------------------------------------

export function vehiculoCalificaParaLaBase(vehicle: {
  publishOnWebsite: boolean;
  status: VehicleStatus;
  deletedAt: Date | null;
}): boolean {
  return vehicle.publishOnWebsite && vehicle.status === "AVAILABLE" && vehicle.deletedAt === null;
}

// Devuelve si dio de baja una entrada (para los tests y el historial).
export async function retirarDeLaBaseSiDejoDeCalificar(
  organizationId: string,
  vehicle: { id: string; publishOnWebsite: boolean; status: VehicleStatus; deletedAt: Date | null },
  db: Db,
): Promise<boolean> {
  if (vehiculoCalificaParaLaBase(vehicle)) {
    return false;
  }
  const entrada = await findKnowledgeBaseEntryBySourceVehicle(organizationId, vehicle.id, db);
  if (!entrada || entrada.deletedAt !== null) {
    return false;
  }
  const result = await softDeleteKnowledgeBaseEntry(entrada.id, organizationId, db);
  return result.count > 0;
}
