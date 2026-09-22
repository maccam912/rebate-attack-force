import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { AttackRoom } from "./AttackRoom";
import { serverMaxTeams } from "./capacity";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

export function createGameServer() {
  const maxTeams = serverMaxTeams(process.env.MAX_TEAMS);
  class ConfiguredAttackRoom extends AttackRoom {
    protected override readonly maxTeams = maxTeams;
  }
  let ready = true;
  const gameServer = new Server({
    greet: false,
    gracefullyShutdown: false,
    transport: new WebSocketTransport({
      maxPayload: 4096,
      pingInterval: 5000,
      pingMaxRetries: 2,
    }),
    express: (app) => {
      app.disable("x-powered-by");
      app.get("/healthz", (_req, res) =>
        res.status(200).json({ status: "ok" }),
      );
      app.get("/readyz", (_req, res) =>
        res
          .status(ready ? 200 : 503)
          .json({ status: ready ? "ready" : "draining" }),
      );
      app.use(express.static(dist, { index: false, maxAge: "1h" }));
      app.get("/", (_req, res) => {
        if (existsSync(resolve(dist, "index.html")))
          res.sendFile(resolve(dist, "index.html"));
        else
          res
            .status(200)
            .send(
              "Rebate Attack Force room server is running. Open the Vite client on port 5173.",
            );
      });
    },
  });
  gameServer.define("attack", ConfiguredAttackRoom);
  let shutdown: Promise<void> | null = null;
  return {
    gameServer,
    async listen(port = 2567, host = "0.0.0.0") {
      await gameServer.listen(port, host);
      const address = gameServer.transport.server?.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async shutdown() {
      ready = false;
      // Idempotent for overlapping process signals and test cleanup.
      shutdown ??= gameServer.gracefullyShutdown(false);
      await shutdown;
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  const server = createGameServer();
  await server.listen(port);
  console.log(`Rebate Attack Force is listening on http://0.0.0.0:${port}`);
  const stop = () => {
    const forceExit = setTimeout(() => process.exit(1), 25_000);
    forceExit.unref();
    void server.shutdown().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
