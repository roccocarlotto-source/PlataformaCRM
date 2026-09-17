import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeUser } from "../../test/userFixtures";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
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
        makeUser({ id: "u1", fullName: "Ana Pérez", email: "ana@example.com" }),
        makeUser({ id: "u2", fullName: "Beto Gómez", email: "beto@acme.test" }),
      ],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

function emptyHandler() {
  return http.get(baseUrl, () =>
    HttpResponse.json({
      data: [],
      pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    }),
  );
}

const combobox = () => screen.getByRole("combobox", { name: "Propietario" });

describe("UserSelect", () => {
  it("pide isActive:true, pageSize:100, sortBy:fullName, sortOrder:asc — y tipear filtra local, sin pedir search", async () => {
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
    const user = userEvent.setup();

    renderSelect(undefined);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("isActive")).toBe("true");
    expect(captured[0].searchParams.get("pageSize")).toBe("100");
    expect(captured[0].searchParams.get("sortBy")).toBe("fullName");
    expect(captured[0].searchParams.get("sortOrder")).toBe("asc");
    expect(captured[0].searchParams.has("search")).toBe(false);

    // La búsqueda del combobox es sobre la página ya traída: GET /api/users
    // no tiene `search` en el contrato, así que tipear no pide nada nuevo.
    await user.click(await screen.findByRole("combobox", { name: "Propietario" }));
    await user.keyboard("ana");
    expect(captured).toHaveLength(1);
  });

  it("cada usuario es una fila con el nombre y el email como segunda línea, sin íconos", async () => {
    server.use(twoUsersHandler());
    const user = userEvent.setup();

    renderSelect(undefined);

    await user.click(await screen.findByRole("combobox", { name: "Propietario" }));
    const ana = screen.getByRole("option", { name: "Ana Pérez" });
    expect(ana).toHaveAccessibleDescription("ana@example.com");
    expect(screen.getByRole("option", { name: "Beto Gómez" })).toHaveAccessibleDescription(
      "beto@acme.test",
    );
    // Ni avatar ni ícono de persona: sin selección, ninguna fila tiene SVG.
    expect(ana.querySelector("svg")).toBeNull();
  });

  it("se puede buscar un usuario por su email", async () => {
    server.use(twoUsersHandler());
    const user = userEvent.setup();

    renderSelect(undefined);

    await user.click(await screen.findByRole("combobox", { name: "Propietario" }));
    await user.keyboard("acme");

    expect(screen.getByRole("option", { name: "Beto Gómez" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ana Pérez" })).not.toBeInTheDocument();
  });

  it("al elegir un usuario, llama a onChange con su id y muestra su nombre", async () => {
    server.use(twoUsersHandler());
    const user = userEvent.setup();
    const onChange = renderSelect(undefined);

    await chooseSelectOption(
      user,
      await screen.findByRole("combobox", { name: "Propietario" }),
      "Ana Pérez",
    );

    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("con un value, el input muestra el nombre del usuario elegido", async () => {
    server.use(twoUsersHandler());

    renderSelect("u2");

    await waitFor(() => expect(combobox()).toHaveValue("Beto Gómez"));
  });

  it("muestra error si falla la carga, con el rótulo presente", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "no autorizado" } }, { status: 403 }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar los usuarios/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Propietario")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  // Regresión M6: emptyOptionLabel nació como prop opcional para que Activity
  // (assigneeId, que nunca se autoasigna) pudiera decir "Sin asignar" sin
  // tocar el texto que Opportunity veía entonces. Desde el ítem 7 de
  // docs/frontend-cambios-pendientes.md ningún caller omite el prop (los
  // cinco pasan "Sin asignar"), así que este test ya no protege a un
  // formulario real: fija que el default del componente sigue siendo el
  // histórico, y nada más. Se mantiene con value=undefined: es el único caso
  // en que la fila vacía se ve con cualquier clearable (tests de abajo).
  it("sin emptyOptionLabel, conserva el texto default anterior a M6", async () => {
    server.use(emptyHandler());

    renderSelect(undefined);

    // Cerrado y sin valor, la fila vacía es el placeholder del input.
    await waitFor(() =>
      expect(combobox()).toHaveAttribute("placeholder", "Asignado a quien crea (por defecto)"),
    );
  });

  it("con emptyOptionLabel custom, usa ese texto en vez del default", async () => {
    server.use(emptyHandler());
    const user = userEvent.setup();
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

    const input = await screen.findByRole("combobox", { name: "Asignado a" });
    expect(input).toHaveAttribute("placeholder", "Sin asignar");
    expect(await listSelectOptions(user, input)).toEqual(["Sin asignar"]);
  });

  // Ítem 7 de docs/frontend-cambios-pendientes.md: para ownerId (que el
  // PATCH no puede limpiar) los formularios pasan clearable={false}. Con un
  // valor real seleccionado (el creador preseleccionado, o el dueño de un
  // registro en edición) la fila vacía no se ofrece — solo la lista de
  // usuarios, con el correcto marcado. Sin esto, "Sin asignar" competiría con
  // el usuario ya elegido y volvería la redundancia que motivó el ítem.
  it("clearable={false} con un value real: no ofrece la fila vacía, solo los usuarios con el elegido marcado", async () => {
    server.use(twoUsersHandler());
    const user = userEvent.setup();

    renderSelect("u2", vi.fn(), { clearable: false });

    await waitFor(() => expect(combobox()).toHaveValue("Beto Gómez"));
    expect(await listSelectOptions(user, combobox())).toEqual(["Ana Pérez", "Beto Gómez"]);
    expect(screen.getByRole("option", { name: "Beto Gómez" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // ...pero sin valor (editar un registro viejo sin dueño) la fila vacía sí
  // está, porque es lo único que hay para mostrar y desde ahí se puede elegir
  // a alguien.
  it("clearable={false} sin value: la fila vacía sí se ofrece, primera", async () => {
    server.use(twoUsersHandler());
    const user = userEvent.setup();

    renderSelect(undefined, vi.fn(), { clearable: false });

    await waitFor(() => expect(combobox()).toHaveValue(""));
    expect(await listSelectOptions(user, combobox())).toEqual([
      "Asignado a quien crea (por defecto)",
      "Ana Pérez",
      "Beto Gómez",
    ]);
  });

  // Regresión de Activity/Vehicle: assigneeId y assignedSalespersonId SÍ se
  // pueden limpiar (null en el PATCH), y elegir la fila vacía es la única
  // forma de desasignar. El default (clearable=true) tiene que seguir
  // ofreciéndola aunque haya un usuario seleccionado — ActivityFormPage.test
  // "limpiar assigneeId envía null explícito" depende de esto.
  it("clearable por default con un value real: la fila vacía sigue disponible para desasignar", async () => {
    server.use(twoUsersHandler());
    const user = userEvent.setup();
    const onChange = renderSelect("u2");

    await waitFor(() => expect(combobox()).toHaveValue("Beto Gómez"));
    expect(await listSelectOptions(user, combobox())).toEqual([
      "Asignado a quien crea (por defecto)",
      "Ana Pérez",
      "Beto Gómez",
    ]);

    await user.click(screen.getByRole("option", { name: "Asignado a quien crea (por defecto)" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
