import { FastifyInstance } from "fastify";
import {
  checkNow,
  getVersionInfo,
  isVersionCheckEnabled
} from "../../services/version-check.js";

export async function versionRoutes(app: FastifyInstance) {
  // Served straight from the cached manifest - the once-a-day job in
  // services/version-check.ts is the only thing that leaves the machine, so
  // clients may poll this as often as they like.
  app.get("/api/version", async () => await getVersionInfo());

  // The user's "Check for updates" button: goes to the network now (behind a
  // short cooldown) and answers in the same shape as GET /api/version.
  app.post("/api/version/check", async (_req, reply) => {
    if (!isVersionCheckEnabled()) {
      return reply
        .code(409)
        .send({ error: "Version check is disabled (VERSION_CHECK_ENABLED)" });
    }

    return await checkNow();
  });
}
