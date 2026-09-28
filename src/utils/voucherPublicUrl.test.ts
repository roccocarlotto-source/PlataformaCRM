import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVoucherPublicUrl } from "./voucherPublicUrl";

const ID = "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";

test("con base: `${base}/v/:id`, el path que el Worker reenvía a /vouchers/resolve/:id", () => {
  assert.equal(buildVoucherPublicUrl(ID, "https://nexoraqrs.com"), `https://nexoraqrs.com/v/${ID}`);
});

test("sin base: el id pelado — la pantalla de escaneo lo canjea igual", () => {
  assert.equal(buildVoucherPublicUrl(ID, undefined), ID);
});
