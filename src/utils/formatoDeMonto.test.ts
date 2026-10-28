import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { formatearMonto } from "./formatoDeMonto";

// El formato de montos del backend: el mismo que formatMoney del frontend
// (UX-09). La parte que importa probar es la que se ve: miles, centavos que
// no se redondean, signo y moneda atrás.

test("miles con punto y la moneda atrás", () => {
  assert.equal(formatearMonto("23000.00", "USD"), "23.000 USD");
  assert.equal(formatearMonto("1234567", "UYU"), "1.234.567 UYU");
  assert.equal(formatearMonto(0, "USD"), "0 USD");
});

test("un monto con centavos los muestra con coma y no los redondea", () => {
  assert.equal(formatearMonto("5200.50", "UYU"), "5.200,50 UYU");
  assert.equal(formatearMonto("5200.5", "UYU"), "5.200,50 UYU");
  assert.equal(formatearMonto("0.99", "USD"), "0,99 USD");
  assert.equal(formatearMonto("1999.01", "USD"), "1.999,01 USD");
});

test("un Decimal de Prisma, como lo devuelve la base", () => {
  assert.equal(formatearMonto(new Prisma.Decimal("23000.00"), "USD"), "23.000 USD");
  assert.equal(formatearMonto(new Prisma.Decimal("5200.5"), "UYU"), "5.200,50 UYU");
});

test("un negativo lleva el signo menos tipográfico", () => {
  assert.equal(formatearMonto("-500.00", "USD"), "−500 USD");
});

test("sin moneda, solo el número", () => {
  assert.equal(formatearMonto("5200.5", ""), "5.200,50");
});
