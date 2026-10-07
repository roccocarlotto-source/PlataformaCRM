import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import { esHostDeGoogle, parsearLinkDeSheets, urlDeExportacion } from "./importacionSheets";

// docs/importacion-de-datos.md §4.2 y decisión 3.

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab";

test("parsearLinkDeSheets: saca el id y la pestaña del link de edición, de vista o con gid en la query", () => {
  assert.deepEqual(
    parsearLinkDeSheets(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=12345`),
    {
      sheetId: ID,
      gid: "12345",
    },
  );
  assert.deepEqual(
    parsearLinkDeSheets(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`),
    {
      sheetId: ID,
      gid: "0",
    },
  );
  assert.deepEqual(
    parsearLinkDeSheets(`  https://docs.google.com/spreadsheets/d/${ID}/view?gid=7  `),
    {
      sheetId: ID,
      gid: "7",
    },
  );
});

test("parsearLinkDeSheets: cualquier otro host, esquema o forma se rechaza", () => {
  for (const link of [
    `http://docs.google.com/spreadsheets/d/${ID}/edit`,
    `https://docs.google.com.example.com/spreadsheets/d/${ID}/edit`,
    `https://drive.google.com/file/d/${ID}/view`,
    `https://docs.google.com/document/d/${ID}/edit`,
    "https://docs.google.com/spreadsheets/d/corto/edit",
    "https://example.com/planilla.csv",
    "no es un link",
  ]) {
    assert.throws(() => parsearLinkDeSheets(link), AppError, link);
  }
});

test("urlDeExportacion: la arma el backend, siempre en docs.google.com y como CSV", () => {
  assert.equal(
    urlDeExportacion({ sheetId: ID, gid: "5" }),
    `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=5`,
  );
});

test("esHostDeGoogle: solo docs.google.com y los subdominios de googleusercontent.com", () => {
  assert.equal(esHostDeGoogle("docs.google.com"), true);
  assert.equal(esHostDeGoogle("doc-0s-1c-sheets.googleusercontent.com"), true);
  assert.equal(esHostDeGoogle("googleusercontent.com.example.com"), false);
  assert.equal(esHostDeGoogle("evilgoogleusercontent.com"), false);
  assert.equal(esHostDeGoogle("example.com"), false);
});
