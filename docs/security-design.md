# Your Appointment — Security Design

**Status:** Proposed design for review  
**Applies to:** MVP described by SRS v0.2  
**References:** `AGENTS.md`, `docs/SRS.md` v0.2, `docs/architecture.md` v0.1, `docs/database-design.md` v0.1, and `docs/api-specification.md` v0.1

This document describes security boundaries and controls to guide implementation. It is not a compliance statement, penetration-test result, or guarantee that a system is secure. Controls marked **required** come from the approved project rules or baselines. Controls marked **proposed** need implementation and review. Product policies marked **TBD** must not be inferred from this design.

## 1. Purpose and scope

The MVP handles business accounts, staff relationships, customer identity, appointments, walk-in queue tickets, live updates, and business-scoped operational analytics. This design identifies what must be protected and where authorization and validation belong. It applies to the browser client, Express REST API, Socket.IO gateway, and MongoDB/Mongoose access layer in the modular monolith.

The backend is the security authority. Frontend checks may improve usability but cannot authorize access. Security policy must be applied consistently to REST requests, socket connections, socket room subscriptions, background work added later, and database reads or writes.

## 2. Security objectives and threat model

Protect account credentials, private customer data, business configuration, appointment and queue integrity, tenant separation, and availability of core booking and queue operations. The design assumes an attacker may be an unauthenticated internet user, an authenticated customer, a staff member with limited scope, a tenant owner, or a compromised account. It also considers mistakes such as missing query filters, overly broad socket events, and concurrent requests.

The system should prevent unauthorized disclosure, modification, or deletion; limit abuse; make security-relevant activity reviewable; and fail closed when identity, tenant context, feature settings, or permissions cannot be established. Basic platform administration does not grant unrestricted access to tenant or customer records.

## 3. Assets to protect

- Password hashes, authentication and refresh credentials, and public access token hashes.
- Global user identity and each business membership and role assignment.
- Business, branch, service, staff assignment, feature configuration, and operational status.
- Customer contact details and private customer-to-appointment or customer-to-queue associations.
- Appointment times, lifecycle state, capacity allocation data, and queue sequence/state.
- Audit records, secrets, database connection information, and deployment configuration.
- Socket event payloads, room membership, and platform-level business analytics.

## 4. Trust boundaries and attack surfaces

| Boundary | Inputs crossing it | Required checks |
|---|---|---|
| Browser to REST API | Route parameters, query, body, headers, cookies if later approved | Authentication where required; schema validation; feature and permission checks; tenant resolution from trusted identity and resource ownership |
| Browser to Socket.IO | Handshake credentials, event names and payloads, room requests | Authenticate connection; authorize every subscription/action; validate payloads; never trust client-selected tenant or room identifiers |
| API to MongoDB | Filters, updates, aggregation stages, identifiers | Server-built tenant-scoped filters; allow-listed fields; safe Mongoose usage; concurrency-safe domain operations |
| Public QR/link to API | Public identifier or token | Treat as untrusted; resolve only the intended active public context; hash secret tokens at rest; rate-limit abuse |
| Platform operator to tenant operations | Administrative action and support context | Separate platform permissions from tenant membership; narrow, audited administrative actions; sensitive support access policy remains TBD |

The main attack surfaces are registration/login, business and membership administration, public booking and queue entry, availability and reservation races, QR entry, customer status access, socket subscriptions, feature-setting changes, and analytics or administration endpoints.

## 5. Authentication architecture

The current stack calls for JWT and bcrypt. Authentication identifies a user; it does not by itself authorize a business action. Protected requests must establish a valid principal and then perform resource and action authorization.

Password verification must use the approved password-hashing library and safe parameters selected during implementation. Never store or log plaintext passwords. Login and registration inputs must be validated and abuse-limited. Responses should avoid revealing whether a particular account exists when that distinction could aid account enumeration.

Token claims should contain only the minimum identity and security information needed. A tenant role should not be treated as a global claim that remains valid after membership changes unless the design includes a reliable revocation or freshness mechanism. The exact claims, signing-key rotation, access-token lifetime, refresh policy, and revocation model are **TBD**.

## 6. Session and refresh credential policy

`POST /auth/refresh` remains conditional on approval of a refresh-token/session policy. If adopted, it must use an approved refresh credential and must not require an unexpired access token as its refresh proof. Cookie versus bearer transport, CSRF implications, rotation, expiry, replay detection, logout/revocation behavior, and cross-device session management remain **TBD**. This document does not finalize a transport choice.

