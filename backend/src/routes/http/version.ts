import { FastifyInstance } from "fastify";
import { getVersionInfo } from "../../services/version-check.js";

export async function versionRoutes(app: FastifyInstance) {
  // Served straight from the cached manifest - the once-a-day job in
  // services/version-check.ts is the only thing that leaves the machine, so
  // clients may poll this as often as they like.
  app.get("/api/version", async () => await getVersionInfo());
}
