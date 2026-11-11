# Your Appointment — Project Instructions

## Project status and scope

Your Appointment is a configurable, multi-tenant SaaS platform for appointment booking and live queue management. Phase 0, the repository and tooling foundation, is complete. The project has `frontend/` and `backend/` npm workspaces. The frontend has a React/Vite/Tailwind foundation; the backend has an Express application and MongoDB/Mongoose connection foundation, without product models or workflows.

Git has been initialized locally on branch `main`. There is currently no remote and no initial commit. Approved product and design baselines remain under `docs/`, including the SRS, architecture, database design, API specification, security design, testing strategy, and development roadmap. Treat those documents as the product and design baseline; do not change them except when a user-authorized task explicitly asks for a documentation revision.

Continue one implementation phase at a time. Do not advance to a later phase automatically. Complete the currently authorized work, report actual verification results, and wait for the user's review before starting the next phase.

## Technology direction

Use these choices when the relevant implementation milestone begins:

- Frontend: React, Vite, and Tailwind CSS.
- Backend: Node.js and Express.
- Database: MongoDB with Mongoose.
- Real-time updates: Socket.IO.
- Authentication: JWT and bcrypt.
- Request validation: select Zod or Joi when implementation needs it; explain the choice.
- Architecture: modular monolith.
- Version control: Git and GitHub.
- CI: GitHub Actions.

Do not introduce microservices without a concrete requirement that justifies the added operational complexity.

## Product requirements

The platform must support:

1. Business owners self-registering and creating businesses.
2. A business managing multiple branches, services, and staff.
3. Backend-validated, configurable business features.
4. Customer appointments as guests or registered users.
5. Walk-in queue entry using branch-specific QR codes.
6. Real-time queue updates using Socket.IO.
7. Multiple businesses with strict tenant isolation.
8. Users holding different roles in different businesses.

Platform roles include Platform Administrator, Business Owner, Staff Member, and Customer. Model authorization so a user's role in a business is represented by that business relationship rather than a single global role wherever appropriate.

## Non-negotiable engineering and security rules

- Every business-owned database record must include `tenantId`.
- Never authorize a request using a client-supplied `tenantId`. Derive and verify tenant access from the authenticated identity and membership.
- Use a memberships collection for user-to-business relationships and role assignments.
- Enforce tenant scope in data access and authorization paths, not only in the user interface.
- Store timestamps in UTC. Store and use IANA timezone identifiers for branches; convert only at presentation and scheduling boundaries.
- Prevent overlapping appointment reservations, including concurrent requests. Use appropriate database constraints, transactions, or atomic reservation strategies.
- Allocate queue sequence numbers atomically and within the correct branch/queue scope.
- Add unique indexes for identity, membership, reservation, and token constraints where required by the data model.
- Public endpoints and WebSocket events must not expose private customer information. Explicitly authorize and scope socket connections and subscriptions by tenant and resource.
- Store hashes of sensitive public tokens, not plaintext token values. Use cryptographically secure token generation and compare safely.
- Validate every incoming request on the backend, including route parameters, query parameters, body data, and relevant socket events.
- Use centralized error handling; do not leak stack traces, secrets, or internal details to clients.
- Keep secrets in environment variables or an approved secrets manager. Never commit `.env` files, credentials, API keys, signing keys, or production data.
- Apply secure authentication and authorization, password hashing, rate limiting, input validation, and safe session/token handling.
- Avoid logging passwords, tokens, sensitive customer data, or other secrets.

## Code organization and implementation practices

- Keep the backend a modular monolith, organized by clear domain or feature boundaries.
- Separate routes, controllers, services, models, and validators. Keep business logic in services/domain modules rather than route handlers.
- Keep persistence and tenant filtering explicit and reviewable.
- Use reusable, accessible frontend components and keep API communication in dedicated service modules.
- Prefer clear, maintainable, beginner-friendly code over clever abstractions.
- Keep configuration explicit and validate required environment settings at startup once application code exists.
- Avoid unrelated rewrites and unnecessary files. Inspect the existing code and conventions before changing anything.
- Explain important architectural or security decisions in documentation when they affect future work.
- Update documentation when architecture, setup, or APIs change.

## Development workflow

- Work on one milestone at a time. Confirm scope from the user's request and do not silently advance to later milestones.
- Before changing files, inspect the relevant workspace and existing implementation. Preserve user changes and avoid overwriting unrelated work.
- Do not add dependencies without explaining the need and why the selected package is appropriate. Do not install dependencies before the user requests an implementation milestone that needs them.
- Write meaningful tests for implemented functionality, especially tenant isolation, authorization, concurrency-sensitive reservations and queue allocation, validation, and privacy boundaries.
- Run relevant linting, tests, and builds after implementation when the project tooling exists. Report the commands run and their actual results; never claim checks passed unless they were executed.
- Use feature-based Git branches and meaningful commits once Git is initialized and the user requests that workflow. Do not initialize Git without authorization.
- Do not claim unfinished work is complete. Report material limitations and decisions plainly.

## Current milestone boundary

Phase 0 repository and tooling foundation is complete. The current code is limited to a frontend placeholder and backend startup/health/database-connection foundation. Do not implement Phase 1 or product functionality until the user requests it after reviewing Phase 0. Apply the milestone-by-milestone workflow above and preserve the approved `docs/` baselines.