Until that policy is decided, implementation must not silently create a refresh endpoint with assumed semantics. Access-token transport and storage must also be reviewed before implementation; browser storage choices affect XSS and CSRF exposure.

## 7. Password and account protections

- Hash passwords with bcrypt as required by the selected stack; never encrypt passwords for later recovery.
- Keep password and authentication secrets out of responses, logs, analytics, and audit metadata.
- Validate credentials on the backend and apply rate limiting to account creation, login, credential recovery if later approved, and other abuse-prone actions.
- Use generic authentication failures where detailed errors could disclose account existence.
- Define password length and composition policy before implementation; avoid inventing policy in API handlers.
- Multi-factor authentication is not an MVP requirement in the current baselines and is not assumed here.

## 8. Global roles, platform permissions, and tenant memberships

The platform administrator role is platform-scoped. Business Owner and Staff Member permissions are represented by a user-to-business membership (and, where relevant, branch assignments). A customer identity is a person making a booking or joining a queue; it does not imply membership in every business used. The same person may be a customer and also a staff member or owner.

Authorization must distinguish these contexts explicitly. A global platform permission must not be substituted for a tenant membership, and a membership in one business must never confer access to another. Platform-level business listing, status management, usage monitoring, and approved aggregates are separate from access to private customer or appointment records. Exact support access to private tenant data is **TBD** and requires an explicit, auditable policy.

## 9. Resource and action authorization

For every protected action, the backend should establish, in order:

1. The authenticated principal, if authentication is required.
2. The resource's tenant and branch context by loading or securely resolving the resource.
3. An active membership or platform permission appropriate to that action.
4. Any branch scope, role-specific restriction, business status, and feature-setting requirement.
5. Whether the requested fields and state transition are allowed.

The detailed role-to-action and branch-scope matrix is **TBD**. Until approved, implementation should use explicit allow-lists and deny-by-default behavior rather than broad “owner/staff” shortcuts. Public endpoints must return only fields deliberately designated public-safe.

## 10. Tenant isolation

Every business-owned record must carry `tenantId`, and every business-scoped read, write, update, delete, aggregation, and socket delivery must be scoped to the authenticated or securely resolved tenant. Never accept a client-supplied `tenantId` as proof of authorization. A client may send an identifier needed to select a resource, but the server must resolve that resource and prove that its tenant and branch are authorized for the principal.

For membership-authorized operations, derive tenant context from a verified membership. For a public flow, derive it by resolving the public business/branch/service context and checking that the business is active and the required feature is enabled. A mismatch should fail without disclosing whether another tenant's resource exists. Tenant scoping should be centralized in service/data-access patterns and reviewed in code review; it must not rely on every controller author remembering a filter.

## 11. MongoDB and Mongoose data-access security

MongoDB is the source of truth. Mongoose schemas and indexes support validation and integrity but do not replace authorization. Build filters and updates from validated, allow-listed fields; do not pass arbitrary request objects to `find`, `findOneAndUpdate`, aggregation, or update operators. Avoid unsafe dynamic query construction and prototype-key handling. Use validated identifiers and safe object construction.

Tenant-scoped repositories/services should require tenant context for tenant-owned collections. Aggregation pipelines must include tenant and branch constraints at the correct stage. Unique indexes should enforce approved uniqueness rules; indexes alone do not prevent appointment interval overlap. Database credentials should be least-privileged for the runtime's needs and supplied through secret configuration. Database topology, transaction support, and backup/restore procedures remain deployment decisions.

## 12. Public and guest access

Public business, branch, and service context endpoints in the API baseline are read-only and context-specific. They must check that the business and returned records are active, enforce the applicable tenant feature setting, and expose only public-safe fields. General public business directory search is not part of the SRS requirement.

Guest booking or queue entry must not make private records accessible merely by knowing a sequential identifier, appointment ID, or queue ticket ID. Guest verification and the exact credential used to retrieve, cancel, or follow a guest-created record remain **TBD**. Until approved, sensitive guest operations must fail closed or be limited to explicitly approved, non-sensitive behavior. Any customer-access credential must be unguessable and scoped to the minimum action and record required.

## 13. QR codes and public token lifecycle

