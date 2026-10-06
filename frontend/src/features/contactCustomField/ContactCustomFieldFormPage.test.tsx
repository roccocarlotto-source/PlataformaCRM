import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { makeDefinicion } from "../../test/contactCustomFieldFixtures";
import { ContactCustomFieldFormPage } from "./ContactCustomFieldFormPage";
import type { ContactCustomFieldDefinition } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/contact-custom-fields`;

function renderForm(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/contact-custom-fields/new" element={<ContactCustomFieldFormPage />} />
          <Route path="/contact-custom-fields/:id/edit" element={<ContactCustomFieldFormPage />} />
          <Route path="/contact-custom-fields" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Los textos de las filas de opciones, en el orden en que se ven.
function opcionesEnPantalla(): string[] {
  return screen.getAllByLabelText(/^Opción \d+$/).map((input) => (input as HTMLInputElement).value);
}

// Un formulario de alta ya puesto en "Lista de opciones", con su etiqueta.
async function nuevaLista(user: UserEvent, etiqueta = "Forma de pago") {
  renderForm("/contact-custom-fields/new");
  await user.type(screen.getByLabelText("Etiqueta"), etiqueta);
  await chooseSelectOption(user, screen.getByLabelText("Tipo"), "Lista de opciones");
}

// Captura el cuerpo del POST de alta.
function capturarAlta() {
  const captura: { body: unknown; posts: number } = { body: null, posts: 0 };
  server.use(
    http.post(baseUrl, async ({ request }) => {
      captura.posts += 1;
      captura.body = await request.json();
      return HttpResponse.json(makeDefinicion(), { status: 201 });
    }),
  );
  return captura;
}

afterEach(() => vi.restoreAllMocks());

// B6: alta y edición de una definición de campo personalizado.
describe("ContactCustomFieldFormPage (B6)", () => {
  it("crea una lista con una opción por fila: Enter pasa a la siguiente, y las filas vacías no se mandan", async () => {
    const user = userEvent.setup();
    const alta = capturarAlta();
    await nuevaLista(user, "Combustible");

    // Arranca con una fila vacía lista para escribir.
    expect(opcionesEnPantalla()).toEqual([""]);
    await user.type(screen.getByLabelText("Opción 1"), "Nafta{Enter}");
    // Enter creó la fila siguiente y le dio el foco, sin enviar el formulario.
    expect(screen.getByLabelText("Opción 2")).toHaveFocus();
    expect(alta.posts).toBe(0);
    await user.keyboard("Diésel{Enter}GNC{Enter}");
    expect(opcionesEnPantalla()).toEqual(["Nafta", "Diésel", "GNC", ""]);
    // Enter en una fila vacía no apila otra.
    await user.keyboard("{Enter}");
    expect(opcionesEnPantalla()).toHaveLength(4);

    await user.click(screen.getByLabelText("Editable por el agente de IA"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(alta.body).not.toBeNull());
    expect(alta.body).toEqual({
      label: "Combustible",
      type: "SELECT",
      agentEditable: true,
      options: ["Nafta", "Diésel", "GNC"],
    });
    expect(await screen.findByText("listado")).toBeInTheDocument();
  });

  it("'Agregar opción' suma una fila vacía y le pone el foco; con una vacía al final, lleva el foco ahí", async () => {
    const user = userEvent.setup();
    await nuevaLista(user);

    await user.type(screen.getByLabelText("Opción 1"), "Contado");
    await user.click(screen.getByRole("button", { name: "Agregar opción" }));
    expect(opcionesEnPantalla()).toEqual(["Contado", ""]);
    expect(screen.getByLabelText("Opción 2")).toHaveFocus();

    // La última sigue vacía: no se apila otra.
    await user.click(screen.getByLabelText("Etiqueta"));
    await user.click(screen.getByRole("button", { name: "Agregar opción" }));
    expect(opcionesEnPantalla()).toEqual(["Contado", ""]);
    expect(screen.getByLabelText("Opción 2")).toHaveFocus();
  });

  it("pegar 'Contado, financiado, permuta' (o varios renglones) se reparte en una fila por opción", async () => {
    const user = userEvent.setup();
    const alta = capturarAlta();
    await nuevaLista(user);

    // Se selecciona el texto de la fila guardada y se pega encima, partido.
    await user.tripleClick(screen.getByLabelText("Opción 1"));
    await user.paste("Contado, financiado, permuta");
    expect(opcionesEnPantalla()).toEqual(["Contado", "financiado", "permuta"]);
    // El foco queda en la última que entró, para seguir escribiendo.
    expect(screen.getByLabelText("Opción 3")).toHaveFocus();

    // Con saltos de línea, y en el medio de la lista: entran debajo de la fila.
    await user.click(screen.getByRole("button", { name: "Agregar opción" }));
    await user.paste("Leasing\nCheque\n\n");
    expect(opcionesEnPantalla()).toEqual(["Contado", "financiado", "permuta", "Leasing", "Cheque"]);

    // Un texto sin separadores se pega como siempre, donde está el cursor.
    await user.click(screen.getByLabelText("Opción 5"));
    await user.paste(" diferido");
    expect(opcionesEnPantalla()[4]).toBe("Cheque diferido");

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(alta.body).not.toBeNull());
    expect((alta.body as { options: string[] }).options).toEqual([
      "Contado",
      "financiado",
      "permuta",
      "Leasing",
      "Cheque diferido",
    ]);
  });

  it("subir, bajar y borrar una opción: el orden que queda es el que se guarda", async () => {
    const user = userEvent.setup();
    const alta = capturarAlta();
    await nuevaLista(user);
    await user.click(screen.getByLabelText("Opción 1"));
    await user.paste("Contado, Financiado, Permuta");

    // Los bordes no se pueden pasar.
    expect(screen.getByRole("button", { name: "Subir la opción 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar la opción 3" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Bajar la opción 1" }));
    expect(opcionesEnPantalla()).toEqual(["Financiado", "Contado", "Permuta"]);
    // El foco sigue a la fila que se movió: se puede volver a bajar con Enter.
    expect(screen.getByRole("button", { name: "Bajar la opción 2" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Contado pasó a la posición 2 de 3.");
    await user.keyboard("{Enter}");
    expect(opcionesEnPantalla()).toEqual(["Financiado", "Permuta", "Contado"]);
    // Llegó al final: "Bajar" quedó deshabilitado y el foco pasa a "Subir".
    expect(screen.getByRole("button", { name: "Subir la opción 3" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Subir la opción 2" }));
    expect(opcionesEnPantalla()).toEqual(["Permuta", "Financiado", "Contado"]);

    await user.click(screen.getByRole("button", { name: "Borrar la opción 2" }));
    expect(opcionesEnPantalla()).toEqual(["Permuta", "Contado"]);

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(alta.body).not.toBeNull());
    expect((alta.body as { options: string[] }).options).toEqual(["Permuta", "Contado"]);
  });

  it("opciones repetidas —sin distinguir mayúsculas ni acentos— no se mandan: el mensaje del backend y las dos filas marcadas", async () => {
    const user = userEvent.setup();
    const alta = capturarAlta();
    await nuevaLista(user, "Combustible");
    await user.click(screen.getByLabelText("Opción 1"));
    await user.paste("Diésel, Nafta, DIESEL");

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La opción «DIESEL» está repetida (no se distinguen mayúsculas ni acentos)",
    );
    expect(alta.posts).toBe(0);
    expect(screen.getByLabelText("Opción 1")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Opción 2")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Opción 3")).toHaveAttribute("aria-invalid", "true");

    // Al corregir, la marca se va y se puede guardar.
    await user.clear(screen.getByLabelText("Opción 3"));
    expect(screen.getByLabelText("Opción 1")).not.toHaveAttribute("aria-invalid");
    await user.type(screen.getByLabelText("Opción 3"), "GNC");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(alta.posts).toBe(1));
    expect((alta.body as { options: string[] }).options).toEqual(["Diésel", "Nafta", "GNC"]);
  });

  it("más opciones que el máximo no se mandan, con el mismo mensaje del backend; en el tope no se ofrece agregar", async () => {
    const user = userEvent.setup();
    const alta = capturarAlta();
    await nuevaLista(user);
    await user.click(screen.getByLabelText("Opción 1"));
    await user.paste(Array.from({ length: 51 }, (_, i) => `Opción ${i + 1}`).join("\n"));
    expect(opcionesEnPantalla()).toHaveLength(51);

    expect(screen.getByRole("button", { name: "Agregar opción" })).toBeDisabled();
    expect(screen.getByText("Llegaste al máximo de 50 opciones.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Una lista no puede tener más de 50 opciones",
    );
    expect(alta.posts).toBe(0);

    await user.click(screen.getByRole("button", { name: "Borrar la opción 51" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(alta.posts).toBe(1));
    expect((alta.body as { options: string[] }).options).toHaveLength(50);
  });

  it("una lista sin opciones no se manda; un 409 del backend se muestra tal cual", async () => {
    const user = userEvent.setup();
    let posts = 0;
    server.use(
      http.post(baseUrl, () => {
        posts += 1;
        return HttpResponse.json(
          { error: { message: "Ya existe un campo personalizado con ese nombre" } },
          { status: 409 },
        );
      }),
    );
    await nuevaLista(user, "Color");

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Un campo de lista necesita al menos una opción",
    );
    expect(posts).toBe(0);

    await user.type(screen.getByLabelText("Opción 1"), "Rojo");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un campo personalizado con ese nombre",
    );
    expect(posts).toBe(1);
  });

  it("en edición el tipo no se puede cambiar y el PATCH no lo manda", async () => {
    let body: unknown = null;
    const user = userEvent.setup();
    const id = "11111111-1111-4111-8111-111111111111";
    server.use(
      http.get(`${baseUrl}/${id}`, () => HttpResponse.json(makeDefinicion({ id }))),
      http.patch(`${baseUrl}/${id}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeDefinicion({ id, label: "Patente del auto" }));
      }),
    );
    renderForm(`/contact-custom-fields/${id}/edit`);

    await waitFor(() => expect(screen.getByLabelText("Etiqueta")).toHaveValue("Patente"));
    expect(screen.getByLabelText("Tipo")).toBeDisabled();
    await user.clear(screen.getByLabelText("Etiqueta"));
    await user.type(screen.getByLabelText("Etiqueta"), "Patente del auto");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ label: "Patente del auto", agentEditable: true });
  });
});

