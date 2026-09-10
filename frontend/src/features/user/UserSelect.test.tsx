import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeUser } from "../../test/userFixtures";
import { UserSelect } from "./UserSelect";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/users`;

function renderSelect(
  value: string | undefined,
  onChange = vi.fn(),
  props: Partial<Pick<ComponentProps<typeof UserSelect>, "clearable">> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UserSelect id="opp-owner" label="Propietario" value={value} onChange={onChange} {...props} />
    </QueryClientProvider>,
  );
  return onChange;
}

function twoUsersHandler() {
  return http.get(baseUrl, () =>
    HttpResponse.json({
      data: [
        makeUser({ id: "u1", fullName: "Ana Pérez" }),
        makeUser({ id: "u2", fullName: "Beto Gómez" }),
      ],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

function renderedOptions() {
  return screen
    .getAllByRole("option")
    .map((option) => [(option as HTMLOptionElement).value, option.textContent]);
}

describe("UserSelect", () => {
  it("pide isActive:true, pageSize:100, sortBy:fullName, sortOrder:asc — sin búsqueda de texto", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderSelect(undefined);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("isActive")).toBe("true");
    expect(captured[0].searchParams.get("pageSize")).toBe("100");
    expect(captured[0].searchParams.get("sortBy")).toBe("fullName");
    expect(captured[0].searchParams.get("sortOrder")).toBe("asc");
    expect(captured[0].searchParams.has("search")).toBe(false);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renderiza un <select> con los usuarios devueltos", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [
            makeUser({ id: "u1", fullName: "Ana Pérez" }),
            makeUser({ id: "u2", fullName: "Beto Gómez" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
    expect(screen.getByText("Beto Gómez")).toBeInTheDocument();
  });

  it("al elegir un usuario, llama a onChange con su id", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    const onChange = renderSelect(undefined);

    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Propietario"), "u1");

    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("muestra error si falla la carga", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "no autorizado" } }, { status: 403 }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar los usuarios/)).toBeInTheDocument(),
    );
  });

  // Regresión M6: emptyOptionLabel nació como prop opcional para que Activity
  // (assigneeId, que nunca se autoasigna) pudiera decir "Sin asignar" sin
  // tocar el texto que Opportunity veía entonces. Desde el ítem 7 de
  // docs/frontend-cambios-pendientes.md ningún caller omite el prop (los
  // cinco pasan "Sin asignar"), así que este test ya no protege a un
  // formulario real: fija que el default del componente sigue siendo el
  // histórico, y nada más. Se mantiene con value=undefined: es el único caso
  // en que la opción vacía se ve con cualquier clearable (tests de abajo).
  it("sin emptyOptionLabel, conserva el texto default anterior a M6", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() =>
      expect(screen.getByText("Asignado a quien crea (por defecto)")).toBeInTheDocument(),
    );
  });

  it("con emptyOptionLabel custom, usa ese texto en vez del default", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <UserSelect
          id="activity-assignee"
          label="Asignado a"
          value={undefined}
          onChange={vi.fn()}
          emptyOptionLabel="Sin asignar"
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Sin asignar")).toBeInTheDocument());
    expect(screen.queryByText("Asignado a quien crea (por defecto)")).not.toBeInTheDocument();
  });

  // Ítem 7 de docs/frontend-cambios-pendientes.md: para ownerId (que el
  // PATCH no puede limpiar) los formularios pasan clearable={false}. Con un
  // valor real seleccionado (el creador preseleccionado, o el dueño de un
  // registro en edición) la opción vacía no se ofrece — solo la lista de
  // usuarios, con el correcto marcado. Sin esto, "Sin asignar" competiría con
  // el usuario ya elegido y volvería la redundancia que motivó el ítem.
  it("clearable={false} con un value real: no renderiza la opción vacía, solo los usuarios con el elegido marcado", async () => {
    server.use(twoUsersHandler());

    renderSelect("u2", vi.fn(), { clearable: false });

    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue("u2"));
    expect(renderedOptions()).toEqual([
      ["u1", "Ana Pérez"],
      ["u2", "Beto Gómez"],
    ]);
    expect(screen.queryByText("Asignado a quien crea (por defecto)")).not.toBeInTheDocument();
  });

  // ...pero sin valor (editar un registro viejo sin dueño) la opción vacía sí
  // está, porque es lo único que hay para mostrar y desde ahí se puede elegir
  // a alguien.
  it("clearable={false} sin value: la opción vacía sí se renderiza, sin nada marcado", async () => {
    server.use(twoUsersHandler());

    renderSelect(undefined, vi.fn(), { clearable: false });

    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue(""));
    expect(renderedOptions()).toEqual([
      ["", "Asignado a quien crea (por defecto)"],
      ["u1", "Ana Pérez"],
      ["u2", "Beto Gómez"],
    ]);
  });

  // Regresión de Activity/Vehicle: assigneeId y assignedSalespersonId SÍ se
  // pueden limpiar (null en el PATCH), y elegir la opción vacía es la única
  // forma de desasignar. El default (clearable=true) tiene que seguir
  // ofreciéndola aunque haya un usuario seleccionado — ActivityFormPage.test
  // "limpiar assigneeId envía null explícito" depende de esto.
  it("clearable por default con un value real: la opción vacía sigue disponible para desasignar", async () => {
    server.use(twoUsersHandler());
    const user = userEvent.setup();
    const onChange = renderSelect("u2");

    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue("u2"));
    expect(renderedOptions()).toEqual([
      ["", "Asignado a quien crea (por defecto)"],
      ["u1", "Ana Pérez"],
      ["u2", "Beto Gómez"],
    ]);

    await user.selectOptions(screen.getByLabelText("Propietario"), "");
    expect(onChange).toHaveBeenCalledWith("");
  });
});
