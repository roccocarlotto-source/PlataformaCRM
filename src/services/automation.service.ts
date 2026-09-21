import type { Prisma } from "@prisma/client";
import {
  countAutomations,
  countOtherActiveAutomationsByTrigger,
  createAutomation as createAutomationRepo,
  findAutomationById,
  findManyAutomations,
  softDeleteAutomation,
  updateAutomation as updateAutomationRepo,
  type AutomationFilters,
  type AutomationSortBy,
  type SortOrder,
} from "../repositories/automation.repository";
import { AppError } from "../utils/AppError";
import {
  accionAdmiteTrigger,
  registroDeAcciones as registroPorDefecto,
  type RegistroDeAcciones,
} from "./automationActions";
import {
  CONFIG_DE_TRIGGER,
  TRIGGERS_CONOCIDOS,
  TRIGGERS_DE_REGLA_UNICA,
  esTriggerConocido,
  type TriggerType,
} from "./automationTriggers";

// ---------------------------------------------------------------------------
// CRUD administrativo de Automation (docs/automations-architecture.md §8).
// Mismo patrón exacto que agent.service.ts: scopeado por organizationId en
// cada operación, soft delete vía deletedAt.
//
// LO QUE ESTE SERVICE VALIDA, Y EL CONTROLLER NO: la pertenencia a los
// catálogos. El controller valida la FORMA (zod: strings, longitudes, un
// objeto JSON); acá se decide si esa forma es una regla ejecutable —
// triggerType conocido, actionType registrado, actionConfig que pasa el
// schema de ESA acción, triggerConfig que pasa el schema de ESE trigger, que
// la acción admita el trigger y, para los triggers de regla única, que no
// haya otra activa (ítem 76). Todo ANTES de guardar: una regla mal configurada es
// un 400 al crearla, nunca un FAILED en tiempo de ejecución.
//
// LO QUE NO HAY ACÁ: ninguna ejecución. Este service configura reglas;
// ejecutarlas es automationDispatch.service.ts.
// ---------------------------------------------------------------------------

export interface ListAutomationsParams {
  page: number;
  pageSize: number;
  search?: string;
  triggerType?: string;
  isActive?: boolean;
  sortBy: AutomationSortBy;
  sortOrder: SortOrder;
}

