# MVP Implementation Decisions

This note records implementation choices made to deliver the deadline-driven MVP. It supplements the approved product/design documents and does not add product scope.

## Selected for this MVP

- **Appointment capacity:** staff-specific reservations. Service duration determines the reserved interval. A MongoDB `ReservationCalendar` document is atomically updated only when no stored interval overlaps; concurrent attempts cannot claim the same staff capacity. Only `BOOKED` appointments consume capacity; cancellation and terminal completion/no-show release the calendar entry. Resource-based and hybrid capacity remain future alternatives.
- **Appointment statuses:** `BOOKED`, `CANCELLED`, `COMPLETED`, `NO_SHOW`. A booked appointment can move to one terminal status; terminal records cannot be reopened.
- **Queue statuses:** `WAITING`, `CALLED`, `SERVING`, `COMPLETED`, `NO_SHOW`, `CANCELLED`. Implemented transitions are WAITING→CALLED by call-next or WAITING→CANCELLED; CALLED→SERVING/NO_SHOW/CANCELLED; SERVING→COMPLETED. Recall, skip, reopening, and exceptional transitions are deferred.
- **Queue counter scope:** branch + service configuration + branch-local calendar date. An atomic MongoDB counter increment allocates unique sequence numbers. Gaps are acceptable.
- **Session:** one-hour JWT in an HTTP-only, SameSite=Lax cookie; Secure in production. There is no refresh credential or server-side session revocation in this MVP. Signing out clears the browser cookie; a copied token remains valid until expiry.
- **Public credentials:** cryptographically random values, stored as SHA-256 hashes. Guest appointment tokens expire after 30 days, queue tokens after 7 days; branch QR credentials remain valid until rotated.
- **Privacy:** public ticket status includes sequence and status only. Socket.IO ticket-room authorization checks the ticket token; branch operations rooms require active membership and branch assignment. Queue events carry no customer PII.
- **Rate limits:** in-memory, process-local limits (login 10/15 minutes and public flows 60/minute). They reset on restart and are not shared across processes.
- **Audit:** business/management mutations write tenant-scoped safe summaries; credentials and customer secrets are excluded.
- **Analytics:** business-scoped operational appointment and queue status counts. No cross-business analytics or forecasting.

## Deferred or limited

- Platform administration screens and advanced support access are deferred; the MVP does not grant platform staff tenant-data access.
- No refresh-token transport, rotation, expiry, or revocation policy is implemented.
- Notification settings are configurable, but delivery providers/channels are not integrated.
- General public business discovery is absent; booking links need a known business ID. Branch QR is the queue entry point.
- Deployment topology and numerical performance targets remain deployment decisions.
- There is no dedicated audit viewer or support tooling.
