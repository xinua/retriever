import { FastifyInstance } from "fastify";
import { previewCleanup, runCleanup } from "../../services/image-cleanup.js";

export async function imagesRoutes(app: FastifyInstance) {
  // How many unused avatars and posters a cleanup would remove; removes nothing.
  app.get("/api/images/cleanup", async () => await previewCleanup());

  // Removes them, answering with what was actually removed.
  app.post("/api/images/cleanup", async () => await runCleanup());
}
