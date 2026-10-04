import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetaConnectionIdentity } from "./MetaConnectionIdentity";

const base = {
  pageId: "104857600000001",
  pageName: null,
  instagramBusinessAccountId: "17841400000000001",
  instagramUsername: null,
};

describe("MetaConnectionIdentity", () => {
  it("con los nombres: página · @usuario, y los ids en chico", () => {
    render(
      <MetaConnectionIdentity
        conexion={{ ...base, pageName: "Demo Autos", instagramUsername: "demo.autos" }}
      />,
    );

    expect(screen.getByText("Demo Autos")).toBeInTheDocument();
    expect(screen.getByText("@demo.autos")).toBeInTheDocument();
    expect(screen.getByText("Página 104857600000001 · Instagram 17841400000000001")).toHaveClass(
      "ds-hint",
    );
  });

  it("con el nombre de la página y sin Instagram vinculado lo dice", () => {
    render(
      <MetaConnectionIdentity
        conexion={{ ...base, pageName: "Demo Autos", instagramBusinessAccountId: null }}
      />,
    );

    expect(screen.getByText(/sin Instagram vinculado/)).toBeInTheDocument();
    expect(screen.getByText("Página 104857600000001")).toBeInTheDocument();
  });

  it("con el Instagram vinculado pero sin su usuario, muestra el id del Instagram", () => {
    render(<MetaConnectionIdentity conexion={{ ...base, pageName: "Demo Autos" }} />);

    expect(screen.getByText("17841400000000001")).toBeInTheDocument();
  });

  it("sin los nombres (conexión vieja que no se pudo completar): los ids, como antes", () => {
    render(<MetaConnectionIdentity conexion={base} />);

    expect(screen.getByText("104857600000001")).toBeInTheDocument();
    expect(screen.getByText("17841400000000001")).toBeInTheDocument();
    expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
  });
});