export async function listAutomations(organizationId: string, params: ListAutomationsParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyAutomations(
      organizationId,
      filters as AutomationFilters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countAutomations(organizationId, filters as AutomationFilters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getAutomationById(organizationId: string, id: string) {
  const automation = await findAutomationById(id, organizationId);
  if (!automation) {
    throw new AppError("Automatización no encontrada", 404);
  }
  return automation;
}

// ---------------------------------------------------------------------------
// Validación contra los catálogos
// ---------------------------------------------------------------------------

export interface OpcionesDeValidacion {
  // Permite que un test valide contra SU PROPIO registro de acciones — ver
  // automationActions.ts. Producción usa el singleton.
  registro?: RegistroDeAcciones;
}

function assertTriggerConocido(triggerType: string): asserts triggerType is TriggerType {
  if (!esTriggerConocido(triggerType)) {
    throw new AppError(
      `triggerType "${triggerType}" no existe: debe ser uno de ${TRIGGERS_CONOCIDOS.join(", ")}`,
      400,
    );
  }
}

// Devuelve el triggerConfig YA parseado por el schema del trigger (ítem 76),
// con el mismo criterio que validarAccion: es eso lo que se guarda.
function validarConfigDeTrigger(
  triggerType: TriggerType,
  triggerConfig: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = CONFIG_DE_TRIGGER[triggerType].safeParse(triggerConfig);
  if (!parsed.success) {
    throw new AppError(
      `triggerConfig inválido para "${triggerType}": ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
      400,
    );
  }
  return parsed.data;
}

// Se llama DESPUÉS de validarAccion, así que la acción existe.
function assertAccionAdmiteTrigger(
  actionType: string,
  triggerType: string,
  registro: RegistroDeAcciones,
): void {
  const accion = registro.obtener(actionType);
  if (accion && !accionAdmiteTrigger(accion, triggerType)) {
    throw new AppError(
      `actionType "${actionType}" no se puede usar con el trigger "${triggerType}": admite ${(accion.triggers ?? []).join(", ")}`,
      400,
    );
  }
}

// Ver TRIGGERS_DE_REGLA_UNICA en automationTriggers.ts. 409 y no 400: la regla
// en sí es válida, lo que choca es el estado de la organización — y se
// resuelve desactivando o borrando la otra. Sin lock: dos altas CONCURRENTES
// del mismo trigger podrían pasar las dos, y el worker lo tolera (usa el
// menor daysWithoutActivity de la organización y lo avisa en el log). Para una
// pantalla de configuración que usa un ADMIN, no vale un mecanismo más.
async function assertReglaUnica(
  organizationId: string,
  triggerType: string,
  isActive: boolean,
  exceptoId?: string,
): Promise<void> {
  if (!isActive || !(TRIGGERS_DE_REGLA_UNICA as readonly string[]).includes(triggerType)) {
    return;
  }
  const otras = await countOtherActiveAutomationsByTrigger(organizationId, triggerType, exceptoId);
  if (otras > 0) {
    throw new AppError(
      `Ya hay una automatización activa para "${triggerType}" en esta organización: solo puede haber una. Desactivá o borrá la otra primero.`,
      409,
    );
  }
}

// Devuelve el actionConfig YA parseado por el schema de la acción (con trims y
// demás transformaciones aplicadas): es eso lo que se guarda, no el crudo.
function validarAccion(
  actionType: string,
  actionConfig: Record<string, unknown>,
  registro: RegistroDeAcciones,
): Record<string, unknown> {
  const accion = registro.obtener(actionType);
  if (!accion) {
    const disponibles = registro.tiposRegistrados();
    throw new AppError(
      `actionType "${actionType}" no existe: debe ser ${
        disponibles.length > 0 ? `uno de ${disponibles.join(", ")}` : "una acción registrada"
      }`,
      400,
    );
  }

  const parsed = accion.schema.safeParse(actionConfig);
  if (!parsed.success) {
    throw new AppError(
      `actionConfig inválido para "${actionType}": ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
      400,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export interface CreateAutomationInput {
  name: string;
  triggerType: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  // Opcional: opportunity.won no tiene config y se guarda "{}". Para un
  // trigger que sí la exige, omitirla es un 400 del schema del trigger.
  triggerConfig?: Record<string, unknown>;
  isActive?: boolean;
}

export async function createAutomation(
  organizationId: string,
  input: CreateAutomationInput,
  opciones: OpcionesDeValidacion = {},
) {
  const registro = opciones.registro ?? registroPorDefecto;

  assertTriggerConocido(input.triggerType);
  const triggerConfig = validarConfigDeTrigger(input.triggerType, input.triggerConfig ?? {});
  const actionConfig = validarAccion(input.actionType, input.actionConfig, registro);
  assertAccionAdmiteTrigger(input.actionType, input.triggerType, registro);
  await assertReglaUnica(organizationId, input.triggerType, input.isActive ?? true);

  return createAutomationRepo({
    organizationId,
    name: input.name,
    triggerType: input.triggerType,
    actionType: input.actionType,
    triggerConfig: triggerConfig as Prisma.InputJsonValue,
    // Mismo cast que Agent.guardrails: InputJsonValue exige una firma de índice
    // que Record<string, unknown> no declara, aunque cualquier objeto JSON la
    // cumple. Zod ya garantizó que es un objeto plano.
    actionConfig: actionConfig as Prisma.InputJsonValue,
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });
}

export interface UpdateAutomationInput {
  name?: string;
  triggerType?: string;
  actionType?: string;
  actionConfig?: Record<string, unknown>;
  triggerConfig?: Record<string, unknown>;
  isActive?: boolean;
}

export async function updateAutomation(
  organizationId: string,
  id: string,
  input: UpdateAutomationInput,
  opciones: OpcionesDeValidacion = {},
) {
  const registro = opciones.registro ?? registroPorDefecto;
  const existente = await getAutomationById(organizationId, id);

  const triggerEfectivo = input.triggerType ?? existente.triggerType;
  if (input.triggerType !== undefined) {
    assertTriggerConocido(input.triggerType);
  }

  // Mismo razonamiento que el actionConfig de abajo, del lado del trigger:
  // cambiar el trigger sin mandar un triggerConfig nuevo revalida el viejo
  // contra el schema nuevo. Pasar de opportunity.won a opportunity.stale sin
  // daysWithoutActivity es un 400; al revés, el schema de won descarta la
  // clave y se guarda "{}".
  const { triggerConfig: triggerConfigEntrante, ...sinTriggerConfig } = input;
  let triggerConfig: Record<string, unknown> | undefined;
  if (input.triggerType !== undefined || triggerConfigEntrante !== undefined) {
    // Un trigger guardado que el catálogo ya no conoce no se puede revalidar:
    // editarle solo la config sin cambiarlo es un 400 con el mismo mensaje.
    assertTriggerConocido(triggerEfectivo);
    triggerConfig = validarConfigDeTrigger(
      triggerEfectivo,
      triggerConfigEntrante ?? (existente.triggerConfig as Record<string, unknown>),
    );
  }

  // Si cambia la acción o su config, se revalida el config EFECTIVO contra la
  // acción EFECTIVA — cambiar el actionType de una regla sin mandar un config
  // nuevo tiene que revalidar el config viejo contra el schema nuevo, o la
  // regla quedaría guardada con una configuración que la acción no entiende
  // (y fallaría recién al despachar, que es justo lo que este service existe
  // para impedir).
  const { actionConfig: configEntrante, ...resto } = sinTriggerConfig;
  let actionConfig: Record<string, unknown> | undefined;
  if (input.actionType !== undefined || configEntrante !== undefined) {
    const actionTypeEfectivo = input.actionType ?? existente.actionType;
    const configEfectivo = configEntrante ?? (existente.actionConfig as Record<string, unknown>);
    actionConfig = validarAccion(actionTypeEfectivo, configEfectivo, registro);
  }

  if (input.triggerType !== undefined || input.actionType !== undefined) {
    assertAccionAdmiteTrigger(input.actionType ?? existente.actionType, triggerEfectivo, registro);
  }
  await assertReglaUnica(organizationId, triggerEfectivo, input.isActive ?? existente.isActive, id);

  const result = await updateAutomationRepo(id, organizationId, {
    ...resto,
    ...(actionConfig !== undefined ? { actionConfig: actionConfig as Prisma.InputJsonValue } : {}),
    ...(triggerConfig !== undefined
      ? { triggerConfig: triggerConfig as Prisma.InputJsonValue }
      : {}),
  });
  if (result.count === 0) {
    throw new AppError("Automatización no encontrada", 404);
  }

  return getAutomationById(organizationId, id);
}

// Soft delete a secas. Las AutomationExecution de una regla borrada se
// conservan: son historial ("esta regla corrió tal día por tal evento") y la
// FK compuesta es RESTRICT, así que tampoco podrían borrarse por accidente.
// Una regla borrada deja de despacharse de inmediato: el dispatcher filtra
// deletedAt: null en cada evento.
export async function deleteAutomation(organizationId: string, id: string) {
  await getAutomationById(organizationId, id);
  const result = await softDeleteAutomation(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Automatización no encontrada", 404);
  }
}
