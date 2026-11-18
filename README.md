# Your Appointment

Your Appointment is a local-first, multi-tenant appointment booking and live queue application. This repository is intended to run on a developer’s Windows machine; deployment and hosting are outside the current scope.

## Product overview

Business owners configure branches, services/rooms and staff, then manage appointments and independent service queues. Staff operate only within their assigned branches and services. Customers can book as guests or registered users, enter a walk-in queue from a branch QR link, and receive live ticket updates. Owners can review tenant-scoped customer profiles and completed visit history when the customer has explicitly consented to save a profile.

### Current capabilities

- Multi-tenant owner and staff accounts with backend membership and assignment checks.
- Appointment booking with availability checks and atomic staff-specific reservation claims.
- Independent branch/service queue numbering, multi-staff operations, guest QR entry and Socket.IO updates.
- Business and staff management, customer records, activity history and branch/date-filtered operational counts.
- Explicit customer profile consent; booking and ticket snapshots remain operational data and do not automatically create profiles.

Owners and staff are not automatically customer profiles. Queue snapshots can show a submitted name to authorized staff while a ticket is active; public ticket status and socket events do not expose names or contact information. The Customers page contains only profiles with recorded consent and reports only eligible completed visits.

## Architecture

The app is a modular monolith: React + Vite + Tailwind in `frontend/`, and Node.js + Express with MongoDB/Mongoose and Socket.IO in `backend/`. The backend owns identity, tenant authorization, consent, validation, persistence and concurrency control. See [architecture](docs/architecture.md), [database design](docs/database-design.md), [API specification](docs/api-specification.md), [security design](docs/security-design.md), and [MVP decisions](docs/mvp-decisions.md).

## Prerequisites

- Windows 11 and PowerShell.
- Node.js `26.13.0` (or another Node 26 release meeting `>=26.13.0 <27`) and npm `11` (`>=11.20.0 <12`).
- MongoDB installed locally and available at `mongodb://127.0.0.1:27017`.

## Windows 11 local setup

Run these steps from the repository root in PowerShell.

### 1. Install dependencies

```powershell
npm ci
```

### 2. Start or verify MongoDB

This project’s default connection uses the local MongoDB service on port `27017`.

```powershell
Get-Service MongoDB
```

If the service is stopped, start it from an elevated PowerShell window:

```powershell
Start-Service MongoDB
```

Confirm that MongoDB accepts a local connection:

```powershell
Test-NetConnection 127.0.0.1 -Port 27017
```

Continue when `TcpTestSucceeded` is `True`. The backend fails startup if its initial MongoDB connection cannot be established.

### 3. Configure backend environment variables

Create the local environment file and open it:

```powershell
Copy-Item backend/.env.example backend/.env
notepad backend/.env
```

The example defines the actual backend variables `NODE_ENV`, `PORT`, `FRONTEND_ORIGIN`, `MONGODB_URI`, and `JWT_SECRET`. Its defaults use development mode, port `4000`, frontend origin `http://localhost:5173`, and database `your_appointment_dev` on the local MongoDB service. Keep those values for the default local setup. Replace the placeholder `JWT_SECRET` with a random secret of at least 32 characters. You can generate one with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Paste the generated value after `JWT_SECRET=` in `backend/.env` and save the file. Never commit `.env` or share its contents.

### 4. Seed demo data safely

The seed command creates or updates a demo owner, staff account, business, branch, service, staff assignment and queue QR credential. It refuses to run when `NODE_ENV=production`. Set the four variables that the seed actually reads; use emails and passwords you choose. Passwords must each be at least 12 characters. PowerShell’s secure prompt avoids echoing the passwords:

```powershell
$env:DEMO_OWNER_EMAIL = Read-Host 'Demo owner email'
$ownerPassword = Read-Host 'Demo owner password (12+ characters)' -AsSecureString
$env:DEMO_OWNER_PASSWORD = [System.Net.NetworkCredential]::new('', $ownerPassword).Password
$env:DEMO_STAFF_EMAIL = Read-Host 'Demo staff email'
$staffPassword = Read-Host 'Demo staff password (12+ characters)' -AsSecureString
$env:DEMO_STAFF_PASSWORD = [System.Net.NetworkCredential]::new('', $staffPassword).Password
npm run seed --workspace backend
Remove-Item Env:DEMO_OWNER_EMAIL, Env:DEMO_OWNER_PASSWORD, Env:DEMO_STAFF_EMAIL, Env:DEMO_STAFF_PASSWORD
```