Branch QR codes may provide a public entry point, but must not be treated as authorization for staff operations or broad customer-data access. Where a QR flow includes a secret public token, persist only a cryptographic hash of that token, compare safely, and scope it to the intended business/branch and purpose. Do not put raw secrets in logs, analytics, URLs that are routinely logged, or ordinary response bodies.

The public-token generation method, entropy requirements, expiry, rotation, revocation, replay handling, and whether a static branch QR uses a token or public identifier are **TBD**. The API baseline requires secure hashed public tokens but does not settle these lifecycle choices. Token failures should not reveal token validity beyond what the flow needs.

## 14. Appointment booking, availability, and abuse

Availability is informational and may become stale before booking. The booking operation must re-check relevant constraints atomically or through an equivalently safe concurrency strategy. Detect overlapping time intervals, including variable-duration services, and prevent two reservations from consuming the same incompatible capacity at once, including concurrent requests. The capacity model remains unresolved: staff-specific, service/resource-based, or hybrid. Do not implement a default assignment policy without product approval.

Which appointment states consume capacity and the lifecycle/transition policy remain **TBD**. The service must apply the approved state-to-capacity policy consistently when creating, changing, or cancelling reservations. Add abuse controls for repeated availability scans and booking attempts, without inventing numerical limits in this design.

## 15. Walk-in queue abuse and integrity

Queue sequence numbers must be allocated atomically so concurrent joins cannot receive conflicting or incorrectly duplicated positions within the approved queue scope. Queue configuration, sequence reset scope, and transaction/topology strategy remain **TBD**. Retries must not create unintended duplicate tickets; any idempotency behavior requires an approved contract.

The initial queue status vocabulary is `WAITING`, `CALLED`, `SERVING`, `COMPLETED`, `NO_SHOW`, and `CANCELLED`. Allowed transitions, recall, skipping, reopening, exceptional transitions, and actor permissions remain **TBD**. Enforce the approved transition rules on the backend. Public queue views must omit private customer data and should disclose only the minimum queue position/status information needed by the approved flow.

## 16. REST API security

Every request body, path parameter, and query value must be validated on the backend using the selected validation library (Zod or Joi remains to be chosen). Apply authentication and action authorization per endpoint, enforce feature settings server-side, and return consistent errors without stack traces or internal database details. Use safe HTTP methods and status codes consistent with the API specification. Set request size limits appropriate to the operations once payload needs are known.

The API must not trust client-supplied role, membership, tenant, price, capacity, state, or ownership fields. Server-controlled fields should be assigned by domain services. Unknown fields should be rejected or ignored according to one consistent policy selected before implementation; mass assignment must be prevented either way.

## 17. Socket.IO security and privacy

Authenticate a socket connection using the approved credential mechanism. Authorize each room subscription against the server-resolved tenant, branch, membership, and feature context. Never allow a client to join a tenant or branch room simply by supplying its ID. Re-check or invalidate room access when the relevant authorization becomes stale, according to the eventual session strategy.

Emit events only to authorized scopes and include only the minimum fields needed for the live queue experience. Do not emit customer names, contact details, appointment notes, or other private data on public queue events. A socket event is a notification of change, not the authoritative record; clients should retrieve authorized current state after reconnect or missed delivery. Reconnection and event replay semantics are not a source of authorization.

## 18. Validation, state changes, and mass assignment

Validate input at the API boundary and enforce domain invariants in services. Use explicit request DTOs and explicit update allow-lists. Do not bind request payloads directly to Mongoose documents. Validate enums, dates, timezone identifiers, duration, identifiers, pagination bounds, and relationships. Store timestamps in UTC and use IANA timezones for branch-local schedules.

All status transitions and feature-setting changes must be backend-controlled. Validation errors should identify correctable fields without exposing secrets, internal stack traces, or cross-tenant resource existence. Centralized error handling is required by the architecture baseline.

## 19. Rate limiting and automated abuse controls

Apply rate limits and abuse monitoring to authentication, public discovery, availability, booking, queue joining, token-based access, and socket connection/subscription actions. Limits should account for both identity and network-level patterns where appropriate and should avoid creating an easy denial-of-service vector against a single customer. Numerical thresholds, storage mechanism, and blocking duration are **TBD** and must be selected from expected usage and deployment topology; this document does not define performance or rate-limit SLAs.

## 20. Browser, CORS, CSRF, XSS, and injection

