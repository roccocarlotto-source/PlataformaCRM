import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { openActionsMenu } from "../../test/openActionsMenu";
import { ToastProvider } from "../../design-system/Toast";
import { PipelineFormPage } from "./PipelineFormPage";
import type { Stage } from "../stage/types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;

// ToastProvider como en App.tsx: la página llama a useToast() y sin el
// provider falla ruidosamente (ver design-system/useToast.ts).
function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/pipelines/new" element={<PipelineFormPage />} />
            <Route path="/pipelines/:id/edit" element={<PipelineFormPage />} />
            <Route path="/pipelines" element={<div>lista de pipelines</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Servidor de etapas en memoria para los tests del editor integrado: el
// listado devuelve el estado actual, y POST/PATCH/DELETE lo modifican, así
// el refetch que dispara cada mutation muestra el resultado real (mismo
// contrato que el backend: el listado se pide por pipelineId, ordenado).
function mockStagesServer(initial: Stage[]) {
  const stages = [...initial];
  const calls = {
    listRequests: [] as URL[],
    postedBody: undefined as unknown,
    patched: [] as { id: string; body: unknown }[],
    deletedIds: [] as string[],
  };
  server.use(
    http.get(stagesUrl, ({ request }) => {
      calls.listRequests.push(new URL(request.url));
      const sorted = [...stages].sort((a, b) => a.order - b.order);
      return HttpResponse.json({
        data: sorted,
        pagination: { page: 1, pageSize: 100, total: sorted.length, totalPages: 1 },
      });
    }),
    http.post(stagesUrl, async ({ request }) => {
      const body = (await request.json()) as {
        name: string;
        probability?: number;
        isWon?: boolean;
        isLost?: boolean;
      };
      calls.postedBody = body;
      // Sin ninguna regla de exclusividad de isWon/isLost, como el backend
      // desde §13: dos etapas ganadas en el mismo pipeline se aceptan.
      const created = makeStage({
        id: `st-${stages.length + 1}`,
        name: body.name,
        order: stages.length + 1,
        probability: String(body.probability ?? 0),
        isWon: body.isWon ?? false,
        isLost: body.isLost ?? false,
      });
      stages.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(`${stagesUrl}/:id`, async ({ request, params }) => {
      const id = params.id as string;
      const body = (await request.json()) as Partial<{
        name: string;
        order: number;
        isWon: boolean;
        isLost: boolean;
      }>;
      calls.patched.push({ id, body });
      const index = stages.findIndex((stage) => stage.id === id);
      if (body.order !== undefined) {
        // Intercambio con el vecino, como hace reindexStages del lado del
        // servidor para un movimiento de una posición.
        const neighbour = stages.find((stage) => stage.order === body.order);
        if (neighbour) neighbour.order = stages[index].order;
        stages[index] = { ...stages[index], order: body.order };
      }
      if (body.name !== undefined) stages[index] = { ...stages[index], name: body.name };
      if (body.isWon !== undefined) stages[index] = { ...stages[index], isWon: body.isWon };
      if (body.isLost !== undefined) stages[index] = { ...stages[index], isLost: body.isLost };
      return HttpResponse.json(stages[index]);
    }),
    http.delete(`${stagesUrl}/:id`, ({ params }) => {
      const id = params.id as string;
      calls.deletedIds.push(id);
      const index = stages.findIndex((stage) => stage.id === id);
      if (index !== -1) stages.splice(index, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

function mockPipelineDetail(overrides: Parameters<typeof makePipeline>[0] = {}) {
  server.use(
    http.get(`${baseUrl}/:id`, ({ params }) =>
      HttpResponse.json(makePipeline({ id: params.id as string, ...overrides })),
    ),
  );
}

function stageRow(name: string): HTMLElement {
  return screen.getByText(name).closest("tr")!;
}

describe("PipelineFormPage", () => {
  // Ítem 11: crear ya NO navega a la lista — se queda en la misma página, en
  // modo edición, con el editor de etapas habilitado (antes: "navega tras el
  // éxito").
  it("P19 create mode: no pide detail, submit usa create con isDefault, se queda en modo edición con Etapas habilitadas y muestra el toast", async () => {
    let getDetailCalled = false;
    let postedBody: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () => {
        getDetailCalled = true;
        return HttpResponse.json(makePipeline({ id: "pl-nuevo", name: "Ventas Nueva" }));
      }),
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makePipeline({ id: "pl-nuevo", name: "Ventas Nueva" }), {
          status: 201,
        });
      }),
    );
    const stagesCalls = mockStagesServer([]);

    const user = userEvent.setup();
    renderForm("/pipelines/new");

    expect(getDetailCalled).toBe(false);
    // En creación la sección Etapas es solo el aviso: sin editor ni GET /stages.
    expect(
      screen.getByText("Guardá el pipeline para poder agregar sus etapas."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nueva etapa")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre"), "Ventas Nueva");
    await user.click(screen.getByLabelText("Default"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Misma página, ahora en modo edición, con el editor habilitado.
    await waitFor(() => expect(screen.getByText("Editar pipeline")).toBeInTheDocument());
    expect(screen.queryByText("lista de pipelines")).not.toBeInTheDocument();
    expect(postedBody).toEqual({ name: "Ventas Nueva", isDefault: true });
    expect(screen.getByRole("status")).toHaveTextContent("Pipeline guardado");
    await waitFor(() => expect(screen.getByText("Nueva etapa")).toBeInTheDocument());
    expect(
      screen.queryByText("Guardá el pipeline para poder agregar sus etapas."),
    ).not.toBeInTheDocument();
    expect(stagesCalls.listRequests.length).toBeGreaterThan(0);
    expect(stagesCalls.listRequests[0].searchParams.get("pipelineId")).toBe("pl-nuevo");
    // Los datos del pipeline creado ya están en el formulario (sembrados en
    // la caché desde la respuesta del POST).
    expect(screen.getByLabelText("Nombre")).toHaveValue("Ventas Nueva");
  });

  it("P20 edit mode: carga detail, hidrata isDefault, submit usa update sobre el id correcto, navega tras el éxito y muestra el toast", async () => {
    let patchedId: string | undefined;
    let patchedBody: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makePipeline({ id: params.id as string, name: "Ventas Original", isDefault: true }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        patchedBody = await request.json();
        return HttpResponse.json(makePipeline({ id: "pl1", name: "Ventas Editada" }));
      }),
    );
    mockStagesServer([]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Ventas Original"));
    expect(screen.getByLabelText("Default")).toBeChecked();

    // Decisión A: el checkbox del default actual se puede desmarcar
    // libremente, sin restricción de UX.
    await user.click(screen.getByLabelText("Default"));
    expect(screen.getByLabelText("Default")).not.toBeChecked();

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Ventas Editada");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("lista de pipelines")).toBeInTheDocument());
    expect(patchedId).toBe("pl1");
    expect(patchedBody).toEqual({ name: "Ventas Editada", isDefault: false });
    // El toast sobrevive a la navegación: el provider está por encima del router.
    expect(screen.getByRole("status")).toHaveTextContent("Pipeline guardado");
  });

  it("P21 error de detail muestra error y no presenta el form como create vacío", async () => {
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no existe" } }, { status: 404 }),
      ),
    );

    renderForm("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no existe"));
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("P22 error de mutation (409 nombre duplicado) se muestra visible, no navega y no habilita Etapas", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe un pipeline con ese nombre en esta organización" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/new");

    await user.type(screen.getByLabelText("Nombre"), "Ventas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe un pipeline con ese nombre en esta organización",
      ),
    );
    expect(screen.queryByText("lista de pipelines")).not.toBeInTheDocument();
    expect(screen.getByText("Nuevo pipeline")).toBeInTheDocument();
    expect(
      screen.getByText("Guardá el pipeline para poder agregar sus etapas."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // Ítem 10 de docs/frontend-cambios-pendientes.md.
  it("Nombre lleva la marca de obligatorio y la referencia del asterisco va una sola vez, junto a Guardar", () => {
    renderForm("/pipelines/new");

    expect(screen.getByLabelText("Nombre")).toBeRequired();
    expect(screen.getByText("Nombre")).toHaveClass("ds-required");
    expect(screen.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);
  });
});

// Ítem 11 de docs/frontend-cambios-pendientes.md: el editor de etapas
// integrado, en modo edición.
describe("PipelineFormPage — editor de etapas integrado", () => {
  it("lista las etapas del pipeline ordenadas por order, con probabilidad y badge, y el mini-formulario Nueva etapa", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([
      makeStage({ id: "st2", name: "Ganada", order: 2, probability: "100", isWon: true }),
      makeStage({ id: "st1", name: "Prospecto", order: 1, probability: "37.5" }),
    ]);

    renderForm("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    const query = calls.listRequests[0].searchParams;
    expect(query.get("pipelineId")).toBe("pl1");
    expect(query.get("sortBy")).toBe("order");
    expect(query.get("sortOrder")).toBe("asc");

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => cellByHeader(row, "Nombre")?.textContent)).toEqual([
      "Prospecto",
      "Ganada",
    ]);
    expect(cellByHeader(rows[0], "Probabilidad")).toHaveTextContent("37.5%");
    expect(cellByHeader(rows[1], "Estado")).toHaveTextContent("Etapa de Ganada");
    expect(cellByHeader(rows[0], "Estado")?.textContent).toBe("");

    expect(screen.getByText("Nueva etapa")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre de la etapa")).toBeRequired();
    expect(screen.getByText("Nombre de la etapa")).toHaveClass("ds-required");
    expect(screen.getByRole("button", { name: "Agregar etapa" })).toBeInTheDocument();
    // El "Guardar" del pipeline sigue siendo uno solo y no se confunde con
    // los del editor.
    expect(screen.getAllByRole("button", { name: "Guardar" })).toHaveLength(1);
  });

  it("sin etapas muestra el empty state y el mini-formulario igual", async () => {
    mockPipelineDetail();
    mockStagesServer([]);

    renderForm("/pipelines/pl1/edit");

    await waitFor(() =>
      expect(
        screen.getByText("Este pipeline todavía no tiene etapas. Agregá la primera acá abajo."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Agregar etapa" })).toBeInTheDocument();
  });

  it("Agregar etapa: POST con pipelineId y sin order, la fila aparece, toast, y el formulario queda vacío para la siguiente", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([makeStage({ id: "st1", name: "Prospecto", order: 1 })]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre de la etapa"), "Negociación");
    // §13: Probabilidad va oculta hasta que se pide.
    await user.click(screen.getByRole("button", { name: "+ Agregar probabilidad" }));
    await user.type(screen.getByLabelText("Probabilidad (%)"), "60");
    await user.click(screen.getByLabelText("Ganada"));
    await user.click(screen.getByRole("button", { name: "Agregar etapa" }));

    await waitFor(() => expect(screen.getByText("Negociación")).toBeInTheDocument());
    expect(calls.postedBody).toEqual({
      pipelineId: "pl1",
      name: "Negociación",
      probability: 60,
      isWon: true,
      isLost: false,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Etapa guardada");
    expect(screen.getByLabelText("Nombre de la etapa")).toHaveValue("");
    // El campo revelado sigue a la vista (vacío) para la siguiente etapa: se
    // vacían los valores, no la decisión de mostrarlo.
    expect(screen.getByLabelText("Probabilidad (%)")).toHaveValue(null);
    expect(screen.getByLabelText("Ganada")).not.toBeChecked();
    expect(screen.getByLabelText("Nombre de la etapa")).toHaveFocus();
    // No navegó a ningún lado.
    expect(screen.getByText("Editar pipeline")).toBeInTheDocument();
  });

  // §13 (Parte B): Probabilidad oculta por defecto en "Nueva etapa".
  it("Nueva etapa: Probabilidad arranca oculta y, sin abrirla, el POST no manda probability (queda el default 0 del backend)", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByLabelText("Nombre de la etapa")).toBeInTheDocument());

    expect(screen.queryByLabelText("Probabilidad (%)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Agregar probabilidad" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre de la etapa"), "Prospecto");
    await user.click(screen.getByRole("button", { name: "Agregar etapa" }));

    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    expect(calls.postedBody).toEqual({
      pipelineId: "pl1",
      name: "Prospecto",
      isWon: false,
      isLost: false,
    });
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    // §14: el 0 del default se ve como guión en la fila, nunca como "0%".
    const probabilityCell = cellByHeader(screen.getAllByRole("row")[1], "Probabilidad");
    expect(probabilityCell).toHaveTextContent("-");
    expect(probabilityCell).not.toHaveTextContent("0%");
  });

  it("'+ Agregar probabilidad' revela el input con foco y deja de mostrarse", async () => {
    mockPipelineDetail();
    mockStagesServer([]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByLabelText("Nombre de la etapa")).toBeInTheDocument());

    const reveal = screen.getByRole("button", { name: "+ Agregar probabilidad" });
    await user.click(reveal);

    const probability = screen.getByLabelText("Probabilidad (%)");
    expect(probability).toHaveFocus();
    expect(probability).toHaveValue(null);
    expect(probability).toHaveAttribute("step", "any");
    expect(reveal).not.toBeInTheDocument();
  });

  it("Editar: Probabilidad arranca oculta si la etapa tiene 0, y visible con su valor si tiene otra cosa", async () => {
    mockPipelineDetail();
    mockStagesServer([
      makeStage({ id: "st1", name: "Prospecto", order: 1, probability: "0" }),
      makeStage({ id: "st2", name: "Negociación", order: 2, probability: "25.5" }),
    ]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());

    // Etapa con probabilidad 0: oculta, con el botón dentro de la fila.
    await openActionsMenu(user, stageRow("Prospecto"));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    let editRow = screen.getByRole("button", { name: "Guardar etapa" }).closest("tr")!;
    expect(within(editRow).queryByLabelText("Probabilidad (%)")).not.toBeInTheDocument();
    expect(
      within(editRow).getByRole("button", { name: "+ Agregar probabilidad" }),
    ).toBeInTheDocument();
    // El nombre conserva el foco (la persona acaba de elegir "Editar").
    expect(within(editRow).getByLabelText("Nombre de la etapa")).toHaveFocus();
    await user.click(within(editRow).getByRole("button", { name: "Cancelar" }));

    // Etapa con probabilidad distinta de 0: visible desde el arranque, sin el
    // botón.
    await openActionsMenu(user, stageRow("Negociación"));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    editRow = screen.getByRole("button", { name: "Guardar etapa" }).closest("tr")!;
    expect(within(editRow).getByLabelText("Probabilidad (%)")).toHaveValue(25.5);
    expect(
      within(editRow).queryByRole("button", { name: "+ Agregar probabilidad" }),
    ).not.toBeInTheDocument();
  });

  // §13 (Parte A): "Ganada" ya no es exclusiva por pipeline — la exclusividad
  // salió del backend (índices únicos parciales y pre-check). El editor nunca
  // la validó del lado del cliente; lo que se fija es el flujo completo: con
  // una etapa ganada ya en la lista, agregar otra ganada se acepta, aparece
  // con su badge y no hay ningún error en la fila.
  it("una segunda etapa Ganada en el mismo pipeline se guarda sin error y las dos muestran el badge", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([
      makeStage({ id: "st1", name: "Cerrado", order: 1, isWon: true }),
    ]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Cerrado")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre de la etapa"), "Entregado");
    await user.click(screen.getByLabelText("Ganada"));
    await user.click(screen.getByRole("button", { name: "Agregar etapa" }));

    await waitFor(() => expect(screen.getByText("Entregado")).toBeInTheDocument());
    expect(calls.postedBody).toMatchObject({ name: "Entregado", isWon: true, isLost: false });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Etapa guardada");

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => cellByHeader(row, "Estado")?.textContent)).toEqual([
      "Etapa de Ganada",
      "Etapa de Ganada",
    ]);
  });

  it("Ganada y Perdida se desmarcan mutuamente en el mini-formulario", async () => {
    mockPipelineDetail();
    mockStagesServer([]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByLabelText("Ganada")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Ganada"));
    expect(screen.getByLabelText("Ganada")).toBeChecked();
    await user.click(screen.getByLabelText("Perdida"));
    expect(screen.getByLabelText("Perdida")).toBeChecked();
    expect(screen.getByLabelText("Ganada")).not.toBeChecked();
  });

  it("error al agregar (409 del backend) se muestra en el propio formulario, sin toast, y no vacía los campos", async () => {
    mockPipelineDetail();
    mockStagesServer([]);
    server.use(
      http.post(stagesUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe una etapa con ese nombre en este pipeline" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByLabelText("Nombre de la etapa")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre de la etapa"), "Prospecto");
    await user.click(screen.getByRole("button", { name: "Agregar etapa" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe una etapa con ese nombre en este pipeline",
      ),
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByLabelText("Nombre de la etapa")).toHaveValue("Prospecto");
  });

  it("Editar abre la fila inline con sus valores; Guardar etapa hace PATCH sin order, vuelve a la fila de lectura y muestra el toast", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([
      makeStage({ id: "st1", name: "Prospecto", order: 1, probability: "25.5" }),
      makeStage({ id: "st2", name: "Cierre", order: 2 }),
    ]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());

    await openActionsMenu(user, stageRow("Prospecto"));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));

    // La fila pasó a ser el mini-formulario, con los valores de la etapa;
    // el de "Nueva etapa" sigue ahí, vacío.
    const nameInputs = screen.getAllByLabelText("Nombre de la etapa");
    expect(nameInputs).toHaveLength(2);
    const editRow = screen.getByRole("button", { name: "Guardar etapa" }).closest("tr")!;
    const editName = within(editRow).getByLabelText("Nombre de la etapa");
    expect(editName).toHaveValue("Prospecto");
    expect(editName).toHaveFocus();
    expect(within(editRow).getByLabelText("Probabilidad (%)")).toHaveValue(25.5);

    await user.clear(editName);
    await user.type(editName, "Contacto inicial");
    await user.click(within(editRow).getByRole("button", { name: "Guardar etapa" }));

    await waitFor(() => expect(screen.getByText("Contacto inicial")).toBeInTheDocument());
    expect(calls.patched).toEqual([
      {
        id: "st1",
        body: { name: "Contacto inicial", probability: 25.5, isWon: false, isLost: false },
      },
    ]);
    expect(screen.queryByRole("button", { name: "Guardar etapa" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Nombre de la etapa")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Etapa guardada");
  });

  it("Cancelar (y Escape) vuelven a la fila de lectura sin PATCH", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([makeStage({ id: "st1", name: "Prospecto", order: 1 })]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());

    await openActionsMenu(user, stageRow("Prospecto"));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Guardar etapa" })).not.toBeInTheDocument();
    expect(cellByHeader(stageRow("Prospecto"), "Nombre")).toHaveTextContent("Prospecto");

    await openActionsMenu(user, stageRow("Prospecto"));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Guardar etapa" })).not.toBeInTheDocument();

    expect(calls.patched).toEqual([]);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("Eliminar pide confirmación, hace DELETE, la fila desaparece y muestra el toast", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([
      makeStage({ id: "st1", name: "Prospecto", order: 1 }),
      makeStage({ id: "st2", name: "Cierre", order: 2 }),
    ]);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Cierre")).toBeInTheDocument());

    await openActionsMenu(user, stageRow("Cierre"));
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

    await waitFor(() => expect(screen.queryByText("Cierre")).not.toBeInTheDocument());
    expect(window.confirm).toHaveBeenCalledWith("¿Eliminar esta etapa?");
    expect(calls.deletedIds).toEqual(["st2"]);
    expect(screen.getByText("Prospecto")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Etapa eliminada");
  });

  it("Eliminar cancelado en el confirm no hace DELETE", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([makeStage({ id: "st1", name: "Prospecto", order: 1 })]);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());

    await openActionsMenu(user, stageRow("Prospecto"));
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

    expect(calls.deletedIds).toEqual([]);
    expect(screen.getByText("Prospecto")).toBeInTheDocument();
  });

  it("Subir/Bajar: PATCH con el order del vecino, la lista se reordena tras el refetch, sin toast; deshabilitados en los bordes", async () => {
    mockPipelineDetail();
    const calls = mockStagesServer([
      makeStage({ id: "st1", name: "Prospecto", order: 1 }),
      makeStage({ id: "st2", name: "Cierre", order: 2 }),
    ]);

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Cierre")).toBeInTheDocument());

    expect(within(stageRow("Prospecto")).getByRole("button", { name: "Subir" })).toBeDisabled();
    expect(within(stageRow("Prospecto")).getByRole("button", { name: "Bajar" })).toBeEnabled();
    expect(within(stageRow("Cierre")).getByRole("button", { name: "Subir" })).toBeEnabled();
    expect(within(stageRow("Cierre")).getByRole("button", { name: "Bajar" })).toBeDisabled();

    await user.click(within(stageRow("Cierre")).getByRole("button", { name: "Subir" }));

    await waitFor(() => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows.map((row) => cellByHeader(row, "Nombre")?.textContent)).toEqual([
        "Cierre",
        "Prospecto",
      ]);
    });
    expect(calls.patched).toEqual([{ id: "st2", body: { order: 1 } }]);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("error al mover se muestra a nivel de la lista", async () => {
    mockPipelineDetail();
    mockStagesServer([
      makeStage({ id: "st1", name: "Prospecto", order: 1 }),
      makeStage({ id: "st2", name: "Cierre", order: 2 }),
    ]);
    server.use(
      http.patch(`${stagesUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "conflicto de orden" } }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");
    await waitFor(() => expect(screen.getByText("Cierre")).toBeInTheDocument());

    await user.click(within(stageRow("Prospecto")).getByRole("button", { name: "Bajar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No pudimos mover la etapa: conflicto de orden",
      ),
    );
  });

  it("con más etapas que las que entran en una página avisa y linkea a la pantalla completa", async () => {
    mockPipelineDetail();
    server.use(
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 100, total: 101, totalPages: 2 },
        }),
      ),
    );

    renderForm("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Ver etapas" })).toHaveAttribute(
      "href",
      "/pipelines/pl1/stages",
    );
    // Con más de una página, el último de esta NO es el último del pipeline.
    expect(within(stageRow("Prospecto")).getByRole("button", { name: "Bajar" })).toBeEnabled();
  });
});
