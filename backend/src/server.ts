import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initSchema, requeueStaleDownloads } from "./db/init.js";
import { db } from "./db/index.js";
import { settings } from "./db/schema.js";
import { startWorker } from "./services/worker.js";
import { startVersionCheck } from "./services/version-check.js";
import * as DownloadQueue from "./services/download-queue.js";
import { eq } from "drizzle-orm";

import { healthRoutes } from "./routes/http/public.js";
import { versionRoutes } from "./routes/http/version.js";
import { settingsRoutes } from "./routes/http/settings.js";
import { uiConfigRoutes } from "./routes/http/ui-config.js";
import { channelsRoutes } from "./routes/http/channels.js";
import { actionsRoutes } from "./routes/http/actions.js";
import { ytdlpRoutes } from "./routes/http/ytdlp.js";
import { downloadsRoutes } from "./routes/http/downloads.js";
import { foldersRoutes } from "./routes/http/folders.js";
import { initWebsockets } from "./routes/ws/websockets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const IMAGES_DIR = path.join(DATA_DIR, "images");
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? "/downloads";

// These live on mounted volumes, so anything created at image build time is
// hidden once a host path is mounted over it. Create them at boot instead —
// @fastify/static refuses to serve a root that does not exist yet.
for (const dir of [IMAGES_DIR, DOWNLOADS_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn(`Could not create ${dir}:`, e);
  }
}
const WEB_ROOT = path.resolve(
  process.env.WEB_ROOT ?? path.join(__dirname, "../public")
);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(healthRoutes);
await app.register(versionRoutes);
await app.register(settingsRoutes);
await app.register(uiConfigRoutes);
await app.register(channelsRoutes);
await app.register(actionsRoutes);
await app.register(ytdlpRoutes);
await app.register(downloadsRoutes);
await app.register(foldersRoutes);

initSchema();
requeueStaleDownloads();

// ensure default settings
const existing = await db
  .select()
  .from(settings)
  .where(eq(settings.id, 1));

if (!existing.length) {
  await db.insert(settings).values({
    id: 1,
    enabled: true
  });
}

await app.register(staticPlugin, {
  root: WEB_ROOT,
  prefix: "/",
  wildcard: false,
  preCompressed: true,
  maxAge: "1y",
  immutable: true
});

await app.register(staticPlugin, {
  root: path.resolve(IMAGES_DIR),
  prefix: "/images/",
  decorateReply: false,
});

app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith("/api")) {
    return reply.code(404).send({ error: "Not found" });
  }

  if (req.raw.url?.includes(".")) {
    return reply.code(404).send();
  }

  return reply.sendFile("index.html");
});

startWorker();
startVersionCheck();
DownloadQueue.resume();

process.on('SIGTERM', async () => {
  await app.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await app.close();
  process.exit(0);
});

initWebsockets(app.server);

await app.listen({ port: PORT, host: HOST }, err => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server is running on port ${PORT}`);
})
