import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { ConfirmProvider } from "../../design-system/ConfirmDialog";
import { OrganizationsPage } from "./OrganizationsPage";
import type { PlatformOrganization } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const listUrl = `${env.apiUrl}/api/admin/organizations`;
const editionsUrl = `${env.apiUrl}/api/admin/organizations/editions`;
const editionUrl = (id: string) => `${env.apiUrl}/api/admin/organizations/${id}/edition`;
const reenviarUrl = (id: string) =>
  `${env.apiUrl}/api/admin/organizations/${id}/admin-invitation/resend`;

const ORGS: PlatformOrganization[] = [
  {
    id: "org-1",
    name: "Automotora Centro",
    slug: "automotora-centro",
    edition: "COMPLETA",
    industry: "AUTOMOTORA",
    modulosActivados: [],
  },
  {
    id: "org-2",
    name: "Automotora Norte",
    slug: "automotora-norte",
    edition: "ESENCIAL",
    industry: "AUTOMOTORA",
    modulosActivados: [],
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={["/admin/organizations"]}>
          <Routes>
            <Route path="/admin/organizations" element={<OrganizationsPage />} />
            <Route path="/" element={<p>Inicio</p>} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("OrganizationsPage", () => {
  beforeEach(() => {
    server.use(http.get(listUrl, () => HttpResponse.json(ORGS)));
  });

  it("mientras el backend no ofrezca ESENCIAL (hoy), no se muestra: vuelve al inicio", async () => {
    server.use(http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA"] })));
    renderPage();

    expect(await screen.findByText("Inicio")).toBeInTheDocument();
    expect(screen.queryByText("Automotora Norte")).not.toBeInTheDocument();
  });

  it("con ESENCIAL ofrecida: lista la edición de cada una y el botón solo en las ESENCIAL", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
    );
    renderPage();

    const centro = (await screen.findByText("Automotora Centro")).closest("tr")!;
    const norte = screen.getByText("Automotora Norte").closest("tr")!;
    expect(within(centro).getByText("Completa")).toBeInTheDocument();
    expect(within(norte).getByText("Esencial")).toBeInTheDocument();
    expect(
      within(centro).queryByRole("button", { name: "Pasar a edición completa" }),
    ).not.toBeInTheDocument();
    // Reenviar la invitación está en todas las filas (ver OrganizationsPage).
    expect(within(centro).getByRole("button", { name: "Reenviar invitación" })).toBeInTheDocument();
    expect(
      within(norte).getByRole("button", { name: "Pasar a edición completa" }),
    ).toBeInTheDocument();
  });

  // Reenviar (prueba de la Clínica Demo, 2026-10-11).
  it("reenviar la invitación: pide confirmación, manda el POST y dice a qué email salió", async () => {
    let reenvios = 0;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.post(reenviarUrl("org-1"), () => {
        reenvios += 1;
        return HttpResponse.json({ email: "admin@example.com" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const fila = (await screen.findByText("Automotora Centro")).closest("tr") as HTMLElement;
    await user.click(within(fila).getByRole("button", { name: "Reenviar invitación" }));
    expect(screen.getByText(/Le llega de nuevo el mail/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reenviamos la invitación de «Automotora Centro» a admin@example.com.",
    );
    expect(reenvios).toBe(1);
  });

  // En una demo (docs/taller-demo.md) el reenvío cubre a varios usuarios y
  // puede dejar alguno sin mail por el cupo del correo.
  it("reenviar la invitación en una demo: dice a quiénes salió y a quiénes no", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.post(reenviarUrl("org-1"), () =>
        HttpResponse.json({
          email: "valentina@example.com",
          reenviadas: ["valentina@example.com", "martin@example.com"],
          sinEnviar: ["diego@example.com"],
        }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    const fila = (await screen.findByText("Automotora Centro")).closest("tr") as HTMLElement;
    await user.click(within(fila).getByRole("button", { name: "Reenviar invitación" }));
    await user.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reenviamos la invitación de «Automotora Centro» a valentina@example.com, martin@example.com. No salió el mail de diego@example.com (el correo tiene un cupo por hora): probá de nuevo más tarde.",
    );
  });

  it("reenviar la invitación: si el administrador ya la aceptó, muestra el error del backend", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.post(reenviarUrl("org-1"), () =>
        HttpResponse.json(
          {
            error: {
              message:
                "El administrador de esta organización ya aceptó la invitación: no hay nada que reenviar.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    const fila = (await screen.findByText("Automotora Centro")).closest("tr") as HTMLElement;
    await user.click(within(fila).getByRole("button", { name: "Reenviar invitación" }));
    await user.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(
      await screen.findByText(
        "El administrador de esta organización ya aceptó la invitación: no hay nada que reenviar.",
      ),
    ).toBeInTheDocument();
  });

  it("pasar a completa: pide confirmación, manda el PATCH y muestra la edición nueva", async () => {
    let body: unknown;
    let lista = ORGS;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.get(listUrl, () => HttpResponse.json(lista)),
      http.patch(editionUrl("org-2"), async ({ request }) => {
        body = await request.json();
        lista = ORGS.map((o) => (o.id === "org-2" ? { ...o, edition: "COMPLETA" as const } : o));
        return HttpResponse.json({ id: "org-2", edition: "COMPLETA" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Pasar a edición completa" }));
    expect(screen.getByText(/No se puede volver a la edición esencial/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pasar a completa" }));

    await waitFor(() => expect(body).toEqual({ edition: "COMPLETA" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "«Automotora Norte» ya tiene la edición completa.",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Pasar a edición completa" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("cancelar la confirmación no manda nada", async () => {
    let pidio = false;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.patch(editionUrl("org-2"), () => {
        pidio = true;
        return HttpResponse.json({ id: "org-2", edition: "COMPLETA" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Pasar a edición completa" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(pidio).toBe(false);
  });

  it("si el backend rechaza (por ejemplo, 409), muestra el error", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.patch(editionUrl("org-2"), () =>
        HttpResponse.json({ error: { message: "No se puede bajar de edición" } }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Pasar a edición completa" }));
    await user.click(screen.getByRole("button", { name: "Pasar a completa" }));
    expect(await screen.findByText(/No se puede bajar de edición/)).toBeInTheDocument();
  });
});

// Reiniciar los datos de una Clínica Demo (docs/rubros.md §12.3).
describe("OrganizationsPage: reiniciar datos de demo", () => {
  const reiniciarUrl = (id: string) => `${env.apiUrl}/api/admin/organizations/${id}/demo/reiniciar`;
  const estadoUrl = (id: string) => `${env.apiUrl}/api/admin/organizations/${id}/demo/reinicio`;
  const REINICIANDO = { estado: "REINICIANDO", iniciadoEn: "2026-10-18T17:39:17.000Z" };

  // El reinicio corre en segundo plano: el POST responde REINICIANDO y el GET
  // del estado, desde ese momento, el final que se le pase.
  function reinicioQueTermina(id: string, final: Record<string, unknown>) {
    let pedido = false;
    const posts = { cantidad: 0 };
    server.use(
      http.post(reiniciarUrl(id), () => {
        pedido = true;
        posts.cantidad += 1;
        return HttpResponse.json(REINICIANDO, { status: 202 });
      }),
      http.get(estadoUrl(id), () => HttpResponse.json(pedido ? final : { estado: "NINGUNO" })),
    );
    return posts;
  }
  const listo = (resultado: unknown) => ({
    ...REINICIANDO,
    estado: "LISTO",
    terminadoEn: "2026-10-18T17:41:09.000Z",
    resultado,
  });
  const CON_DEMOS: PlatformOrganization[] = [
    ...ORGS,
    {
      id: "org-demo",
      name: "Clínica Demo Norte",
      slug: "clinica-demo-norte",
      edition: "COMPLETA",
      industry: "CLINICA",
      modulosActivados: [],
    },
    {
      id: "org-clinica",
      name: "Clínica Centro",
      slug: "clinica-centro",
      edition: "COMPLETA",
      industry: "CLINICA",
      modulosActivados: [],
    },
    {
      id: "org-auto-demo",
      name: "Automotora con slug raro",
      slug: "clinica-demo-automotora",
      edition: "COMPLETA",
      industry: "AUTOMOTORA",
      modulosActivados: [],
    },
    {
      id: "org-taller-demo",
      name: "Taller Demo",
      slug: "taller-demo",
      edition: "COMPLETA",
      industry: "AUTOMOTORA",
      modulosActivados: ["servicios"],
      isDemo: true,
    },
    {
      id: "org-taller-falso",
      name: "Taller Demo sin bandera",
      slug: "taller-demo-sin-bandera",
      edition: "COMPLETA",
      industry: "AUTOMOTORA",
      modulosActivados: [],
      isDemo: false,
    },
  ];
  const RESPUESTA = {
    organizationId: "org-demo",
    borrados: { pacientes: 9, turnos: 30 },
    cargados: {
      bloqueos: 1,
      pacientes: 8,
      turnosProximos: 24,
      sobreturnos: 1,
      turnosConfirmados: 3,
      turnosAtendidos: 3,
      turnosOmitidos: 0,
    },
  };

  beforeEach(() => {
    server.use(
      http.get(listUrl, () => HttpResponse.json(CON_DEMOS)),
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.get(`${env.apiUrl}/api/admin/organizations/:id/demo/reinicio`, () =>
        HttpResponse.json({ estado: "NINGUNO" }),
      ),
    );
  });

  async function filaDe(nombre: string) {
    return (await screen.findByText(nombre)).closest("tr") as HTMLElement;
  }

  it("en el Taller Demo: confirmación del taller y resumen de lo cargado", async () => {
    reinicioQueTermina(
      "org-taller-demo",
      listo({
        organizationId: "org-taller-demo",
        borrados: { contactos: 20 },
        cargados: {
          contactos: 16,
          unidades: 10,
          oportunidades: 13,
          vehiculosDeClientes: 15,
          ordenes: 11,
          tareas: 11,
          conversaciones: 3,
        },
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(
      within(await filaDe("Taller Demo")).getByRole("button", {
        name: "Reiniciar datos de demo",
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(/órdenes de taller/);
    await user.click(screen.getByRole("button", { name: "Reiniciar datos" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reiniciamos «Taller Demo»: 16 contactos, 10 unidades, 13 oportunidades, 15 vehículos de clientes y 11 órdenes de taller de ejemplo.",
    );
  });

  it("el botón está solo en las filas de una demo", async () => {
    renderPage();
    expect(
      within(await filaDe("Clínica Demo Norte")).getByRole("button", {
        name: "Reiniciar datos de demo",
      }),
    ).toBeInTheDocument();
    for (const nombre of [
      "Automotora Centro",
      "Automotora Norte",
      "Clínica Centro",
      "Automotora con slug raro",
      "Taller Demo sin bandera",
    ]) {
      expect(
        within(await filaDe(nombre)).queryByRole("button", { name: "Reiniciar datos de demo" }),
      ).not.toBeInTheDocument();
    }
  });

  it("pide confirmación con qué se borra y qué queda; cancelar no manda nada", async () => {
    const posts = reinicioQueTermina("org-demo", listo(RESPUESTA));
    const user = userEvent.setup();
    renderPage();

    await user.click(
      within(await filaDe("Clínica Demo Norte")).getByRole("button", {
        name: "Reiniciar datos de demo",
      }),
    );
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent("¿Reiniciar los datos de «Clínica Demo Norte»?");
    expect(dialogo).toHaveTextContent(/Se borran para siempre los pacientes, los turnos/);
    expect(dialogo).toHaveTextContent(/Queda la configuración/);
    await user.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    expect(posts.cantidad).toBe(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("confirmado, manda el POST y dice cuántos pacientes y turnos cargó", async () => {
    const posts = reinicioQueTermina("org-demo", listo(RESPUESTA));
    const user = userEvent.setup();
    renderPage();

    await user.click(
      within(await filaDe("Clínica Demo Norte")).getByRole("button", {
        name: "Reiniciar datos de demo",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Reiniciar datos" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reiniciamos «Clínica Demo Norte»: 8 pacientes y 24 turnos próximos de ejemplo, más 3 atendidos la semana pasada.",
    );
    expect(posts.cantidad).toBe(1);
  });

  it("si el backend rechaza, muestra su error", async () => {
    server.use(
      http.post(reiniciarUrl("org-demo"), () =>
        HttpResponse.json(
          {
            error: {
              message:
                "La regla del recordatorio de la demo está activa: desactivala antes de reiniciar, así los turnos nuevos no programan mensajes.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      within(await filaDe("Clínica Demo Norte")).getByRole("button", {
        name: "Reiniciar datos de demo",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Reiniciar datos" }));
    expect(
      await screen.findByText(/La regla del recordatorio de la demo está activa/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("mientras se reinicia (aunque se haya recargado la página) dice Reiniciando… y el botón queda deshabilitado", async () => {
    server.use(http.get(estadoUrl("org-taller-demo"), () => HttpResponse.json(REINICIANDO)));
    renderPage();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reiniciando «Taller Demo»… Tarda unos tres minutos",
    );
    expect(
      within(await filaDe("Taller Demo")).getByRole("button", { name: "Reiniciar datos de demo" }),
    ).toBeDisabled();
  });

  it("si falla a mitad, muestra el motivo", async () => {
    reinicioQueTermina("org-taller-demo", {
      ...REINICIANDO,
      estado: "FALLO",
      terminadoEn: "2026-10-18T17:41:09.000Z",
      mensaje: "No se pudo terminar el reinicio. Volvé a reiniciar.",
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(
      within(await filaDe("Taller Demo")).getByRole("button", { name: "Reiniciar datos de demo" }),
    );
    await user.click(screen.getByRole("button", { name: "Reiniciar datos" }));
    expect(
      await screen.findByText(
        "No se pudo reiniciar «Taller Demo»: No se pudo terminar el reinicio. Volvé a reiniciar.",
      ),
    ).toBeInTheDocument();
  });

  it("si el servidor perdió el estado en medio, dice que no sabemos cómo terminó", async () => {
    reinicioQueTermina("org-taller-demo", { estado: "NINGUNO" });
    const user = userEvent.setup();
    renderPage();
    await user.click(
      within(await filaDe("Taller Demo")).getByRole("button", { name: "Reiniciar datos de demo" }),
    );
    await user.click(screen.getByRole("button", { name: "Reiniciar datos" }));
    expect(
      await screen.findByText(/No sabemos cómo terminó el reinicio de «Taller Demo»/),
    ).toBeInTheDocument();
  });
});

// Módulos activables (docs/servicios.md §1.5): la columna "Módulos" y
// "Activar Servicios" / "Desactivar Servicios", solo en una AUTOMOTORA.
describe("OrganizationsPage: módulos activables", () => {
  const moduloUrl = (id: string) => `${env.apiUrl}/api/admin/organizations/${id}/modulos/servicios`;
  const previaUrl = (id: string) => `${moduloUrl(id)}/previa`;
  const previa = (ventasAConvertir: number) =>
    http.get(previaUrl("org-1"), () =>
      HttpResponse.json({ organizationId: "org-1", modulo: "servicios", ventasAConvertir }),
    );
  const CON_CLINICA: PlatformOrganization[] = [
    ...ORGS,
    {
      id: "org-clinica",
      name: "Clínica Centro",
      slug: "clinica-centro",
      edition: "COMPLETA",
      industry: "CLINICA",
      modulosActivados: [],
    },
  ];

  beforeEach(() => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      previa(0),
    );
  });

  async function filaDe(nombre: string) {
    return (await screen.findByText(nombre)).closest("tr") as HTMLElement;
  }

  it("muestra los módulos activados y ofrece activar o desactivar solo en las automotoras", async () => {
    server.use(
      http.get(listUrl, () =>
        HttpResponse.json(
          CON_CLINICA.map((o) =>
            o.id === "org-2" ? { ...o, modulosActivados: ["servicios"] } : o,
          ),
        ),
      ),
    );
    renderPage();

    const centro = await filaDe("Automotora Centro");
    const norte = await filaDe("Automotora Norte");
    const clinica = await filaDe("Clínica Centro");
    expect(within(norte).getByText("Servicios")).toBeInTheDocument();
    expect(within(centro).queryByText("Servicios")).not.toBeInTheDocument();
    expect(within(centro).getByRole("button", { name: "Activar Servicios" })).toBeInTheDocument();
    expect(within(norte).getByRole("button", { name: "Desactivar Servicios" })).toBeInTheDocument();
    expect(within(clinica).queryByRole("button", { name: /Servicios/ })).not.toBeInTheDocument();
  });

  it("activar: pide confirmación, manda el PUT, avisa y recarga el listado", async () => {
    let lista = CON_CLINICA;
    let pedidos = 0;
    server.use(
      http.get(listUrl, () => HttpResponse.json(lista)),
      http.put(moduloUrl("org-1"), () => {
        pedidos += 1;
        lista = lista.map((o) =>
          o.id === "org-1" ? { ...o, modulosActivados: ["servicios"] } : o,
        );
        return HttpResponse.json({ organizationId: "org-1", modulo: "servicios", activo: true });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      within(await filaDe("Automotora Centro")).getByRole("button", { name: "Activar Servicios" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "¿Activar Servicios en «Automotora Centro»?",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/vehículos? de clientes?/);
    await user.click(screen.getByRole("button", { name: "Activar" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Servicios activado en «Automotora Centro».",
    );
    expect(pedidos).toBe(1);
    await waitFor(async () =>
      expect(
        within(await filaDe("Automotora Centro")).getByRole("button", {
          name: "Desactivar Servicios",
        }),
      ).toBeInTheDocument(),
    );
  });

  it("desactivar: confirma que los datos se conservan y manda el DELETE; cancelar no manda nada", async () => {
    let pedidos = 0;
    server.use(
      http.get(listUrl, () =>
        HttpResponse.json(
          CON_CLINICA.map((o) =>
            o.id === "org-1" ? { ...o, modulosActivados: ["servicios"] } : o,
          ),
        ),
      ),
      http.delete(moduloUrl("org-1"), () => {
        pedidos += 1;
        return HttpResponse.json({ organizationId: "org-1", modulo: "servicios", activo: false });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const boton = within(await filaDe("Automotora Centro")).getByRole("button", {
      name: "Desactivar Servicios",
    });
    await user.click(boton);
    expect(screen.getByRole("dialog")).toHaveTextContent(/Los datos se conservan/);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(pedidos).toBe(0);

    await user.click(boton);
    await user.click(screen.getByRole("button", { name: "Desactivar" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Servicios desactivado en «Automotora Centro».",
    );
    expect(pedidos).toBe(1);
  });

  it("si el backend rechaza, muestra su error", async () => {
    server.use(
      http.get(listUrl, () => HttpResponse.json(CON_CLINICA)),
      http.put(moduloUrl("org-1"), () =>
        HttpResponse.json(
          { error: { message: "El módulo servicios no está disponible para el rubro CLINICA." } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      within(await filaDe("Automotora Centro")).getByRole("button", { name: "Activar Servicios" }),
    );
    await user.click(await screen.findByRole("button", { name: "Activar" }));
    expect(await screen.findByText(/no está disponible para el rubro/)).toBeInTheDocument();
  });

  it("activar: la confirmación dice cuántas ventas se convierten en vehículos de clientes (S10)", async () => {
    server.use(
      http.get(listUrl, () => HttpResponse.json(CON_CLINICA)),
      previa(3),
    );
    const user = userEvent.setup();
    renderPage();

    const boton = within(await filaDe("Automotora Centro")).getByRole("button", {
      name: "Activar Servicios",
    });
    await user.click(boton);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Se van a crear 3 vehículos de clientes a partir de ventas anteriores.",
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    server.use(previa(1));
    await user.click(boton);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Se va a crear 1 vehículo de cliente a partir de una venta anterior.",
    );
  });

  it("activar: si la previa falla, confirma igual, sin el número", async () => {
    server.use(
      http.get(listUrl, () => HttpResponse.json(CON_CLINICA)),
      http.get(previaUrl("org-1"), () =>
        HttpResponse.json({ error: { message: "Error" } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      within(await filaDe("Automotora Centro")).getByRole("button", { name: "Activar Servicios" }),
    );
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toHaveTextContent("¿Activar Servicios en «Automotora Centro»?");
    expect(dialogo).not.toHaveTextContent(/vehículos? de clientes?/);
  });
});

// La ayuda "¿Cómo se hace?": prendida por defecto en todas; se apaga por
// organización.
describe("OrganizationsPage: la ayuda ¿Cómo se hace?", () => {
  const ayudaUrl = (id: string) => `${env.apiUrl}/api/admin/organizations/${id}/help-assistant`;

  beforeEach(() => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
    );
  });

  async function filaDe(nombre: string) {
    return (await screen.findByText(nombre)).closest("tr") as HTMLElement;
  }

  it("ofrece apagarla donde está prendida (o no vino el dato) y prenderla donde está apagada", async () => {
    server.use(
      http.get(listUrl, () =>
        HttpResponse.json(
          ORGS.map((o) => (o.id === "org-2" ? { ...o, helpAssistantEnabled: false } : o)),
        ),
      ),
    );
    renderPage();
    const centro = await filaDe("Automotora Centro");
    const norte = await filaDe("Automotora Norte");
    expect(within(centro).getByRole("button", { name: "Apagar ayuda" })).toBeInTheDocument();
    expect(within(centro).queryByText("Ayuda apagada")).not.toBeInTheDocument();
    expect(within(norte).getByRole("button", { name: "Prender ayuda" })).toBeInTheDocument();
    expect(within(norte).getByText("Ayuda apagada")).toBeInTheDocument();
  });

  it("apagar: pide confirmación, manda el PATCH con enabled false y avisa; cancelar no manda nada", async () => {
    const cuerpos: unknown[] = [];
    server.use(
      http.get(listUrl, () => HttpResponse.json(ORGS)),
      http.patch(ayudaUrl("org-1"), async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json({ id: "org-1", helpAssistantEnabled: false });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const boton = () =>
      filaDe("Automotora Centro").then((fila) =>
        within(fila).getByRole("button", { name: "Apagar ayuda" }),
      );
    await user.click(await boton());
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "¿Apagar la ayuda en «Automotora Centro»?",
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cuerpos).toEqual([]);

    await user.click(await boton());
    await user.click(await screen.findByRole("button", { name: "Apagar" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      'Ayuda "¿Cómo se hace?" apagada en «Automotora Centro».',
    );
    expect(cuerpos).toEqual([{ enabled: false }]);
  });
});
