import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { checkDownloaderStatus } from "./downloader-status.js";

export interface WsMessage<T = unknown> {
  type: string;
  data: T;
}

let io: SocketIOServer | null = null;

export function broadcast(type: string, data: unknown) {
  if (!io) return;

  io.emit("message", { type, data } satisfies WsMessage);
}

export function initWebsockets(server: HttpServer) {
  if (io) return io;

  io = new SocketIOServer(server, {
    path: "/ws",
    cors: { origin: true },
  });

  io.on("connection", (socket) => {
    // A fresh tab gets the status once, straight to itself; every later
    // change is broadcast by the route that caused it.
    void checkDownloaderStatus()
      .then((status) => {
        if (socket.connected) {
          socket.emit("message", {
            type: "downloader-status",
            data: status
          } satisfies WsMessage);
        }
      })
      .catch((e) => console.warn("downloader-status: initial check failed:", e));
  });

  return io;
}
