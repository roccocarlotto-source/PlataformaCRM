import { Router } from "express";
import { listEnviosQueNoSalieronHandler } from "../controllers/enviosQueNoSalieron.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

export const enviosQueNoSalieronRouter = Router();

// ADMIN ve todo; RECEPCION de clínica, solo sus sedes (el service aplica
// filtroDeSedes). USER no: es la lista que acompaña a una tarea que nunca
// se le asigna a un USER.
enviosQueNoSalieronRouter.get(
  "/envios-que-no-salieron",
  authenticate,
  authorize("ADMIN", "RECEPCION"),
  listEnviosQueNoSalieronHandler,
);