// Editar las opciones de una lista que ya usan contactos: antes de guardar se
// consulta cuántos contactos tiene cada opción tocada y se abre el diálogo
// (OptionChangesDialog) con lo que va a pasar y qué hacer con las eliminadas.
describe("ContactCustomFieldFormPage: opciones que ya usan contactos", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const lista = makeDefinicion({
    id,
    key: "forma_de_pago",
    label: "Forma de pago",
    type: "SELECT",
    options: ["Contado", "Financiado", "Permuta"],
  });

  // Monta la edición de `campo`. `uso` es lo que responde option-usage (o un
  // status de error); devuelve lo que se pidió y lo que se mandó.
  function editar(campo: ContactCustomFieldDefinition, uso: Record<string, number> | number) {
    const captura: { body: unknown; patches: number; consultasDeUso: number } = {
      body: null,
      patches: 0,
      consultasDeUso: 0,
    };
    server.use(
      http.get(`${baseUrl}/${campo.id}`, () => HttpResponse.json(campo)),
      http.get(`${baseUrl}/${campo.id}/option-usage`, () => {
        captura.consultasDeUso += 1;
        return typeof uso === "number"
          ? HttpResponse.json({ error: { message: "falló" } }, { status: uso })
          : HttpResponse.json({ contactsByOption: uso });
      }),
      http.patch(`${baseUrl}/${campo.id}`, async ({ request }) => {
        captura.patches += 1;
        captura.body = await request.json();
        return HttpResponse.json(campo);
      }),
    );
    renderForm(`/contact-custom-fields/${campo.id}/edit`);
    return captura;
  }

  async function esperarOpciones(esperadas: string[]) {
    await waitFor(() => expect(opcionesEnPantalla()).toEqual(esperadas));
  }

  it("el caso de Rocco en una lista: partir «Contado, financiado, permuta» NO la renombra — queda eliminada, con sus contactos, y las tres son nuevas", async () => {
    const user = userEvent.setup();
    const captura = editar(
      makeDefinicion({ ...lista, options: ["Contado, financiado, permuta", "Leasing"] }),
      { "Contado, financiado, permuta": 4 },
    );
    await esperarOpciones(["Contado, financiado, permuta", "Leasing"]);

    // Se selecciona el texto de la fila guardada y se pega encima, partido.
    await user.tripleClick(screen.getByLabelText("Opción 1"));
    await user.paste("Contado, financiado, permuta");
    expect(opcionesEnPantalla()).toEqual(["Contado", "financiado", "permuta", "Leasing"]);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const d = await screen.findByRole("dialog", { name: "Opciones que ya usan contactos" });
    expect(d).toHaveTextContent(
      "«Contado, financiado, permuta» se elimina de la lista y 4 contactos la tienen elegida.",
    );
    expect(d).not.toHaveTextContent("pasa a llamarse");
    // Por defecto, dejar sin cargar; una lista simple no ofrece "todas las nuevas".
    const selector = within(d).getByLabelText("Qué hacer con «Contado, financiado, permuta»");
    expect(selector).toHaveValue("Dejar sin cargar");
    const ofrecidas = await listSelectOptions(user, selector);
    expect(ofrecidas).toEqual([
      "Dejar sin cargar",
      "Pasar a: Contado",
      "Pasar a: financiado",
      "Pasar a: permuta",
      "Pasar a: Leasing",
      "Conservar como opción eliminada",
    ]);
    await user.click(within(d).getByRole("option", { name: "Pasar a: Contado" }));
    await user.click(within(d).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(captura.patches).toBe(1));
    expect(captura.body).toEqual({
      label: "Forma de pago",
      agentEditable: true,
      options: ["Contado", "financiado", "permuta", "Leasing"],
      removedOptions: [{ from: "Contado, financiado, permuta", action: "move", to: ["Contado"] }],
    });
    expect(await screen.findByText("listado")).toBeInTheDocument();
  });

  it("el caso de Rocco en una selección múltiple: «Pasar a todas las nuevas» manda las tres", async () => {
    const user = userEvent.setup();
    const captura = editar(
      makeDefinicion({
        ...lista,
        type: "MULTI_SELECT",
        options: ["Contado, financiado, permuta", "Leasing"],
      }),
      { "Contado, financiado, permuta": 2, Leasing: 5 },
    );
    await esperarOpciones(["Contado, financiado, permuta", "Leasing"]);

    // Se selecciona el texto de la fila guardada y se pega encima, partido.
    await user.tripleClick(screen.getByLabelText("Opción 1"));
    await user.paste("Contado, financiado, permuta");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const d = await screen.findByRole("dialog", { name: "Opciones que ya usan contactos" });
    const selector = within(d).getByLabelText("Qué hacer con «Contado, financiado, permuta»");
    await user.click(selector);
    await user.click(
      within(d).getByRole("option", {
        name: "Pasar a todas las nuevas (Contado, financiado, permuta)",
      }),
    );
    await user.click(within(d).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(captura.patches).toBe(1));
    expect(captura.body).toEqual({
      label: "Forma de pago",
      agentEditable: true,
      options: ["Contado", "financiado", "permuta", "Leasing"],
      removedOptions: [
        {
          from: "Contado, financiado, permuta",
          action: "move",
          to: ["Contado", "financiado", "permuta"],
        },
      ],
    });
  });

  it("renombrar es editar el texto de la misma fila, aunque se la mueva de lugar; se informa y manda renamedOptions", async () => {
    const user = userEvent.setup();
    const captura = editar(lista, { Contado: 12, Permuta: 1 });
    await esperarOpciones(["Contado", "Financiado", "Permuta"]);

    // Reordenar y DESPUÉS editar: la identidad es de la fila, no del lugar.
    await user.click(screen.getByRole("button", { name: "Bajar la opción 1" }));
    expect(opcionesEnPantalla()).toEqual(["Financiado", "Contado", "Permuta"]);
    await user.clear(screen.getByLabelText("Opción 2"));
    await user.type(screen.getByLabelText("Opción 2"), "Contado efectivo");
    // Borrar Permuta y agregar otra: eliminada + nueva, no un renombre.
    await user.click(screen.getByRole("button", { name: "Borrar la opción 3" }));
    await user.click(screen.getByRole("button", { name: "Agregar opción" }));
    await user.keyboard("Cheque");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const d = await screen.findByRole("dialog", { name: "Opciones que ya usan contactos" });
    expect(d).toHaveTextContent(
      "«Contado» pasa a llamarse «Contado efectivo»: se actualiza en 12 contactos la tienen elegida.",
    );
    expect(d).toHaveTextContent("«Permuta» se elimina de la lista y un contacto la tiene elegida.");
    const selector = within(d).getByLabelText("Qué hacer con «Permuta»");
    await user.click(selector);
    await user.click(within(d).getByRole("option", { name: "Conservar como opción eliminada" }));
    await user.click(within(d).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(captura.patches).toBe(1));
    expect(captura.body).toEqual({
      label: "Forma de pago",
      agentEditable: true,
      options: ["Financiado", "Contado efectivo", "Cheque"],
      renamedOptions: [{ from: "Contado", to: "Contado efectivo" }],
      removedOptions: [{ from: "Permuta", action: "keep" }],
    });
  });

  it("Cancelar en el diálogo no guarda nada y el formulario queda como estaba", async () => {
    const user = userEvent.setup();
    const captura = editar(lista, { Financiado: 4 });
    await esperarOpciones(["Contado", "Financiado", "Permuta"]);

    await user.click(screen.getByRole("button", { name: "Borrar la opción 2" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    const d = await screen.findByRole("dialog", { name: "Opciones que ya usan contactos" });
    await user.click(within(d).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(captura.consultasDeUso).toBe(1);
    expect(captura.patches).toBe(0);
    expect(opcionesEnPantalla()).toEqual(["Contado", "Permuta"]);
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });

  it("borrar una opción que ningún contacto usa se guarda sin diálogo; agregar y reordenar ni consultan el uso", async () => {
    const user = userEvent.setup();
    const borrado = editar(lista, { Contado: 3 });
    await esperarOpciones(["Contado", "Financiado", "Permuta"]);
    await user.click(screen.getByRole("button", { name: "Borrar la opción 3" }));
    await user.click(screen.getByRole("button", { name: "Bajar la opción 1" }));
    await user.click(screen.getByRole("button", { name: "Agregar opción" }));
    await user.keyboard("Leasing");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(borrado.patches).toBe(1));
    expect(borrado.consultasDeUso).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(borrado.body).toEqual({
      label: "Forma de pago",
      agentEditable: true,
      options: ["Financiado", "Contado", "Leasing"],
    });
  });

  it("si no se puede verificar el uso, no se guarda a ciegas: avisa y deja reintentar", async () => {
    const user = userEvent.setup();
    const captura = editar(lista, 500);
    await esperarOpciones(["Contado", "Financiado", "Permuta"]);

    await user.click(screen.getByRole("button", { name: "Borrar la opción 1" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos verificar cuántos contactos usan las opciones que cambiaste",
    );
    expect(captura.patches).toBe(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("cambio de tipo: de lista a selección múltiple y vuelta, el PATCH manda `type`; en un campo de texto el tipo sigue bloqueado", async () => {
    const user = userEvent.setup();
    const captura = editar(lista, {});
    await esperarOpciones(["Contado", "Financiado", "Permuta"]);

    const tipo = screen.getByLabelText("Tipo");
    expect(tipo).toBeEnabled();
    expect(await listSelectOptions(user, tipo)).toEqual([
      "Lista de opciones",
      "Selección múltiple",
    ]);
    await user.click(screen.getByRole("option", { name: "Selección múltiple" }));
    expect(screen.getByText(/solo se puede cambiar entre/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(captura.patches).toBe(1));
    expect(captura.body).toEqual({
      label: "Forma de pago",
      type: "MULTI_SELECT",
      agentEditable: true,
      options: ["Contado", "Financiado", "Permuta"],
    });
  });

  it("volver de selección múltiple a lista: el 409 del backend se muestra tal cual", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${baseUrl}/${id}`, () => HttpResponse.json({ ...lista, type: "MULTI_SELECT" })),
      http.patch(`${baseUrl}/${id}`, () =>
        HttpResponse.json(
          {
            error: {
              message:
                "No se puede pasar «Forma de pago» a lista de una sola opción: 3 contactos tienen más de una opción elegida.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderForm(`/contact-custom-fields/${id}/edit`);
    await esperarOpciones(["Contado", "Financiado", "Permuta"]);

    await chooseSelectOption(user, screen.getByLabelText("Tipo"), "Lista de opciones");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "3 contactos tienen más de una opción elegida",
    );
    expect(screen.queryByText("listado")).not.toBeInTheDocument();
  });
});
