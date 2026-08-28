# Kafsheesh

A self-hosted Kafka operations console with **first-class jump-host tunneling**.

```
browser  →  Angular UI  →  NestJS API  →  SSH bastion (server2)  →  Kafka (server1)
```

Kafbat and similar UIs assume your laptop or container can open a TCP connection to every advertised broker. That falls apart the moment Kafka lives on an internal host and you can only SSH to a bastion. Kafsheesh is built for that path: the API opens local port forwards through SSH, then remaps advertised listeners so KafkaJS never dials an unreachable internal hostname.

**Self-hosted only.** Run Kafsheesh on a machine you control. SSH keys, Kafka credentials, and topic data stay in your environment. This is not a cloud or multi-tenant service.

---

## Table of contents

1. [License (GNU GPL v3)](#license-gnu-gpl-v3)
2. [What Kafsheesh does](#what-kafsheesh-does)
3. [Why it is not just another Kafbat](#why-it-is-not-just-another-kafbat)
4. [How tunneling works](#how-tunneling-works)
5. [Repository layout](#repository-layout)
6. [Prerequisites](#prerequisites)
7. [Quick start](#quick-start)
8. [Connecting a real cluster](#connecting-a-real-cluster)
9. [Using the UI](#using-the-ui)
10. [Activity log](#activity-log)
11. [Environment variables](#environment-variables)
12. [Data, secrets, and encryption](#data-secrets-and-encryption)
13. [HTTP API](#http-api)
14. [Development](#development)
15. [Production notes](#production-notes)
16. [Security](#security)
17. [Limitations](#limitations)
18. [Third-party software](#third-party-software)
19. [Contributing](#contributing)
20. [Conveying copies and modifications](#conveying-copies-and-modifications)
21. [Warranty and liability](#warranty-and-liability)

---

## License (GNU GPL v3)

Copyright (C) 2026 Francis Tejano

Kafsheesh is **free software**: you can redistribute it and/or modify it under the terms of the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.html) as published by the Free Software Foundation, either **version 3** of the License, or (at your option) **any later version**.

This program is distributed in the hope that it will be useful, but **WITHOUT ANY WARRANTY**; without even the implied warranty of **MERCHANTABILITY** or **FITNESS FOR A PARTICULAR PURPOSE**. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program, in the file [`LICENSE`](./LICENSE). If not, see <https://www.gnu.org/licenses/>.

| Item | Value |
| --- | --- |
| SPDX identifier | `GPL-3.0-or-later` |
| License text | [`LICENSE`](./LICENSE) (verbatim GNU GPL v3; do not edit that file) |
| Corresponding Source | this repository (TypeScript sources, build scripts, `docker-compose.yml`, and this documentation) |
| Copyright years | 2026–present |
| Author | Francis Tejano |
| Interactive notice | printed when the API starts; also shown in the UI footer |

### What GPL-3 requires of you

If you **run** Kafsheesh only for yourself, you have no extra obligations.

If you **convey** Kafsheesh (give someone a copy, host a download, ship a container image, or distribute a modified build):

1. Keep the copyright notices and this license with the work.
2. Provide the **complete Corresponding Source** of what you convey, under GPL-3 (or later), in one of the ways section 6 of the license allows (accompany the binaries, a written offer valid for at least three years, or equivalent network access).
3. Mark modified versions as changed, and date the changes.
4. License the whole combined work under GPL-3. You may not incorporate Kafsheesh into a proprietary product.
5. Do not add further restrictions (no extra NDAs that take away GPL rights, no “source available except…”).
6. Preserve any installation information needed to run a modified version on a User Product if you convey object code in that situation (GPL-3 §6).

The GNU GPL does **not** require you to publish private modifications that you never convey. It does require you to pass on the same freedoms when you do convey the software.

A short notice suitable for source files:

```
Copyright (C) 2026 Francis Tejano

This file is part of Kafsheesh.

Kafsheesh is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Kafsheesh is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Kafsheesh.  If not, see <https://www.gnu.org/licenses/>.
```

---

## What Kafsheesh does

Kafsheesh is an operations console for Apache Kafka clusters you already run:

- Register **direct** clusters (brokers reachable from the API host).
- Register **tunneled** clusters (SSH to a bastion that can reach Kafka, with optional extra ProxyJump hops).
- Authenticate to the bastion with a **password** or a **private key** (OpenSSH/PEM or PuTTY PPK, including encrypted keys).
- Connect, disconnect, and run **diagnostics** (SSH, forwards, Kafka metadata, advertised-listener remapping).
- Inspect **overview**, **topics**, **consumer groups**, **brokers**, and optional **Schema Registry**.
- **Browse** and **produce** messages; save search filters.
- **Reset** group offsets (earliest / latest) and delete idle groups.
- Watch a live **activity** feed of HTTP, SSH, and Kafka steps.
- Keep a local **audit** log of mutating actions.

It does **not** replace Kafka itself, a schema registry, or your identity provider. It is an operator tool that sits next to clusters you already have.

---

## Why it is not just another Kafbat

| Capability | Kafsheesh |
| --- | --- |
| SSH / multi-hop tunnels | First-class cluster setting, not a sidecar you invent yourself |
| Key files | OpenSSH/PEM (`.pem`, `id_rsa`) and PuTTY PPK (`.ppk`), with passphrase |
| Advertised listeners | Remapped through dynamic `forwardOut` so `kafka.internal:9092` still works |
| Diagnostics | SSH, forwards, metadata, and remapping tested independently |
| Message filters | Regex / text and JSON path — no Groovy or script execution |
| Saved searches | Per cluster, stored with the API |
| Audit | Mutating actions (create/delete topic, produce, reset offsets, schemas) |
| Activity | Live SSE dock with local-time stamps |
| Secrets at rest | AES-256-GCM when `KAFSHEESH_MASTER_KEY` is set |
| License | GNU GPL v3 or later (you receive source and the right to change it) |

Topic and group **list** endpoints return **metadata only** (names, partitions, members). They do not run a full consumer-lag scan on first paint — that N+1 `fetchOffsets` / `fetchTopicOffsets` pattern is too slow through a tunnel. Lag on the topic-detail card is a placeholder until a non-blocking follow-up exists.

---

## How tunneling works

### The problem

A Kafka client bootstraps from one or more `host:port` pairs, then **reconnects to every advertised listener** returned in metadata. Those advertised hosts are often internal DNS names (`kf-app-002.prod.internal:9092`) that your laptop cannot resolve or route to.

A naive SSH local forward (`ssh -L 19092:kafka:9092`) only covers the bootstrap. The client still tries to open `kf.prod.internal:9092` and hangs.

### What Kafsheesh does

1. The API opens an SSH session to the bastion (`ssh2`). Extra hops, if configured, are chained first (ProxyJump style: hop[0] → … → bastion).
2. For each remote broker the client needs, the API listens on `127.0.0.1:<ephemeral>` and `forwardOut`s that socket to `remoteHost:remotePort` on the far side of the SSH session.
3. KafkaJS is constructed with a custom **`socketFactory`**. When the client would dial an advertised host, Kafsheesh opens (or reuses) a forward and connects to the local port instead.
4. New advertised hosts discovered after `admin.connect()` get forwards on demand. You do not have to list every broker up front, but you should give bootstrap addresses **as the bastion sees them**.

```
  Browser (:4200)
       |  HTTP /api
       v
  Kafsheesh API (:4000)
       |  KafkaJS socketFactory -> 127.0.0.1:<ephemeral>
       |  SSH (optional hops, then bastion)
       v
  Bastion (server2)
       |  TCP
       v
  Kafka brokers (server1, advertised names remapped)
```

### Important operational notes

- Many production bastions allow **port forwarding only**. Kafsheesh does **not** run a remote command (`exec`) to “probe” the hop — that can hang forever on hosts that deny shells.
- Brokers in the wizard must be **reachable from the bastion**, not from your laptop.
- TLS and SASL, if used, are negotiated **to Kafka** through the tunnel. The SSH hop is a separate authentication.
- Do not commit private keys. Keys are stored with the cluster record (encrypted if a master key is set).

---

## Repository layout

pnpm workspaces. Three packages:

| Path | Package | Stack | Role |
| --- | --- | --- | --- |
| `apps/web` | `@kafsheesh/web` | Angular **21 LTS** (zoneless, `@angular/build`) | Operator UI |
| `apps/api` | `@kafsheesh/api` | NestJS **11**, KafkaJS, ssh2, sshpk | Tunnels, Kafka, persistence |
| `packages/shared` | `@kafsheesh/shared` | TypeScript types | Contracts used by both apps |

```
kafsheesh/
├── LICENSE                 Full GNU GPL v3 text (do not edit)
├── README.md               This file
├── package.json            Workspace scripts; license GPL-3.0-or-later
├── pnpm-workspace.yaml
├── docker-compose.yml      Packaged UI + API + Kafka + Postgres
├── Dockerfile              Multi-stage api / web images
├── .env.example
├── apps/api/               NestJS API (prefix /api, default port 4000)
│   └── src/
│       ├── activity/       In-memory event bus + SSE
│       ├── audit/          Mutating-action log
│       ├── clusters/       CRUD, connect, diagnose
│       ├── kafka/          Admin, browse, produce, groups, schemas
│       ├── store/          JSON files or Postgres (DATABASE_URL)
│       ├── tunnel/         SSH sessions, forwards, PEM/PPK
│       └── common/         AES-256-GCM seal/open, HTTP errors
├── apps/web/               Angular UI (dev server :4200, proxies /api → :4000)
└── packages/shared/        Cluster, Kafka, activity, audit types
```

After you change shared types, rebuild `@kafsheesh/shared` (`pnpm build:shared` or `pnpm predev`). Nest watch can miss new exports until that build runs.

---

## Prerequisites

- **Node.js 20+** (see `engines` in the root `package.json`)
- **[pnpm](https://pnpm.io/)** 9.15+ (the repo pins `packageManager`)
- **Docker** and Docker Compose, to run the packaged stack
- For tunnel mode: network path from the **API host** to the bastion (port 22 or your SSH port), and from the bastion to Kafka

The UI talks only to the API. The browser never opens SSH or Kafka sockets.

---

## Quick start

Packaged stack (UI, API, and a local Kafka broker):

```bash
git clone <this-repo>
cd kafsheesh
docker compose up --build -d
```

No `.env` is required. Compose and the API image load [`.env.example`](./.env.example) when `.env` is missing. Copy it to `.env` only when you want to override values (set a real `KAFSHEESH_MASTER_KEY` before production use).

| Surface | URL |
| --- | --- |
| UI | http://localhost:4444 |
| API (via nginx) | http://localhost:4444/api |
| API health | http://localhost:4444/api/health |

Change the published UI port with `KAFSHEESH_WEB_PORT` (default `4444`).

Add a cluster in **Direct** mode with brokers `localhost:9092` or `kafka:9092`. The packaged API remaps host loopback to the Compose service `kafka`. Host clients outside Compose still use `localhost:9092`.

Local development without Docker:

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds shared types, then starts the API (`:4000`) and the Angular dev server (`:4200`). The dev server proxies `/api` to `http://localhost:4000` (`apps/web/proxy.conf.json`).

| Surface | URL |
| --- | --- |
| UI | http://localhost:4200 |
| API health | http://localhost:4000/api/health |
| Activity stream | http://localhost:4000/api/activity/stream (SSE) |

---

## Connecting a real cluster

Typical corporate path: laptop → bastion → Kafka advertised as internal DNS.

1. **Add cluster** → name it (for example `DEV`).
2. Choose **Tunnel**.
3. Bastion: hostname or IP, SSH port (usually `22`), username.
4. Auth: **Private key**. Upload a `.pem` / OpenSSH key or a PuTTY `.ppk`. Enter the passphrase if the file is encrypted.
5. Leave **ProxyJump** hidden unless you truly have a second hop. If you do, use `host:port` plus that hop’s credentials.
6. Brokers: the bootstrap list **the bastion can resolve** (not `localhost`).
7. Enable TLS / SASL only if Kafka requires them.
8. Optional Schema Registry URL if the API host (or the same path you intend to use) can reach it. Registry traffic is not automatically tunneled today.
9. Save, **Run tests**, then **Connect**. Watch the activity dock for SSH and Kafka steps.

If connect succeeds but overview hangs, wait: metadata through a tunnel can take several seconds. List endpoints are metadata-only so they should return; browsing messages is a separate, slower step — load it only when you need it.

---

## Using the UI

### Clusters (`/clusters`)

Cards show status, brokers, tunnel vs direct, TLS, and SASL. **Connect** is the primary action when disconnected; **Open** is primary when connected. Edit and delete are secondary.

### Cluster wizard (`/clusters/new`, `/clusters/:id/edit`)

Steps: **Identity → Path → Kafka → Review**. Direct mode skips Path. Steps are clickable. Extra ProxyJump fields stay collapsed until you add a hop.

Key upload accepts `.pem`, `.ppk`, `.key`, and common `id_*` names. The API converts PPK to OpenSSH/PKCS1 in memory via `sshpk` (not by shelling out).

### Cluster shell (`/c/:id/...`)

Sidebar: switch cluster without returning to the list, Connect when disconnected, nav for Overview, Topics, Groups, Brokers, Schemas, Audit.

| Route | Purpose |
| --- | --- |
| `/c/:id/overview` | Broker count, topic count, under-replicated partitions, group count, path/tunnel |
| `/c/:id/topics` | Filterable topic table (click a row) |
| `/c/:id/topics/:name` | Stats, **on-demand** message browse, produce, saved searches |
| `/c/:id/groups` | Members, reset offsets (confirm), delete group |
| `/c/:id/brokers` | Advertised host:port and controller |
| `/c/:id/schemas` | Register / list subjects (needs Schema Registry URL) |
| `/c/:id/audit` | Mutating actions, timestamps in the browser’s local zone |

### Times

Activity, audit, and message timestamps are shown in **the operator’s machine timezone**. The API still stores ISO-8601 UTC.

---

## Activity log

Fixed dock at the bottom of every page.

- **Live** via `EventSource` on `/api/activity/stream`.
- Stamps use local `HH:mm:ss`.
- **Hide** is remembered for the session (`sessionStorage`).
- **Escape** collapses the dock (not while a field is focused).
- Auto-scroll follows only if you are already at the bottom. Otherwise **Jump to latest** appears.
- Filter **All** / **Issues**.
- Collapsed bar shows the last line plus new/issue counts.
- On desktop, the dock starts after the sidebar so navigation stays clickable.

The feed records HTTP requests (except `/api/activity` and `/health`), SSH session steps, and Kafka admin/browse milestones. It is in-memory on the API process — restarting the API clears it.

---

## Environment variables

Copy `.env.example` to `.env` to override defaults, or export the same names in the process environment. `docker compose up` and `docker run` of the API image apply `.env.example` when `.env` is not present. The API container still forces `KAFSHEESH_DATA_DIR=/data`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port for the NestJS API |
| `KAFSHEESH_DATA_DIR` | `./apps/api/data` when started from that package, else `./data` | JSON fallback directory; also the source for a one-time import into Postgres |
| `KAFSHEESH_MASTER_KEY` | unset | If set, SHA-256 of this string is the AES-256-GCM key for SSH/SASL/registry secrets |
| `KAFSHEESH_TLS_REJECT_UNAUTHORIZED` | `true` | Set `false` only in development if Kafka uses a private CA you have not installed |
| `KAFSHEESH_WEB_PORT` | `4444` | Host port for the Compose UI (nginx) |
| `KAFSHEESH_COMPOSE_KAFKA_HOST` | unset | If set (Compose uses `kafka`), rewrite `localhost` / `127.0.0.1` brokers to that hostname |
| `KAFSHEESH_DISABLE_DESTRUCTIVE` | `false` in a bare API process; `true` in `.env.example` (used by Compose / `docker run` when `.env` is absent) | Set `true` / `1` / `yes` / `on` to block create/delete topic, produce, offset reset, delete group, schema register/delete, and delete cluster. Browse, connect, and cluster edit stay available. The API enforces this; the UI hides those actions. |
| `CORS_ORIGIN` | empty | Extra comma-separated browser origins allowed by the API |
| `DATABASE_URL` | unset | When set, clusters, searches, audit, and DNS cache live in Postgres. Compose sets this to the bundled `postgres` service. |
| `POSTGRES_PASSWORD` | `kafsheesh` | Password for the Compose Postgres user |

Compose serves the UI and `/api` from the same origin, so CORS is unused in that mode. For `pnpm dev`, the allow-list includes localhost `:4200` and `:4444`.

---

## Data, secrets, and encryption

The API is the system of record.

**Postgres (Compose default).** When `DATABASE_URL` is set, records live in four tables: `clusters` (full config as JSONB, secrets still `enc:v1:`), `saved_searches`, `audit_events`, and `kv_documents` (DNS cache). Schema is created on API boot. If Postgres is empty and JSON files exist under `KAFSHEESH_DATA_DIR`, they are imported once. The Compose database is not published on the host; the API reaches it as `postgres:5432` on the Docker network.

**JSON fallback.** When `DATABASE_URL` is unset (`pnpm dev`), `JsonStoreService` writes `clusters.json`, `searches.json`, `audit.json`, and `dns-cache.json` under `KAFSHEESH_DATA_DIR`.

When `KAFSHEESH_MASTER_KEY` is set, passwords, private keys, and passphrases are sealed as `enc:v1:<iv>.<tag>.<ciphertext>` (AES-256-GCM). The UI receives redacted `••••` placeholders on read; submitting `••••` on edit keeps the stored secret.

If you store encrypted secrets and later start the API **without** the same master key, open will fail. Back up the key with the same care as the data directory.

Without a master key, secrets are stored in plaintext JSON. That is acceptable only on a locked-down workstation.

**This is not multi-tenant.** Anyone who can reach the API can call cluster and Kafka endpoints. Put it on localhost, a VPN, or behind your own SSO reverse proxy.

---

## HTTP API

Global prefix: `/api`. JSON bodies. Validation via `class-validator` (whitelist + transform).

### Health and activity

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/activity` | Recent activity events |
| `GET` | `/api/activity/stream` | Server-Sent Events of the same feed |
| `GET` | `/api/audit` | All audit events |

### Clusters

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/clusters` | Summaries (secrets redacted) |
| `GET` | `/api/clusters/:id` | One cluster |
| `POST` | `/api/clusters` | Create (direct or tunnel) |
| `PUT` | `/api/clusters/:id` | Update |
| `DELETE` | `/api/clusters/:id` | Delete saved connection (not Kafka data) |
| `POST` | `/api/clusters/:id/connect` | Open tunnel (if any) and Kafka admin session |
| `POST` | `/api/clusters/:id/disconnect` | Tear down sessions |
| `POST` | `/api/clusters/:id/diagnose` | SSH → forward → metadata; does not leave a warm session |

### Cluster resources

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/clusters/:id/overview` | Brokers, topic count, URPs, group count, tunnel runtime |
| `GET` | `/api/clusters/:id/brokers` | Advertised brokers |
| `GET` | `/api/clusters/:id/topics` | Topic metadata (no full lag scan) |
| `GET` | `/api/clusters/:id/topics/:name` | Topic detail |
| `POST` | `/api/clusters/:id/topics` | Create topic `{ name, partitions, replicationFactor }` |
| `DELETE` | `/api/clusters/:id/topics/:name` | Delete topic |
| `GET` | `/api/clusters/:id/topics/:name/messages` | Browse: `limit`, `direction` (`latest` \| `earliest` \| `offset`), `q`, `jsonPath`, `partition`, `offset` |
| `POST` | `/api/clusters/:id/messages` | Produce `{ topic, key?, value, partition? }` |
| `GET` | `/api/clusters/:id/groups` | Groups and members |
| `POST` | `/api/clusters/:id/groups/reset` | Reset offsets `{ groupId, topic, strategy }` |
| `DELETE` | `/api/clusters/:id/groups/:groupId` | Delete group |
| `GET` | `/api/clusters/:id/schemas` | Schema Registry subjects |
| `POST` | `/api/clusters/:id/schemas` | Register `{ subject, schema, schemaType? }` |
| `DELETE` | `/api/clusters/:id/schemas/:subject` | Delete subject |
| `GET` | `/api/clusters/:id/searches` | Saved searches |
| `POST` | `/api/clusters/:id/searches` | Save search |
| `DELETE` | `/api/clusters/:id/searches/:searchId` | Delete search |
| `GET` | `/api/clusters/:id/audit` | Audit for one cluster |

Shared TypeScript types live in `packages/shared` (`ClusterSummary`, `CreateClusterInput`, `ActivityEvent`, and so on). Treat those as the schema.

---

## Development

```bash
pnpm install
pnpm build:shared    # required after shared type changes
pnpm dev             # API + web
pnpm lint
```

| Script | What it runs |
| --- | --- |
| `pnpm dev` | `predev` (shared build) then API + web `start:dev` |
| `pnpm dev:api` | Nest watch |
| `pnpm dev:web` | `ng serve` with proxy |
| `pnpm build` | shared → api → web |
| `pnpm test` | API unit tests |
| `pnpm sanity` | same checks as GitHub Actions: lint + build + API tests |
| `pnpm lint` | ESLint on the API (shared and web report TypeScript via build) |

GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`, `pnpm lint` (which builds `@kafsheesh/shared` first so type-aware ESLint can resolve those types), `pnpm build`, and `pnpm test` on every push and pull request.

Angular is **zoneless**. Prefer signals for UI state that must update from EventSource or forms.

Do not add `ppk-to-openssh` (GPL-3, and a previous approach hung the product on license/quality grounds). PPK handling is `sshpk` (`parsePrivateKey`, MIT).

---

## Production notes

1. Set a long random `KAFSHEESH_MASTER_KEY` and keep it with the `kafsheesh_pg` volume (and `kafsheesh_data` if you still have JSON).
2. `docker compose up --build -d` is the packaged run: nginx serves the UI and proxies `/api` to the API. Cluster state lives in Postgres (`kafsheesh_pg`). Existing JSON under `kafsheesh_data` is imported on first boot.
3. Put TLS and authentication on a reverse proxy you control in front of port 4444 (this app has no built-in user login).
4. If you run the API without Compose, either set `DATABASE_URL` or point `KAFSHEESH_DATA_DIR` at a persistent disk and run `node apps/api/dist/main.js`.
5. If you distribute a container image or binary of Kafsheesh, include `LICENSE`, this README, and a way to obtain this source tree (GPL-3 §6).

Example written offer (when you ship object code without the full tree on the same medium):

> Corresponding Source for this Kafsheesh build is available under GNU GPL v3 or later at &lt;URL of this repository or an archive&gt; for at least three years from the date of conveyance, or as long as you offer spare parts or customer support for the product, whichever is longer.

---

## Security

- Treat the API as **fully trusted operator access** to every configured cluster.
- Private keys and Kafka passwords live on the API host. Disk encryption and a master key are your responsibility.
- Tunneling does not weaken Kafka ACL or TLS requirements; it only provides a TCP path.
- Message browse creates a consumer through KafkaJS. Use it on topics you are allowed to read. Filters run in the API process, not on the broker.
- Offset reset and topic delete are destructive. The UI asks for confirmation; the API does not have a second person-check. Set `KAFSHEESH_DISABLE_DESTRUCTIVE=true` to reject those calls and hide the UI.
- `KAFSHEESH_TLS_REJECT_UNAUTHORIZED=false` disables Kafka TLS verification. Dev only.

If you find a vulnerability in Kafsheesh, report it privately to the maintainers if possible, then disclose after a fix. There is no paid bug bounty.

---

## Limitations

- **Not multi-tenant** and **not a SaaS**.
- Consumer **lag is not computed** on list endpoints (by design, for tunnel latency).
- Schema Registry is reached from the API host, not automatically through the SSH tunnel.
- Message browse over a high-latency tunnel can be slow; the UI does not auto-load it.
- Activity and (depending on store size) some runtime state are process-local.
- KafkaJS may log `TimeoutNegativeWarning` during `admin.connect` on some clusters; connect can still succeed.
- Single-user JSON files are not an HA control plane.

---

## Third-party software

Kafsheesh **application code** is GPL-3.0-or-later. It links to and ships with other works under their own licenses. Those licenses remain in force for those components. Combining them with this GPL-3 program is allowed for typical MIT/BSD/Apache-2.0 JavaScript dependencies; you must still preserve their notices in `node_modules` (and in any source distribution).

Major runtime dependencies (not exhaustive; see each `package.json` and `node_modules/*/LICENSE`):

| Work | Role | Typical license |
| --- | --- | --- |
| Angular | UI | MIT |
| NestJS | API | MIT |
| KafkaJS | Kafka client | MIT |
| ssh2 | SSH and `forwardOut` | MIT |
| sshpk | PEM / PPK parse | MIT |
| RxJS | Streams | Apache-2.0 |
| Apache Kafka image (`apache/kafka`) | Compose broker | Image terms apply; not part of the Kafsheesh source license grant |

Do not remove license files from a source or binary distribution. If you add a dependency, prefer GPL-3-compatible licenses (MIT, BSD, Apache-2.0, LGPL, GPL). Do not add a proprietary SDK that forbids GPL combination.

The GNU GPL v3 license **text itself** is copyright the Free Software Foundation. You may copy it verbatim; you may not change it.

---

## Contributing

Contributions are welcome under the same license.

1. Fork or branch from the current source.
2. Keep changes focused. Do not reformat unrelated files.
3. Rebuild `@kafsheesh/shared` when you change types.
4. Keep GitHub Actions CI green (`pnpm sanity`: lint, build, API tests).
5. Document user-visible behavior in this README.
6. By submitting a contribution, you license it to the project under **GNU GPL v3 or later**, and you assert that you have the right to do so (you wrote it, or it is under a compatible license you can relicense).

If your employer owns your work, get a copyright disclaimer from them before you contribute (see the “How to Apply These Terms” section of [`LICENSE`](./LICENSE)).

We do not require a CLA that would let the project relicense to a proprietary license. The inbound license is GPL-3.0-or-later.

---

## Conveying copies and modifications

This section restates GPL-3 duties in project-specific language. The legally binding text is [`LICENSE`](./LICENSE).

**Source form.** You may copy and share this tree. Keep `LICENSE`, copyright lines, and this README (or an equivalent prominent notice).

**Modified versions.** State that you changed the files and the date. You must license your modified Kafsheesh (the whole program) under GPL-3 or later. You may add your own copyright line next to the existing one.

**Object code / images.** A compiled API, a built Angular bundle, or a Docker image that includes Kafsheesh is object code. You must provide Corresponding Source: the preferred form for making modifications (this TypeScript monorepo, scripts, and the interface definition files you used). A minified `main.js` alone is not Corresponding Source.

**Aggregation.** Shipping Kafsheesh on the same disk as unrelated proprietary software is an “aggregate” only if they are independent works not combined into a larger program. Linking Kafsheesh into a closed-source product is **not** allowed.

**Remote use.** Affero GPL is not this license. Running an unmodified or modified Kafsheesh on your own server without distributing it does not, by itself, force you to publish your modifications. (Still keep it self-hosted and access-controlled.)

**Patents.** GPL-3 includes an express patent license from contributors for their contributions. You may not impose a patent restriction that contradicts the GPL.

---

## Warranty and liability

**There is no warranty for this program**, to the extent permitted by applicable law.

Kafsheesh is provided **“as is”** without warranty of any kind, either expressed or implied, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose. The entire risk as to the quality and performance of the program is with you. Should the program prove defective, you assume the cost of all necessary servicing, repair, or correction.

In no event unless required by applicable law or agreed to in writing will any copyright holder, or any other party who modifies and/or conveys the program as permitted by the GPL, be liable to you for damages, including any general, special, incidental, or consequential damages arising out of the use or inability to use the program (including but not limited to loss of Kafka data, failed offset resets, leaked keys, or tunnel outages), even if such holder or other party has been advised of the possibility of such damages.

These paragraphs summarize GPL-3 sections 15 and 16. If they conflict with the license text, **the license text controls**.

---

Kafsheesh — Kafka through any wall. Copyright (C) 2026 Francis Tejano. GNU General Public License v3 or later.
