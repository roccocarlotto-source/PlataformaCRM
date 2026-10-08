import { describe, expect, it } from "vitest";
import { avisoDeAccionesSinGuardarElNombre } from "./tools";

// Decisión de Rocco (08/10/2026): crear una oportunidad o reservar exige el
// nombre y el apellido del cliente, y el agente solo los puede guardar con
// create_lead o update_lead. Un agente con lo primero y sin lo segundo nunca
// va a poder actuar: la pantalla lo avisa.

describe("avisoDeAccionesSinGuardarElNombre", () => {
  it("avisa cuando hay una acción que exige el nombre y ninguna que lo guarde", () => {
    const aviso = avisoDeAccionesSinGuardarElNombre(["create_opportunity", "search_vehicles"]);
    expect(aviso).toMatch(/«Crear oportunidad» exige el nombre del cliente/);
    expect(aviso).toMatch(/«Actualizar la calificación» o «Calificar el lead»/);
    expect(aviso).toMatch(/para que pueda guardarlo/);
  });

  it("nombra todas las acciones que lo exigen, en el orden del catálogo", () => {
    expect(avisoDeAccionesSinGuardarElNombre(["reserve_vehicle", "create_booking"])).toMatch(
      /«Reservar turno», «Reservar unidad» exigen/,
    );
  });

  it("no avisa sin acciones que lo exijan, ni cuando create_lead o update_lead están habilitadas", () => {
    expect(avisoDeAccionesSinGuardarElNombre([])).toBeNull();
    expect(avisoDeAccionesSinGuardarElNombre(["search_vehicles", "get_contact_info"])).toBeNull();
    expect(avisoDeAccionesSinGuardarElNombre(["create_opportunity", "update_lead"])).toBeNull();
    expect(avisoDeAccionesSinGuardarElNombre(["create_booking", "create_lead"])).toBeNull();
  });
});
