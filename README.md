# Your Appointment

Your Appointment is a configurable, multi-tenant appointment and live queue MVP.

## Technology

- React, Vite, Tailwind CSS, React Router, Socket.IO client.
- Node.js, Express modular monolith, MongoDB/Mongoose, Zod.
- JWT cookie sessions, bcrypt password hashes, Socket.IO.
- npm workspaces, ESLint 10, Prettier, Vitest and GitHub Actions.

Runtime and tool versions are pinned in the workspace manifests and `package-lock.json` (including ESLint `10.14.0` and `@eslint/js` `10.0.1`). Node.js 26 and npm 11 are required.

## Start locally

Install MongoDB and ensure it is running before starting the backend. Initial database connection failure prevents the API from listening.

```powershell
npm install
Copy-Item backend/.env.example backend/.env
```

Replace `JWT_SECRET` with a random secret of at least 32 characters. Keep `.env` private. Then run both apps:

```sh
npm run dev
```

Frontend: `http://localhost:5173`; API: `http://localhost:4000`; health: `http://localhost:4000/health`.

## MVP walkthrough

1. Register and sign in, then create a business.
2. Create a branch with an IANA timezone (for example `Asia/Kolkata`) and a service. The initial setup form enables appointment, queue, guest booking, and account features.
3. Register a second user and assign that existing account as staff. The branch ID is returned by the creation API (it is currently a manual setup step in the small demo UI).
4. Share `/book/<businessId>` for appointment booking. Booking availability is scoped to the branch timezone and staff schedule; overlapping appointments are claimed atomically.
5. Rotate the branch queue QR from the owner workspace. Scan its URL to choose a service and join the queue. Ticket status updates arrive over an access-token-authorized Socket.IO room.

The API is rooted at `/api/v1`. Tenant IDs are always derived from authenticated business membership or the server-resolved public resource. Customer accounts do not require a business membership. Public tokens are random credentials; only SHA-256 hashes are stored. A one-hour JWT is held in an HTTP-only cookie. Queue sequences reset by branch-local date.

For repeatable local demonstration data, set `DEMO_OWNER_EMAIL`, `DEMO_OWNER_PASSWORD`, `DEMO_STAFF_EMAIL`, and `DEMO_STAFF_PASSWORD` in the process environment (both passwords must be at least 12 characters), then run `npm run seed --workspace backend`. The seed refuses to run when `NODE_ENV=production`, creates demo users/business/branch/service/staff assignment, rotates a branch QR credential, and prints the one-time QR URL and record IDs. Use throwaway local credentials; none are stored in the repository.

## Quality commands

```sh
npm test
npm run lint
npm run build
npm run format:check
npm audit
```

## MVP limits

No notifications are delivered; password recovery and account verification are absent. Platform administration and advanced support access are deferred. Booking links require a known business ID; there is no general public business directory. Refresh-token rotation, persistent/shared rate limiting, deployment topology, and numerical performance targets remain unresolved. See [MVP implementation decisions](docs/mvp-decisions.md).
