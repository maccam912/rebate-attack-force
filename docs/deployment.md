# Running and deploying Rebate Attack Force

The production image serves the built client, Colyseus matchmaking, and WebSockets on one port (`2567`, configurable with `PORT`). A normal HTTPS ingress with WebSocket support is enough. There is no account service, database, or external game service to configure.

## Local development

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Create a room and share its invite URL with another browser. The development server proxies `/rooms` (HTTP and WebSocket) to port 2567, removing that prefix. Production uses the page's own origin with no prefix, so deployments need no baked-in hostnames. An optional build-time `VITE_ROOM_SERVER` can point at a separately hosted Colyseus endpoint.

Anonymous names are limited to 20 characters. Each room supports 2–4 players, has a host who starts/restarts matches, and is private to people with its generated room ID. A link is an invitation, not an authentication credential. Joining locks when a match starts. Leaving forfeits the player; host status moves to the next guest. Brief network drops have a 15-second reconnection window while the tab remains open. Page reloads create a new session rather than restoring a match seat.

## Container

```sh
docker build -t rebate-attack-force:0.1.0 .
docker run --rm -p 2567:2567 rebate-attack-force:0.1.0
```

Open `http://localhost:2567`. The image runs as a non-root user and includes only production dependencies and built client files plus the TypeScript server/shared engine. `tsx` is a production dependency. The process handles `SIGTERM`/`SIGINT`, marks readiness unavailable, and closes rooms and sockets through Colyseus' graceful shutdown API.

## GitHub Actions and OCI GitOps

`.github/workflows/image.yml` tests and builds pull requests. Pushes to `main`
(and manual runs on `main`) publish `ghcr.io/maccam912/rebate-attack-force:latest`
and `sha-<full-commit>` tags for Linux AMD64 and ARM64 using `GITHUB_TOKEN`.
The existing Dockerfile packages both the browser client and Colyseus server.

The `fleet-infra` repository enables this app under `clusters/oci-koski/apps`
at **https://rebate-attack-force.oci.koski.co**. Its Flux image policy tracks the
`latest` digest and commits image updates to `fleet-infra/main`, triggering a
single-replica `Recreate` rollout. Each rollout ends active matches.

After the first publish, ensure the GHCR package is public so the cluster and
Flux image reflector can pull anonymously. Private packages require registry
credentials for both. Flux's existing Git credentials must allow image-update
commits. DNS for the hostname must resolve to the OCI ingress; cert-manager uses
the existing `letsencrypt` ClusterIssuer for TLS. Both repositories' changes
must reach `main` before this pipeline takes effect.

## Kubernetes

Build and push the image to your registry, then set its name/tag in `deploy/base/kustomization.yaml`. For example, use `newName: registry.example.com/games/rebate-attack-force` under the existing image entry. Create registry credentials in your cluster if needed.

```sh
kubectl apply -k deploy/base
kubectl rollout status deployment/rebate-attack-force
kubectl port-forward service/rebate-attack-force 8080:80
```

Open `http://localhost:8080` for a deployment check. For public play, copy `deploy/ingress.example.yaml`, set a real hostname, ingress class, and TLS secret, and apply that file. The sample annotations are for ingress-nginx; configure equivalent WebSocket upgrade support and idle timeouts on other controllers. Keep the game at the domain root. The same origin carries static files, `/matchmake/*`, and `/{processId}/{roomId}` sockets. `/healthz` checks process liveness; `/readyz` checks whether the server is accepting work.

The Deployment deliberately uses **one replica and `Recreate` updates**. All room state is in memory. Deployments, crashes, and rescheduling end existing matches; invite links to those rooms expire. There is a short deployment outage. A rolling update with overlapping uncoordinated pods would send matchmaking and sockets to different room stores, so adding replicas or a horizontal autoscaler is not supported by this configuration.

## Growing beyond one replica

Before scaling, add shared Colyseus presence and a shared matchmaking driver (usually Redis), plus routing that sends each WebSocket to the process that owns its room. A generic Kubernetes Service or sticky session by itself does not solve room ownership across different players. Give each process a reachable public address or configure Colyseus-aware process routing, then add room draining during rollouts. Redis coordination does not persist simulation state or make active matches survive a pod loss; that requires explicit match snapshots and recovery.

The server receives bounded input/command messages, validates numeric values, rate-limits each connection, and is authoritative over movement, crates, damage and turns. Internet-scale deployments should add ingress connection/HTTP request limits and size resources from measured room load. No production deployment or load test is implied by the included manifests.

References: [Colyseus room visibility](https://docs.colyseus.io/matchmaker/visibility), [reconnection](https://docs.colyseus.io/room/reconnection), [server configuration and public addresses](https://docs.colyseus.io/server), [graceful shutdown](https://docs.colyseus.io/server/graceful-shutdown).