Configure CORS to permit only the deployed frontend origins selected for each environment; do not use permissive wildcard origins with credentialed requests. If authentication uses cookies, define CSRF protections and cookie attributes as part of the approved session policy. If bearer tokens are used, protect token storage against XSS and never place credentials in URLs. Escape untrusted content in the UI and avoid unsafe HTML rendering. Use HTTPS at deployment boundaries and secure WebSocket transport through the approved hosting configuration.

Mongoose and MongoDB inputs must be structured and validated; do not construct raw query operators from user-controlled values. Frontend and API security headers, CSP, and exact production origin policy should be selected in deployment planning.

## 21. Sensitive data and privacy

Collect and expose only data needed for the appointment and queue workflows. Public endpoints and live events must not reveal private customer information. Keep customer identity separate from tenant membership; an account does not imply a membership in every business where the person books. Avoid placing sensitive fields in analytics and operational logs.

Data retention, deletion, export, consent, legal jurisdiction, data residency, and exact customer-visible privacy disclosures are **TBD**. Do not make retention or regulatory compliance commitments until they are decided. The security design does not require or assert a particular encryption-at-rest configuration; infrastructure encryption choices remain a deployment decision.

## 22. Logging, monitoring, and audit

Use structured operational logs with request correlation identifiers and relevant outcome/context metadata, while excluding passwords, access/refresh credentials, raw public tokens, full customer payloads, and unnecessary personal data. Sanitize untrusted values to prevent log injection. Record security-relevant events such as authentication outcomes, membership/role changes, feature-setting changes, business suspension/reactivation, and privileged administrative actions, subject to the audit model.

Audit events should identify the actor, action, target type/identifier, tenant context when applicable, timestamp in UTC, and a minimal change summary. Do not duplicate private customer data into audit metadata. Audit storage access, retention, tamper resistance, and platform support access policies remain **TBD**. Monitoring should surface repeated failures, authorization denials, unusual public-flow abuse, queue/booking integrity errors, and service/database failures without exposing sensitive payloads.

## 23. Secrets and environment configuration

Keep database credentials, JWT signing keys, refresh secrets, and external provider credentials in environment-based secret configuration. Never commit `.env` files, credentials, API keys, or production data. Validate required configuration at process startup and fail safely when secrets are missing or malformed. Use separate credentials and values across development, test, and production. Rotation procedures and managed secret provider are deployment decisions.

## 24. File uploads

File upload is not included in the current MVP requirements or API inventory. Do not add upload endpoints or upload dependencies as part of this design. If a future requirement introduces uploads, define allowed content types, size limits, storage, malware scanning needs, authorization, retention, and public access behavior before implementation.

## 25. Backup, recovery, and incident response

Deployment planning should define backup cadence, restore verification, recovery objectives, credential rotation, incident ownership, and breach/incident escalation. No numerical recovery target, hosting provider, retention period, or incident-response SLA is established by the current baselines. Backups must receive the same access protection as live data and should not be copied into local test fixtures.

## 26. Security verification requirements

Security checks belong in unit, integration, API, socket, and end-to-end tests as appropriate. At minimum, verify cross-tenant denial, role and branch scope, feature-setting enforcement, public-field filtering, token-hash handling, authorization on socket room joins, safe validation/error responses, and concurrent booking/queue integrity. Run dependency and static analysis checks in CI once tools are selected. A passing automated suite is evidence for its tested cases, not proof of complete security.

See `docs/testing-strategy.md` for proposed test layers and traceability.

## 27. Threats and mitigations

