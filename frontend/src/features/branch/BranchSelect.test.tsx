import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { BranchSelect } from "./BranchSelect";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/branches`;

function renderSelect(value: string | undefined, onChange = vi.fn(), emptyOptionLabel?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BranchSelect
        id="branch"
        label="Sucursal"
        value={value}
        onChange={onChange}
        emptyOptionLabel={emptyOptionLabel}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

function twoBranchesHandler() {
  return http.get(baseUrl, () =>
    HttpResponse.json({
      data: [
        makeBranch({ id: "b1", name: "Casa Central" }),
        makeBranch({ id: "b2", name: "Sucursal Pocitos" }),
      ],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

const combobox = () => screen.findByRole("combobox", { name: "Sucursal" });

describe("BranchSelect", () => {
  it("pide pageSize:100, sortBy:name, sortOrder:asc — y tipear filtra local, sin pedir search", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeBranch()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );
    const user = userEvent.setup();

    renderSelect(undefined);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("pageSize")).toBe("100");
    expect(captured[0].searchParams.get("sortBy")).toBe("name");
    expect(captured[0].searchParams.get("sortOrder")).toBe("asc");
    expect(captured[0].searchParams.has("search")).toBe(false);

    await user.click(await combobox());
    await user.keyboard("casa");
    expect(captured).toHaveLength(1);
  });

  it("ofrece la fila vacía y las sucursales devueltas, una línea cada una (solo las de la propia organización: eso lo garantiza el backend)", async () => {
    server.use(twoBranchesHandler());
    const user = userEvent.setup();

    renderSelect(undefined);

    const input = await combobox();
    expect(input).toHaveAttribute("placeholder", "Elegir sucursal…");
    expect(await listSelectOptions(user, input)).toEqual([
      "Elegir sucursal…",
      "Casa Central",
      "Sucursal Pocitos",
    ]);
    // Sin subtítulo: ninguna fila tiene segunda línea.
    for (const option of screen.getAllByRole("option")) {
      expect(option).not.toHaveAttribute("aria-describedby");
    }
  });

  it("tipear filtra las sucursales", async () => {
    server.use(twoBranchesHandler());
    const user = userEvent.setup();

    renderSelect(undefined);

    await user.click(await combobox());
    await user.keyboard("pocit");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Sucursal Pocitos" })).toBeInTheDocument();
  });

  it("al elegir una sucursal, llama a onChange con su id", async () => {
    server.use(twoBranchesHandler());
    const user = userEvent.setup();
    const onChange = renderSelect(undefined);

    await chooseSelectOption(user, await combobox(), "Casa Central");

    expect(onChange).toHaveBeenCalledWith("b1");
  });

  it("con emptyOptionLabel custom, usa ese texto (el filtro del listado lo llama 'Todas')", async () => {
    server.use(twoBranchesHandler());
    const user = userEvent.setup();

    renderSelect(undefined, vi.fn(), "Todas");

    const input = await combobox();
    expect(input).toHaveAttribute("placeholder", "Todas");
    const options = await listSelectOptions(user, input);
    expect(options[0]).toBe("Todas");
    expect(options).not.toContain("Elegir sucursal…");
  });

  it("muestra error si falla la carga", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "se cayó" } }, { status: 500 }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar las sucursales/)).toBeInTheDocument(),
    );
  });

  // Ítem 10 de docs/frontend-cambios-pendientes.md: los formularios que exigen
  // sucursal (QR, Vehículo, Claim) pasan `required`; el filtro del listado no
  // (los tests de arriba, sin el prop, siguen sin ninguna de las dos marcas).
  it("con required: el rótulo lleva la marca .ds-required y el input es required", async () => {
    server.use(twoBranchesHandler());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <BranchSelect id="branch" label="Sucursal" value={undefined} onChange={vi.fn()} required />
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("Sucursal")).toBeRequired();
    expect(screen.getByText("Sucursal")).toHaveClass("ds-required");
  });

  it("sin required (default): ni marca en el rótulo ni required en el input", async () => {
    server.use(twoBranchesHandler());
    renderSelect(undefined);

    expect(await screen.findByLabelText("Sucursal")).not.toBeRequired();
    expect(screen.getByText("Sucursal")).not.toHaveClass("ds-required");
  });
});