The seed prints the owner/staff email addresses, business/branch/service IDs and a one-time local queue QR URL. Use the passwords you entered when signing in; the seed does not print them. Run the seed again only when you want to refresh the demo setup: it rotates and revokes the previous QR credential.

For a database upgraded from an earlier build, inspect legacy customer profiles before using the consent migration. It defaults to a read-only aggregate dry-run:

```powershell
npm run migrate:customer-consent --workspace backend
```

Only after reviewing that aggregate summary, apply it explicitly with:

```powershell
npm run migrate:customer-consent --workspace backend -- --apply
```

The migration preserves ticket, appointment and audit records. It backfills profile consent only from a recorded appointment/queue consent timestamp, clears contact details collected by the old queue flow, and anonymizes profiles without reliable consent. It never prints profile data. Do not run it against an unintended database; check `MONGODB_URI` in your local environment first.

### 5. Start the frontend and backend

From the repository root:

```powershell
npm run dev
```

This starts both development servers. Alternatively, run `npm run dev:backend` and `npm run dev:frontend` in separate PowerShell windows. Keep MongoDB running. Press `Ctrl+C` in the server window(s) to stop development servers.

### 6. Open the local application

- Frontend: <http://localhost:5173>
- Backend API: <http://localhost:4000/api/v1>
- Backend health check: <http://localhost:4000/health>

The health response should include `"database":"connected"`.

### 7. Log in with the seeded demo owner

Open <http://localhost:5173/auth?intent=owner>, choose **Sign in**, and enter the owner email and password you supplied in Step 4. The demo business already exists. Its business ID from the seed output is used in the customer booking URL below. The seeded staff member can sign in at <http://localhost:5173/auth?intent=staff> using the staff email and password you supplied.

### 8. Owner, staff and customer journeys

Use the business, branch, service IDs, account emails and queue entry URL printed by the seed command. The seed creates demo data only; it does not choose passwords for you.

#### Business owner

1. Open <http://localhost:5173/auth?intent=owner> and register with a new email, or sign in with the seeded owner credentials.
2. A new owner sees the setup flow: create a business, add its first branch, add a service, optionally assign a staff account, then finish setup. The seeded owner can open the existing business workspace directly.
3. Use the owner navigation for appointments, queue operations, customers, staff, services, branches, analytics and business settings. Use the generated branch QR entry link for walk-ins and the booking link `http://localhost:5173/book/<business-id>` for appointments.

#### Staff member

1. Register or sign in at <http://localhost:5173/auth?intent=staff> with the staff email/password supplied during seeding.
2. The owner must assign the staff account to a branch from **Staff** settings. After assignment, sign in again if the pending-access screen was already open.
3. The staff workspace shows assigned operational work: appointments, queue, customer details and schedule. Staff API access is scoped to assigned branches.

#### Customer

1. Open `http://localhost:5173/book/<business-id>` to choose an active branch, service and available time. A guest can enter a name and email and confirm without registering.
2. For an account, open <http://localhost:5173/auth?intent=customer>, register or sign in, then use **My Appointments** and **Queue Tracking**. Customer accounts are not required for guest bookings.
3. For a walk-in, open the queue entry URL printed by the seed (or scan the branch QR code), choose a service and enter guest details. Keep the ticket page open to receive live status and queue-position updates while staff call, serve and complete the ticket.

## Quality checks

```powershell
npm test
npm run lint
npm run build
npm run format
npm run format:check
npm audit
```

`npm run format` formats source/configuration and this README; it does not rewrite the approved design documents under `docs/`.

## Local application scope and limitations

Authentication uses an HTTP-only JWT cookie. Guest booking/queue credentials are returned when created; only their hashes are stored. Appointment capacity is staff-specific and claimed atomically. Queue numbering resets by branch-local date. The current MVP does not deliver notifications, provide password recovery, implement refresh-token rotation, or include platform-administrator screens. Rate limits are process-local. Booking links need a business ID; there is no general public business directory. See [MVP implementation decisions](docs/mvp-decisions.md).