| Threat / what can go wrong | Impact | Surface | Mitigation | How it is tested |
|---|---|---|---|---|
| Client changes `tenantId` or guesses another tenant's IDs | Cross-business disclosure or modification | REST, database queries, sockets | Resolve tenant from verified membership or validated public context; scope every tenant query; deny by default | Attempt reads, writes, aggregations, and room joins using another tenant's identifiers; expect no access or data leakage |
| Missing or stale membership/role check | Unauthorized staff/owner action | Tenant operations | Check active membership and action/branch scope on each operation; keep permissions server-side | Role matrix tests for allowed and denied actions; membership removal/change cases |
| Platform administrator treated as unrestricted support user | Exposure of private customer or appointment data | Platform administration | Separate platform capabilities from tenant membership; keep exact support access **TBD**; audit privileged actions | Verify platform business/aggregate views exclude private records; test unapproved support access denied |
| Credential guessing, stuffing, or account enumeration | Account compromise and user discovery | Registration/login | Bcrypt hashes, rate limits, generic failures, monitoring | Repeated failure tests; assert responses do not reveal account existence or secrets |
| Raw secret or public token leaks from storage/logs | Unauthorized account or guest-record access | Auth, QR/public flows, logs | Store public token hashes; redact credentials; restrict logs and responses | Inspect persisted token values and captured logs; verify raw value is absent |
| Guest uses sequential ID or another person's ticket identifier | Private record disclosure or unauthorized action | Public appointment/queue access | Require approved scoped credential for sensitive access; avoid ID-only authorization; policy remains **TBD** | Cross-customer ID substitution and guessed-ID tests; assert no private fields or actions are available |
| Appointment requests race for the same capacity | Double booking | Availability and booking | Revalidate atomically; enforce interval overlap and capacity constraints under concurrency; capacity policy **TBD** | Simultaneous requests for overlapping variable-duration intervals; verify incompatible reservations do not both succeed |
| Queue sequence increment races or retry duplicates a ticket | Duplicate/skipped integrity or incorrect queue order | Queue join | Atomic sequence allocation; define scope, transaction strategy, and idempotency policy before implementation | Parallel join and controlled retry tests against a database topology representative of deployment |
| Client bypasses a disabled feature | Unavailable or unapproved operation | REST and socket operations | Validate tenant feature setting in backend services for every relevant operation | Exercise disabled features through direct API and socket calls; verify consistent denial |
| Socket room/event exposes another branch's queue or private data | Cross-tenant/branch privacy leak | Socket.IO | Authenticate, authorize subscriptions, derive rooms server-side, minimize payloads | Attempt unauthorized room joins; inspect event payloads and cross-tenant broadcasts |
| Mass assignment or operator injection changes protected fields | Privilege escalation or corrupt data | Request body/query to Mongoose | Schema validation, explicit DTOs/allow-lists, safe filter/update construction | Submit role, tenant, owner, status, operator, and unknown fields; assert they cannot alter protected state |
| Public discovery leaks inactive/private records | Business or customer information disclosure | Public read endpoints | Resolve business/branch, enforce active state and feature settings, return public-safe projection | Test inactive business/branch/service and sensitive-field exclusion |
| PII, credentials, or tokens appear in logs | Privacy exposure and replay | API, socket, operational logs | Structured redacted logs and minimal audit metadata | Capture logs for auth, guest, validation, and error paths; assert secrets and unnecessary PII absent |
| XSS/CSRF/CORS misconfiguration enables account misuse | Credential theft or unwanted state change | Browser and API boundary | Context-appropriate token transport, safe rendering, restrictive CORS; cookie CSRF policy if cookies chosen | Browser security tests and configuration review after session/origin policy is approved |
| Authorization failure returns stack trace or resource existence | Information disclosure | REST errors | Centralized error handling and non-enumerating responses | Assert error shape excludes stack, database details, and cross-tenant existence clues |
| Audit or secret configuration is altered/exposed | Weak incident investigation or system compromise | Operations and deployment | Restrict configuration/log access; keep secrets out of Git; record sensitive admin actions | Secret scanning/config review and audit event tests; deployment checks once environment is defined |

## 28. Unresolved security decisions

The following remain open and must be resolved by the appropriate product/architecture owner before the affected behavior is finalized:

- Access-token claims/lifetime, signing-key rotation, refresh credential transport, rotation, expiry, revocation, and logout/session policy.
- Guest identity verification, credential delivery, public token purpose/lifetime/rotation/revocation, and safe guest cancellation/status access.
- Detailed role-to-action and branch-scope permissions; platform support-access policy for private tenant data.
- Appointment capacity model, appointment states that consume capacity, and appointment lifecycle transitions.
- Queue scope/reset/idempotency and allowed transitions, recall, skip, reopening, and exceptional actions.
- Rate-limit thresholds and abuse response; deployment topology and the storage mechanism for distributed rate limits.
- Data retention, deletion/export, jurisdiction, residency, consent, and audit retention/access policy.
- Hosting provider, TLS termination, secret manager, backup/recovery targets, and monitoring/incident response.
- Exact browser authentication transport, CORS origins, CSRF approach if cookies are chosen, CSP, and security headers.

These are design dependencies, not permission to choose convenient defaults silently. Record approved resolutions in the relevant baseline documents before implementation relies on them.
