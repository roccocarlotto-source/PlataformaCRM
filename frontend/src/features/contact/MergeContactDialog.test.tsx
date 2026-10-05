import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeContact } from "../../test/contactFixtures";
import { MergeContactDialog } from "./MergeContactDialog";
import {
  advertenciaDeLaUnion,
  CAMPOS_DE_LA_UNION,
  type Elecciones,
  type VistaPreviaDeLaUnion,
} from "./merge";

// "Unir con otro contacto": buscar el duplicado, la vista previa lado a lado
// con los defaults del backend, elegir un campo y confirmar.

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

afterEach(() => vi.restoreAllMocks());

const contactsUrl = `${env.apiUrl}/api/contacts`;

function defaults(lado: "kept" | "absorbed" = "kept"): Elecciones {
  return Object.fromEntries(CAMPOS_DE_LA_UNION.map((c) => [c, lado])) as Elecciones;
}

function vista(): VistaPreviaDeLaUnion {
  const base = {
    company: null,
    owner: null,
    leadScore: null,
    leadIntent: null,
    leadServiceOfInterest: null,
    leadUrgency: null,
    leadBudgetAmount: null,
    leadBudgetCurrency: null,
    leadLocation: null,
  };
  return {
    kept: { ...makeContact({ id: "k", firstName: "Ana", email: null }), ...base },
    absorbed: {
      ...makeContact({ id: "d", firstName: "Ana María", email: "ana@example.com" }),
      ...base,
      company: { name: "Acme" },
    },
    defaults: { ...defaults("kept"), email: "absorbed" },
    aMover: { conversaciones: 2, oportunidades: 1, actividades: 0 },
  };
}

function setup(onPost: (body: unknown) => void = () => {}) {
  server.use(
    http.get(contactsUrl, () =>
      HttpResponse.json({
        data: [makeContact({ id: "d", firstName: "Ana María", lastName: "Pérez" })],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    ),
    http.get(`${contactsUrl}/d`, () =>
      HttpResponse.json(makeContact({ id: "d", firstName: "Ana María", lastName: "Pérez" })),
    ),
    http.get(`${contactsUrl}/k/merge-preview`, ({ request }) => {
      expect(new URL(request.url).searchParams.get("with")).toBe("d");
      return HttpResponse.json(vista());
    }),
    http.post(`${contactsUrl}/k/merge`, async ({ request }) => {
      onPost(await request.json());
      return HttpResponse.json({
        contactId: "k",
        absorbedId: "d",
        movidos: { conversaciones: 2, oportunidades: 1 },
        conversacionesCerradas: 0,
      });
    }),
  );
  const onMerged = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MergeContactDialog contactId="k" onClose={vi.fn()} onMerged={onMerged} />
    </QueryClientProvider>,
  );
  return onMerged;
}

async function elegirDuplicado(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Buscar por nombre o email…"), "ana");
  await user.click(await screen.findByText("Ana María Pérez"));
}

describe("MergeContactDialog", () => {
  it("muestra los dos lado a lado con los defaults y lo que se mueve", async () => {
    const user = userEvent.setup();
    setup();
    await elegirDuplicado(user);

    expect(
      await screen.findByRole("group", { name: "Qué valor queda en cada campo" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email: el duplicado")).toBeChecked();
    expect(screen.getByLabelText("Nombre: este contacto")).toBeChecked();
    expect(screen.getByText(/Duplicado: Acme/)).toBeInTheDocument();
    expect(screen.getByText(/2 conversaciones/)).toBeInTheDocument();
    expect(screen.getByText(/1 oportunidades/)).toBeInTheDocument();
    expect(screen.queryByText(/actividades y tareas/)).toBeNull();
  });

  it("confirmar une con las elecciones (las cambiadas y los defaults)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let body: { absorbedId: string; fields: Elecciones } | undefined;
    const user = userEvent.setup();
    const onMerged = setup((b) => (body = b as typeof body));
    await elegirDuplicado(user);

    await user.click(await screen.findByLabelText("Nombre: el duplicado"));
    await user.click(screen.getByRole("button", { name: "Unir" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/No se puede deshacer desde la pantalla/),
    );
    // Antes de confirmar se advierte QUÉ se mueve, con sus cantidades
    // (tanda 5 de la auditoría, docs-privados, local).
    const advertencia = confirmSpy.mock.calls[0]?.[0] ?? "";
    expect(advertencia).toMatch(/Pasan a este contacto: 2 conversaciones/);
    expect(advertencia).toMatch(/1 oportunidades/);
    expect(advertencia).toMatch(/misma persona/);
    await waitFor(() => expect(body).toBeDefined());
    expect(body?.absorbedId).toBe("d");
    expect(body?.fields.firstName).toBe("absorbed");
    expect(body?.fields.email).toBe("absorbed");
    expect(body?.fields.phone).toBe("kept");
    await waitFor(() => expect(onMerged).toHaveBeenCalled());
  });

  it("si no se confirma, no se une", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    let posts = 0;
    const user = userEvent.setup();
    setup(() => (posts += 1));
    await elegirDuplicado(user);
    await screen.findByRole("group", { name: "Qué valor queda en cada campo" });
    await user.click(screen.getByRole("button", { name: "Unir" }));
    expect(posts).toBe(0);
  });

  it("sin duplicado elegido, Unir está deshabilitado", () => {
    setup();
    expect(screen.getByRole("button", { name: "Unir" })).toBeDisabled();
  });
});

describe("advertenciaDeLaUnion", () => {
  const vista = (extra: Partial<VistaPreviaDeLaUnion>): VistaPreviaDeLaUnion =>
    ({
      aMover: { conversaciones: 1, cupones: 2, actividades: 3, oportunidades: 1, reservas: 0 },
      ...extra,
    }) as VistaPreviaDeLaUnion;

  it("dice qué pasa al contacto que queda, con cantidades, y omite lo que no tiene", () => {
    const texto = advertenciaDeLaUnion("Visitante caa2c873", vista({}));
    expect(texto).toContain("1 conversaciones (con sus mensajes)");
    expect(texto).toContain("2 cupones");
    expect(texto).toContain("3 actividades y tareas");
    expect(texto).toContain("1 oportunidades");
    expect(texto).not.toContain("reservas");
    expect(texto).not.toContain("chat del sitio web");
  });

  it("si el duplicado tiene un chat web, avisa que se corta", () => {
    const texto = advertenciaDeLaUnion("Visitante caa2c873", vista({ chatsWebACortar: 1 }));
    expect(texto).toMatch(/El chat del sitio web del duplicado se corta/);
    expect(texto).toMatch(/visitante nuevo/);
  });

  it("sin nada asociado lo dice, y siempre pide confirmar que son la misma persona", () => {
    const texto = advertenciaDeLaUnion("Ana Duplicada", vista({ aMover: {} }));
    expect(texto).toContain("El duplicado no tiene registros asociados.");
    expect(texto).toMatch(/misma persona/);
    expect(texto).toMatch(/No se puede deshacer desde la pantalla/);
  });
});
