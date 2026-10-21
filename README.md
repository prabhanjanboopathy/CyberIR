# Sentinel Ops

Role-based cyber incident reporting and response platform. React (Vite) web client + Express/MongoDB API with Socket.io live updates. Design notes: [docs/SECURITY_INCIDENT_PLATFORM_DESIGN.md](docs/SECURITY_INCIDENT_PLATFORM_DESIGN.md).

## Requirements

- Node.js 22.12+ (Node 24 recommended), npm
- Docker Desktop for the local MongoDB replica set

## Run as a local app (no Docker)

```powershell
npm.cmd run start      # or double-click "Sentinel Ops.cmd"
```

This builds the web client once, starts the API with an embedded MongoDB, and opens http://localhost:4000, where the API and UI share one URL. Data is kept between runs in `apps/api/var/db` (delete that folder to reset to the demo data). The first run downloads the MongoDB binary and builds the UI, so it takes a little longer. Use `npm.cmd run start -- --rebuild` after changing the web code. Set `PORT` to change the port.

## Run as a desktop app (no Docker)

```powershell
npm.cmd run desktop    # or double-click "Sentinel Ops Desktop.cmd"
```

Opens Sentinel Ops in its own window. It starts the API and an embedded MongoDB, and stops them when the window closes. Data is kept in `%APPDATA%\sentinel-incident-platform\db`. The first run downloads Electron and MongoDB, so it takes longer. Both `start` and `desktop` use port 4000, so run only one at a time.

## Run (development with Docker MongoDB)

```powershell
npm.cmd run setup      # creates apps/api/.env with generated secrets (incl. DEMO_PASSWORD)
npm.cmd run db:up      # local MongoDB
npm.cmd run seed:demo  # idempotent demo users + sample reports
npm.cmd run dev        # API on :4000, web on :5173
```

Sign in at the web URL with a demo account below. The shared password is `DEMO_PASSWORD` in `apps/api/.env`.

## Connect to MongoDB Atlas (instead of local/Docker Mongo)

Use this if you want your data in your own cloud Atlas cluster instead of the local database.

```powershell
npm.cmd run connect:atlas
```

1. At https://cloud.mongodb.com, create a free (M0) cluster if you don't have one.
2. Database Access > add a database user with a password.
3. Network Access > allow your current IP (or `0.0.0.0/0` for quick local testing only).
4. Cluster > Connect > Drivers, copy the `mongodb+srv://...` connection string.
5. Run `npm run connect:atlas` and paste the string when prompted. It is written only to the
   git-ignored `apps/api/.env`, never logged or echoed back, and is validated immediately
   (checks the connection, replica-set status, and transaction support that the app requires).
6. Run `npm.cmd run seed:demo` once to create the 10 demo accounts and sample reports in Atlas,
   then `npm.cmd run dev` / `start` / `desktop` as usual - they all use whatever `MONGODB_URI` is
   set in `apps/api/.env`.

To point Compass at Atlas instead of local Mongo, use the same connection string from step 4
(Compass accepts `mongodb+srv://` URIs directly).

## Deploy a public link (Render + Atlas)

1. Push this folder to a GitHub repository (`.env` is git-ignored).
2. On https://render.com choose New > Blueprint and select the repo. It reads `render.yaml` and builds the root `Dockerfile` (web UI and API in one service).
3. Set `MONGODB_URI` (Atlas string), `DEMO_PASSWORD` (12+ chars) and `MFA_ENCRYPTION_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). In Atlas Network Access allow `0.0.0.0/0`, since Render's IPs change.
4. Run `npm run seed:demo` once locally against the same Atlas URI to create the demo users.
5. The link is `https://sentinel-ops.onrender.com` (or the name Render assigns). The production build disables one-click quick sign-in, so sign in with a demo email and `DEMO_PASSWORD`.

## Roles

| Level | Title | Capabilities |
|---|---|---|
| 0 | Reporter | Submit reports (title, description, attack type, asset, impact, urgency, optional evidence); view only own reports and status |
| 1 | Cybersecurity Engineer | See assigned cases; update status, add notes, complete; request help from a colleague (accept/decline, accepted colleague becomes collaborator); request reassignment with a reason (min 15 chars); toggle availability |
| 2 | Risk Analyst | All reports and audit log; reassign cases and manage collaborators; review reassignment requests; set any status; override severity with justification |
| 3 | Admin | Everything in Level 2, plus user management, full audit log (including user changes), and engineer workload/availability |

## Demo accounts (organization `northstar`)

- Level 0: `reporter1@northstar.test`, `reporter2@northstar.test`, `reporter3@northstar.test`
- Level 1: `engineer.malware@`, `engineer.trojan@`, `engineer.phishing@`, `engineer.ransomware@`, `engineer.network@` (all `@northstar.test`)
- Level 2: `analyst@northstar.test`
- Level 3: `admin@northstar.test`

The sign-in page also shows a one-click "Quick sign in (demo)" panel for these accounts. It is served by `GET /auth/demo-accounts` and `POST /auth/demo-login`, which skip the password and MFA and exist only when `NODE_ENV` is not `production`.

## Auto-assignment

On report creation, candidates are active Level 1 users who are `available` and under `maxActiveCases`. Score: primary specialty match > secondary specialty match > lowest `activeCaseCount`. If the specialist is unavailable or full, the next best candidate is chosen (`fallback: ...`). With no candidate the case stays `Yet to Assess`, unassigned, and Level 2 is notified. Assignment metadata (`assignedTo`, `assignedBy`, `assignmentReason`, `assignmentHistory`) is stored on the report. Going offline or being deactivated releases an engineer's open cases to others when possible.

## Data in MongoDB Compass

Connect to `mongodb://127.0.0.1:27017/sentinel?directConnection=true`.

- `users` - all accounts (`level`, `title`, `specialties`, `availability`, `activeCaseCount`, `maxActiveCases`)
- `reports` - all complaints/incidents
- `helprequests`, `reassignmentrequests`, `auditlogs` - related workflow data

## API (`/api/v1`)

- Auth: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, MFA and password reset
- `POST|GET /reports`, `GET /reports/:id`, `PATCH /reports/:id/status`, `PATCH /reports/:id/assignment`
- `POST /reports/:id/help-requests`, `PATCH /help-requests/:id`
- `POST /reports/:id/reassignment-requests`, `GET /reassignment-requests`, `PATCH /reassignment-requests/:id`
- `GET /audit-logs`, `GET|POST|PATCH /users`, `PATCH /users/me/availability`, `GET /analytics/summary`
- Evidence: `/reports/:id/evidence` with chain-of-custody and tamper-checked download

Every state change is written to the audit log and pushed over Socket.io to the assigned engineer, collaborators, the reporter and Level 2+.

## Commands

- `npm.cmd run db:down` / `db:status` - stop / inspect local Mongo
- `npm.cmd run config:check` - validate local secrets (`-- --production` requires Atlas)
- `npm.cmd test` - API tests (in-memory MongoDB, no running DB needed)
- `npm.cmd run lint`, `npm.cmd run build`
- `npm.cmd run check:compliance`, `check:load`, `check:prod`, `typecheck:mobile`

## Notes

- Self-registration was removed; accounts are created by an Admin or the seed.
- Playbooks, SLA policies, tasks, notifications and CSV/PDF exports from the earlier prototype were removed. The Expo app in `apps/mobile` still targets the removed `/incidents` feed and needs porting to `/reports`.
- Production: set `MONGODB_URI` to an Atlas URI and run `npm.cmd run config:check -- --production`. Never commit `.env`.
