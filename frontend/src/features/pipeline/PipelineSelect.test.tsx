import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makePipeline } from "../../test/pipelineFixtures";
import { PipelineSelect } from "./PipelineSelect";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/pipelines`;

function renderSelect(value: string | undefined, onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PipelineSelect id="opp-pipeline" label="Pipeline" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("PipelineSelect", () => {
  it("pide pageSize:100, sortBy:name, sortOrder:asc — sin búsqueda de texto", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makePipeline({ id: "pl1", name: "Ventas" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderSelect(undefined);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("pageSize")).toBe("100");
    expect(captured[0].searchParams.get("sortBy")).toBe("name");
    expect(captured[0].searchParams.get("sortOrder")).toBe("asc");
    expect(captured[0].searchParams.has("search")).toBe(false);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renderiza un <select> con los pipelines devueltos y dispara onChange al elegir", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [
            makePipeline({ id: "pl1", name: "Ventas" }),
            makePipeline({ id: "pl2", name: "Postventa" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    const onChange = renderSelect(undefined);

    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl2");

    expect(onChange).toHaveBeenCalledWith("pl2");
  });

  it("muestra error si falla la carga", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "error de red" } }, { status: 500 }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar los pipelines/)).toBeInTheDocument(),
    );
  });

  // Ítem 10 de docs/frontend-cambios-pendientes.md: el asterisco y el bloqueo
  // van siempre juntos, así la señal visual coincide con lo que pasa al
  // guardar. El "*" lo dibuja CSS (::after), no forma parte del texto.
  it("con required: el rótulo lleva la marca .ds-required y el <select> es required", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makePipeline({ id: "pl1", name: "Ventas" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PipelineSelect
          id="opp-pipeline"
          label="Pipeline"
          value={undefined}
          onChange={vi.fn()}
          required
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("Pipeline")).toBeRequired();
    expect(screen.getByText("Pipeline")).toHaveClass("ds-required");
  });

  it("sin required (default): ni marca en el rótulo ni required en el <select>", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makePipeline({ id: "pl1", name: "Ventas" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    renderSelect(undefined);

    expect(await screen.findByLabelText("Pipeline")).not.toBeRequired();
    expect(screen.getByText("Pipeline")).not.toHaveClass("ds-required");
  });
});
