# Software Requirements Specification (SRS)

## Your Appointment

| Document attribute | Value |
|---|---|
| Status | Reviewed requirements baseline; targeted revision |
| Product | Your Appointment |
| Version | 0.2 |
| Last updated | 2026-11-11 |

**Revision note (0.2):** Clarifies appointment capacity and interval conflicts, initial queue statuses, tenant feature settings, basic platform administration, MVP analytics, and customer identity versus business membership. Existing approved product direction is preserved.

### 1. Introduction

#### 1.1 Purpose

This Software Requirements Specification (SRS) records the agreed product direction, user-facing capabilities, quality requirements, and unresolved decisions for Your Appointment. It is intended to guide product review, system design, implementation planning, and acceptance of the initial minimum viable product (MVP). It describes required outcomes without fixing detailed database schemas or API contracts.

#### 1.2 Scope

Your Appointment is a configurable, multi-tenant SaaS platform for appointment-based businesses. It will let business owners create and manage business locations, services, staff, appointments, and walk-in queues. Customers will be able to book as guests or registered users, join a walk-in queue using a branch QR code, and follow queue progress through real-time updates.

The initial product is a web application built with React and Vite on the frontend and Node.js and Express on the backend. The backend will use MongoDB through Mongoose and Socket.IO for real-time communication. The system will be a modular monolith. These are finalized product decisions and are not open alternatives in this SRS.

#### 1.3 Product overview

The product serves businesses whose customers book time or wait for service, including clinics, salons, diagnostic centers, automobile service centers, consultants, coaching centers, repair shops, and similar organizations. Each business is a tenant. A tenant may have multiple branches, and users may participate in several tenants with different roles in each. A platform administrator has separate platform-level authority.

The MVP focuses on business setup, service and staff configuration, appointment booking, walk-in queue operation, and live customer status. Online payments, SaaS subscription billing, WhatsApp messaging, native mobile applications, and other deferred capabilities are outside MVP scope.

#### 1.4 Intended audience

- Product owner and business stakeholders reviewing scope and priorities.
- Designers preparing user journeys and interaction designs.
- Engineers implementing frontend, backend, data access, and real-time behavior.
- Quality engineers preparing functional, security, and acceptance tests.
- Operators responsible for configuring and supporting the service.

#### 1.5 Definitions and abbreviations

| Term | Definition |
|---|---|
| Tenant / business | An independently managed business account and its organizational data. |
| Tenant-owned record | A record created for or belonging to a business, such as a branch, service, staff assignment, appointment, or queue ticket. |
| Membership | The relationship granting a user one or more tenant-level roles in a business. |
| Branch | A physical or service location belonging to one business; it has its own address, timezone, settings, and operational schedules. |
| Service | A bookable or queueable offering provided by a business, optionally at selected branches and by selected staff. |
| Appointment | A reservation for a customer, service, branch, time, and (where applicable) staff member. |
| Walk-in queue | An ordered set of customers awaiting service at a branch, generally associated with a service or queue configuration. |
| Queue ticket | A customer's record and position in a walk-in queue, with a lifecycle from joining through service completion or exit. |
| Feature setting | A tenant-configurable capability or policy that the backend must validate before allowing the related operation. |
| IANA timezone | A canonical timezone identifier such as `Asia/Kolkata` used to interpret local branch schedules and display times. |
| MVP | Minimum viable product: the first agreed usable release, limited to the capabilities in Section 11. |
| TBD | To be decided by the product owner or stakeholders. |
| UTC | Coordinated Universal Time, the standard for stored timestamps. |

### 2. Overall Description

#### 2.1 Product perspective

Your Appointment is a new web-based SaaS product. The browser frontend communicates with a backend REST API. The backend owns authentication, authorization, tenant scoping, validation, business rules, persistence, and integrations. MongoDB is the persistence platform. Socket.IO carries authorized real-time queue updates. QR codes provide a customer entry point to a branch's walk-in flow; a QR code does not itself grant access to private business data.

The application is one modular monolith with domain boundaries. It is not a collection of independently deployed microservices. Future external notification providers may be integrated behind appropriate backend interfaces, but providers and delivery channels are not finalized for MVP.

#### 2.2 Product objectives

1. Allow a business owner to establish a usable business account without platform staff creating it manually.
2. Allow a business to manage branches, services, staff, schedules, and operational feature settings.
3. Let customers reserve appointments or join a walk-in queue with a low-friction flow.
4. Give staff a clear operational view of appointments and queues and tools to advance service.
5. Keep customer-facing queue status timely through real-time updates.
6. Protect data between businesses and protect private customer information.
7. Support a user's different authorized roles across multiple businesses.

#### 2.3 Business problems being solved

Appointment-based businesses may coordinate bookings and waiting lines through disconnected tools or manual processes. Customers may lack a clear way to reserve a time or understand their place in a live queue. Staff may have difficulty seeing and advancing current work. Owners may need to manage several branches and configure services consistently. Your Appointment is intended to bring these workflows into one configurable platform. Specific quantified business outcomes and success thresholds are TBD.

#### 2.4 User classes and characteristics

| User class | Characteristics and needs |
|---|---|
| Platform Administrator | Operates the SaaS platform through platform-level functions such as viewing and managing tenant accounts, monitoring aggregate platform usage, changing business activation state, and reviewing platform-level analytics. The role does not by itself grant access to private tenant or customer records; sensitive support access policy is TBD and must be explicitly authorized and auditable. |
| Business Owner | Creates a business, configures tenant settings and branches, manages services and staff, and reviews operational information. May belong to more than one business. |
| Staff Member | Works for one or more branches/businesses, sees only the operational information needed for assigned duties, and manages appointment or queue service actions permitted by membership. |
| Customer | A person who books appointments or joins queues as a guest or through a registered customer account, and may view their own booking or queue status. Customer identity does not itself create a business membership. The same person may also hold owner or staff memberships. |

Users may have more than one user class over time. Tenant permissions are attached to a user's membership in a particular business, rather than inferred from a universal owner/staff role. A registered customer account can make bookings at businesses without a membership in each of them. Customer identity represents the person making a booking or queue entry; membership represents an authorized relationship with a business. Platform permissions are separate from tenant membership roles.

#### 2.5 Operating environment

- Responsive web browsers on desktop and mobile devices; the supported browser/version matrix is TBD.
- Frontend: React with Vite and Tailwind CSS.
- Backend: Node.js with Express.
- Data store: MongoDB accessed through Mongoose.
- Real-time channel: Socket.IO over web-compatible network connections.
- QR flow: a mobile device camera or QR reader opens a web URL for the relevant branch queue flow.
- Hosting provider, deployment topology, supported regions, and operational tooling are TBD.

#### 2.6 Design constraints

- The application shall use the finalized technology and modular monolith decisions listed in Section 1.2.
- Every tenant-owned database record shall include a tenant identifier, and access shall be scoped by verified membership rather than a client-provided tenant identifier.
- Users may hold different roles in different businesses; authorization must distinguish global platform permissions from tenant permissions.
- Stored timestamps shall use UTC; branch schedules and local presentation shall use an IANA timezone.
- Appointment overlap and queue sequence operations must remain correct under concurrent requests.
- Private customer information must not be included in public endpoints or public queue events.
- No payment, subscription billing, WhatsApp, AI scheduling, native mobile app, advanced marketing, or complex resource management capability is assumed for MVP.

#### 2.7 Assumptions and dependencies

- Businesses and their staff have access to a modern browser and internet connection.
- Customers can open a web page from a QR code; camera access is provided by their device/browser, not by a native Your Appointment application.
- A business supplies accurate branch operating hours, timezone, services, and staff availability.
- Email/SMS provider, identity verification policy, password recovery method, hosting, backups, and monitoring services have not been selected; any dependent behavior is TBD.
- The product owner will resolve open policy questions in Section 16 before the affected requirements are treated as implementation-ready.

### 3. User Roles and Permissions

#### 3.1 Permission model

The system shall use two authorization scopes:

- **Platform scope:** permissions granted to a Platform Administrator for platform operations. They do not automatically confer membership in every business.
- **Tenant scope:** permissions granted through a membership linking a user to a specific business. A user's role and allowed actions may differ for each business.

Authentication identifies the user. Authorization verifies platform authority or an active membership in the tenant associated with the requested resource. A client-submitted tenant identifier is not proof of access. The detailed role-to-action matrix is TBD; role boundaries below are the baseline.

#### 3.2 Platform Administrator

May view registered businesses, manage tenant account records, monitor platform usage, suspend or activate businesses, and view platform-level analytics. These are basic platform administration capabilities and do not authorize unrestricted access to private tenant or customer data. Detailed tenant data access for support, impersonation, its approval process, and audit controls are TBD and must follow least privilege. All platform administration actions shall be separately authorized and auditable.

#### 3.3 Business Owner

Within a business where the user has an owner membership, may configure business settings and features, branches, services, staff, schedules, and operational policies; review the business's appointments, queues, and analytics included in scope; and manage memberships as defined by policy. An owner role in one business grants no authority in another business.

#### 3.4 Staff Member

Within assigned business/branch scope, may perform permitted operational work such as viewing relevant appointments and queue tickets and advancing a queue ticket through allowed lifecycle actions. Staff shall not automatically receive owner-only configuration, cross-branch, or customer-account administration privileges. Fine-grained staff permissions are TBD.

#### 3.5 Customer

May create and manage their own bookings and queue participation, and view their own relevant status. Guest customers may complete supported public flows without creating a persistent account, subject to verification and abuse-control rules to be decided. A registered customer account does not require a membership in each business where the customer books. A person may also act as staff or owner where they have the corresponding business membership. A customer shall not see another customer's private data.

#### 3.6 Multiple businesses and roles

A user may be a Business Owner in one business, a Staff Member in another, and a Customer in either or both. The system shall evaluate tenant-level permissions using the membership applicable to the specific business and request. Changing or removing a membership for one business shall not silently alter the user's roles in another business. Platform-level authority is evaluated independently.

### 4. Functional Requirements

Priority meanings: **Must Have** is required for MVP; **Should Have** is valuable and expected where practical but may be deferred by explicit scope decision; **Could Have** is optional and may be postponed. Each requirement defines the expected observable behavior; detailed interaction and API design can be specified later.

#### 4.1 Authentication and account management

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-AUTH-001 | Register and sign in | Business Owner, Staff Member, Customer | The system shall allow a user to create an account and authenticate using the identity method selected for MVP. | Must Have |
| FR-AUTH-002 | Protect credentials | All authenticated users | The system shall protect credential material and shall not return passwords or credential secrets in responses. | Must Have |
| FR-AUTH-003 | Sign out and session/token handling | All authenticated users | The system shall provide the selected sign-out and credential/session invalidation behavior. Exact token lifecycle is TBD. | Must Have |
| FR-AUTH-004 | Account recovery | All account holders | The system should provide a secure account recovery process using a verified channel. Channel and policy are TBD. | Should Have |
| FR-AUTH-005 | Guest identity | Guest Customer | The system shall support the approved guest booking and queue flows without requiring a registered customer account. Verification and retention rules are TBD. | Must Have |

#### 4.2 Business self-registration and onboarding

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-ONB-001 | Self-register business | Business Owner | An authenticated or registering owner shall be able to submit required business details and create a business tenant. | Must Have |
| FR-ONB-002 | Establish owner membership | Business Owner | On successful business creation, the initiating owner shall receive an owner membership for that business. | Must Have |
| FR-ONB-003 | Guided setup status | Business Owner | The system should indicate which setup information is incomplete and what is needed to make a branch bookable/queueable. | Should Have |
| FR-ONB-004 | Business profile maintenance | Business Owner | The owner shall be able to view and update permitted business profile information within the tenant. | Must Have |

#### 4.3 Multi-tenant management

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-TEN-001 | Scope business data | All tenant users | Reads and writes of business-owned resources shall be constrained to a business the actor is authorized to access. | Must Have |
| FR-TEN-002 | Resolve authorization from membership | Business Owner, Staff Member | The backend shall determine tenant authority from authenticated identity and membership, not a client-supplied tenant identifier. | Must Have |
| FR-TEN-003 | Switch business context | User with multiple memberships | The user shall be able to select among businesses for which they have access; each action shall use the selected business's membership role. | Must Have |
| FR-TEN-004 | Isolate tenant data | Platform Administrator, tenant users | Tenant data shall not be exposed or modified across business boundaries through APIs, searches, exports, or real-time channels. | Must Have |
| FR-TEN-005 | Manage memberships | Business Owner | An authorized owner shall be able to add or remove business memberships as permitted by the finalized invitation and removal policy. | Should Have |

#### 4.4 Business feature configuration

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-FEAT-001 | Configure supported features | Business Owner | The owner shall be able to configure tenant-controlled settings for appointments, walk-in queue, staff selection, service selection, guest booking, customer accounts, notifications, and multiple branches, subject to platform support and applicable policy. | Must Have |
| FR-FEAT-002 | Enforce features on backend | All users | The backend shall validate the effective tenant-controlled setting before every operation it governs. Guest booking and customer accounts are independent settings; disabling one shall not implicitly disable the other. | Must Have |
| FR-FEAT-003 | Communicate unavailable actions | Customer, Staff Member, Business Owner | When a feature is disabled or unavailable, the application shall present an understandable explanation and avoid implying the operation succeeded. | Should Have |

#### 4.5 Branch management

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-BR-001 | Create branch | Business Owner | An owner shall create a branch under the current business with required identifying and location details. | Must Have |
| FR-BR-002 | Configure branch timezone and hours | Business Owner | An owner shall set an IANA timezone and operating hours for a branch; invalid or missing timezone data shall be rejected. | Must Have |
| FR-BR-003 | Update or deactivate branch | Business Owner | An owner shall update branch details or deactivate a branch subject to rules protecting existing bookings and queue activity. Exact deactivation behavior is TBD. | Should Have |
| FR-BR-004 | Select branch | Customer, Staff Member, Business Owner | Users shall be able to select or resolve an active branch for supported booking and queue operations. | Must Have |

#### 4.6 Service management

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-SVC-001 | Create and maintain service | Business Owner | An owner shall create, view, update, and deactivate a business service with its name and required operational details. | Must Have |
| FR-SVC-002 | Configure service availability | Business Owner | An owner shall associate a service with eligible branches and, where applicable, staff and booking/queue capabilities. | Must Have |
| FR-SVC-003 | Publish eligible service choices | Customer | The booking or queue flow shall list only active services available at the selected branch and enabled for the requested flow. | Must Have |
| FR-SVC-004 | Define duration and buffers | Business Owner | An owner shall configure service duration and any supported buffer policy used for availability. Buffer policy details are TBD. | Must Have |

#### 4.7 Staff management

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-STAFF-001 | Add staff member | Business Owner | An owner shall associate an existing or invited user with a business as staff, subject to the membership policy. | Must Have |
| FR-STAFF-002 | Assign staff scope | Business Owner | An owner shall assign staff to permitted branches and services; staff views and actions shall respect those assignments. | Must Have |
| FR-STAFF-003 | Update or remove staff membership | Business Owner | An owner shall change or end a staff membership, subject to protection of audit history and existing work. | Should Have |
| FR-STAFF-004 | Staff operational identity | Staff Member | The system shall identify the staff member responsible for an appointment or queue action when that information is collected. | Should Have |

#### 4.8 Staff schedules and working hours

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-SCH-001 | Configure working schedule | Business Owner | An owner shall configure recurring working hours for applicable branches, services, or staff. Exact schedule granularity is TBD. | Must Have |
| FR-SCH-002 | Configure exceptions | Business Owner | The system should support date-specific closures or availability exceptions used to prevent inappropriate offered times. | Should Have |
| FR-SCH-003 | Display local operating time | Customer, Staff Member | Schedule input and display shall be interpreted in the branch IANA timezone and persisted as UTC instants where an instant is represented. | Must Have |

#### 4.9 Appointment booking

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-APT-001 | Find bookable appointment times | Customer | The system shall present available times for an active branch/service using configured schedules, duration, and existing reservations. | Must Have |
| FR-APT-002 | Book as guest or account holder | Customer | A customer shall be able to submit an appointment request as a guest or authenticated user with the required customer and booking details. | Must Have |
| FR-APT-003 | Confirm appointment | Customer | The system shall create and return a booking confirmation only after the reservation is successfully committed. | Must Have |
| FR-APT-004 | Prevent overlapping reservations | All users | The system shall detect overlapping time intervals, including for variable-duration services, and ensure two reservations do not consume the same incompatible capacity simultaneously, including under concurrent requests. Capacity may be staff-specific, service/resource-based, or hybrid; the product owner has not selected a model. | Must Have |
| FR-APT-005 | View own appointment | Customer | An authenticated customer or a guest using the approved verification method shall be able to retrieve only their own appointment information. | Must Have |
| FR-APT-006 | Manage appointment status | Business Owner, Staff Member | Authorized business users shall be able to view and update appointments within their tenant and assigned operational scope. | Must Have |

#### 4.10 Appointment cancellation and rescheduling

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-APT-007 | Cancel appointment | Customer, Business Owner, Staff Member | An authorized actor shall cancel an eligible appointment; the system shall record the state change and update availability. Cancellation window and reason policy are TBD. | Must Have |
| FR-APT-008 | Reschedule appointment | Customer, Business Owner, Staff Member | An authorized actor should move an eligible appointment to an available time without creating a conflicting reservation. | Should Have |
| FR-APT-009 | Communicate booking changes | Customer | The system shall show the resulting appointment state and any configured confirmation or cancellation information. External delivery channel is TBD. | Must Have |

#### 4.11 QR code generation

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-QR-001 | Generate branch queue QR entry point | Business Owner | An owner shall obtain a QR code or printable representation that directs customers to the intended active branch queue flow. | Must Have |
| FR-QR-002 | Protect QR-linked access | All users | The QR destination shall expose only information needed to start the public flow and shall not grant access to private tenant or customer data. | Must Have |
| FR-QR-003 | Revoke or rotate QR access | Business Owner | The system should allow invalidation or rotation of a sensitive QR-linked token when required. Token lifecycle details are TBD. | Should Have |

#### 4.12 Walk-in queue joining

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-QUEUE-001 | Join queue from QR flow | Guest Customer, Customer | A customer shall be able to open the branch QR destination, select an available queue/service where needed, provide required details, and request a ticket. | Must Have |
| FR-QUEUE-002 | Join as guest or account holder | Customer | Queue entry shall support guest and authenticated customers without exposing customer details to other queue participants. | Must Have |
| FR-QUEUE-003 | Reject unavailable queue | Customer | The system shall clearly reject queue entry when the branch or relevant queue is closed, disabled, or otherwise unable to accept entries. | Must Have |
| FR-QUEUE-004 | Prevent duplicate or abusive entry | Customer | The system should apply the approved duplicate-entry and abuse-control policy. Limits and verification rules are TBD. | Should Have |

#### 4.13 Queue ticket management

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-QUEUE-005 | Allocate ordered ticket | Customer | On successful queue join, the system shall allocate a queue sequence atomically within the correct branch and queue scope and return a ticket reference. | Must Have |
| FR-QUEUE-006 | View operational queue | Staff Member, Business Owner | Authorized business users shall see the active queue and the information needed to serve it, scoped to their membership and branch assignments. | Must Have |
| FR-QUEUE-007 | Advance ticket lifecycle | Staff Member, Business Owner | Authorized users shall manage a ticket using the initial status vocabulary WAITING, CALLED, SERVING, COMPLETED, NO_SHOW, and CANCELLED. Allowed transitions and exceptional transitions remain TBD. | Must Have |
| FR-QUEUE-008 | Record ticket actions | Staff Member, Business Owner | The system shall record relevant queue state changes and their timestamps; actor attribution is required where an authenticated actor performs the action. | Must Have |
| FR-QUEUE-009 | Skip or recall ticket | Staff Member, Business Owner | The system's policy for skipping or recalling a ticket requires further specification; this requirement does not establish a transition or authorize either action before that policy is approved. | Should Have |

#### 4.14 Live queue tracking

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-LIVE-001 | Subscribe to own queue status | Customer | A customer shall be able to view the current status of their queue ticket using an approved, limited-access reference. | Must Have |
| FR-LIVE-002 | Publish queue changes in real time | Customer, Staff Member, Business Owner | Authorized clients shall receive timely Socket.IO updates when relevant queue state changes occur. | Must Have |
| FR-LIVE-003 | Scope real-time delivery | All users | The backend shall authenticate or otherwise validate subscriptions and scope each event to the correct business, branch, queue, and permitted audience. | Must Have |
| FR-LIVE-004 | Recover from lost connection | Customer, Staff Member, Business Owner | On connection loss or missed events, the client shall be able to retrieve current authorized state and resume updates without assuming events were received. | Must Have |

#### 4.15 Customer notifications

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-NOTIF-001 | Show in-product booking and queue status | Customer | The system shall show booking confirmation and current queue status in the relevant web flow. | Must Have |
| FR-NOTIF-002 | Send external notifications | Customer | The system could send confirmations or reminders through a selected provider/channel if approved. Provider, channel, consent, and delivery scope are TBD. | Could Have |
| FR-NOTIF-003 | Control notification content | Business Owner, Customer | If external notifications are introduced, content and recipient selection shall avoid disclosing unnecessary sensitive information. | Should Have |

#### 4.16 Owner dashboard

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-DASH-001 | View business operations summary | Business Owner | An owner shall view current or selected-period appointments and queue activity for authorized branches. Exact metrics and filters are TBD. | Must Have |
| FR-DASH-002 | Navigate setup and operations | Business Owner | The dashboard shall provide access to authorized business setup and operational functions. | Must Have |

#### 4.17 Staff dashboard

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-DASH-003 | View assigned work | Staff Member | Staff shall see appointments and queues relevant to their authorized business and branch/service assignments. | Must Have |
| FR-DASH-004 | Perform queue and appointment actions | Staff Member | The dashboard shall expose only actions permitted by the staff member's current membership and assignments. | Must Have |

#### 4.18 Customer portal

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-PORT-001 | Review own appointments | Customer | An authenticated customer shall be able to see their own upcoming and prior appointments within the retention policy. | Should Have |
| FR-PORT-002 | Review own queue tickets | Customer | A customer shall be able to retrieve current ticket status through an authenticated account or approved guest reference. | Must Have |
| FR-PORT-003 | Update own profile | Customer | An authenticated customer should be able to update permitted profile details. Exact fields and verification rules are TBD. | Could Have |

#### 4.19 Analytics

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-AN-001 | View basic operational counts | Business Owner | The owner shall be able to review agreed basic appointment and queue counts for the business and authorized branches, scoped to that business. Metric definitions and date-range semantics are TBD. | Must Have |
| FR-AN-002 | Scope business analytics by tenant | Business Owner | Business analytics shall be scoped to the requesting owner's authorized business and shall not include another tenant's data. | Must Have |
| FR-AN-003 | Monitor platform usage and analytics | Platform Administrator | The platform administrator shall be able to monitor platform usage and review platform-level analytics for platform operations, with detail and aggregation levels defined by policy. This does not authorize unrestricted private tenant/customer data access. | Must Have |

#### 4.20 Platform administration

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-ADMIN-001 | View registered businesses | Platform Administrator | The system shall allow an authorized platform administrator to view registered business accounts and their platform-level status. | Must Have |
| FR-ADMIN-002 | Manage tenant activation | Platform Administrator | The system shall allow an authorized platform administrator to manage tenant account records and suspend or activate a business, with action auditability. Detailed suspension effects are TBD. | Must Have |
| FR-ADMIN-003 | Protect tenant operations from global role leakage | Platform Administrator | Platform-level privileges shall not be treated as tenant owner membership; tenant actions shall use explicit, auditable platform policy where allowed. Sensitive support access policy is TBD. | Must Have |

#### 4.21 Audit logging

| ID | Description | Relevant actor | Expected behavior | Priority |
|---|---|---|---|---|
| FR-AUD-001 | Record security-sensitive actions | Business Owner, Staff Member, Platform Administrator | The system shall record significant authorization, membership, configuration, and operational state changes with actor, tenant context where applicable, action, and time. | Must Have |
| FR-AUD-002 | Restrict audit access | Business Owner, Platform Administrator | Audit records shall be readable only by roles with an approved need and shall not be editable through ordinary application flows. Retention and visibility policy are TBD. | Must Have |
| FR-AUD-003 | Avoid sensitive audit content | All users | Audit logs shall not contain passwords, plaintext sensitive tokens, or unnecessary private customer details. | Must Have |

### 5. Detailed User Workflows

These workflows describe expected outcomes. Screens, exact field lists, and policy branches remain subject to design and Section 16 decisions.

#### 5.1 Business owner registration and onboarding

1. The prospective owner opens the web application and creates or signs into a user account.
2. The owner submits the required business profile information.
3. The backend validates the input and creates a business tenant.
4. The system creates an owner membership linking the initiating user to that tenant.
5. The owner enters the business context and is guided through required setup, including at least one branch and a service before public booking or queue entry can be enabled.
6. The system indicates setup completion and the capabilities currently enabled for the tenant.

#### 5.2 Branch and service creation

1. An owner selects the intended business context.
2. The owner creates a branch and supplies the required name, location details, IANA timezone, and operating hours.
3. The backend validates tenant authority and branch data, then saves the branch within the selected tenant.
4. The owner creates a service, enters the service details and duration, and selects eligible branches and supported booking/queue modes.
5. The backend validates the feature settings and associations before saving.
6. The owner reviews whether the branch/service combination is ready to offer to customers, including the tenant-controlled feature settings. Guest booking and customer accounts can be configured independently.

#### 5.3 Staff configuration

1. An owner selects a business and branch context.
2. The owner selects an existing user or follows the approved staff invitation process.
3. The owner creates a staff membership and assigns permitted branches and services.
4. The owner configures or confirms staff working hours and applicable exceptions.
5. The staff member authenticates and sees only assigned work and permitted actions.
6. Changes to membership or assignments take effect according to the approved session and effective-date policy.

#### 5.4 Customer appointment booking

1. The customer selects a business/branch, either directly or through a business-provided link.
2. The customer selects a service and an available appointment time.
3. The system computes availability using branch hours, applicable staff schedules, service duration/buffers, exceptions, and existing reservations.
4. The customer provides required contact and booking details as a guest or signs into an account.
5. The backend validates the request and attempts to reserve the chosen capacity atomically. The applicable capacity model (staff-specific, service/resource capacity, or hybrid) remains undecided; the system must detect overlapping intervals, including variable-duration services, against incompatible capacity.
6. If the slot is no longer available, the system explains that and offers refreshed availability; otherwise it confirms the appointment.
7. The customer can retrieve their own appointment details using the approved account or guest verification method.

#### 5.5 Appointment cancellation

1. The customer locates the appointment using an authenticated account or the approved guest verification method; alternatively, an authorized business user locates it in the tenant workspace.
2. The system checks actor permission, appointment status, and the cancellation policy.
3. The actor confirms cancellation where required.
4. The backend changes the appointment state, records the action, and updates availability consistently. Which appointment states consume capacity is a future policy decision and remains TBD.
5. The customer sees the resulting status and any configured confirmation information.

#### 5.6 Customer joining a queue using QR

1. The customer scans the QR code displayed by a business at a branch.
2. The device opens a public web page identifying the relevant business/branch and available queue options without exposing private records.
3. The customer selects a service/queue if required and enters the minimum required details as a guest or signed-in user.
4. The backend checks branch and tenant feature availability, validates input, and applies abuse/duplicate-entry rules.
5. The system atomically allocates a sequence and creates a queue ticket.
6. The customer receives a limited-access ticket reference and current status.

#### 5.7 Customer tracking queue position

1. The customer opens the ticket status link or retrieves the ticket through their account.
2. The backend verifies the approved ticket access method and returns only the information allowed for that customer.
3. The page shows ticket status from the initial vocabulary (WAITING, CALLED, SERVING, COMPLETED, NO_SHOW, CANCELLED), position or other approved progress indicators, and any estimate if the business supports it.
4. Socket.IO delivers authorized updates while connected.
5. After a disconnect, the client fetches current status and resumes updates; it does not rely on receiving every prior event.

#### 5.8 Staff calling and serving customers

1. A staff member signs in and selects an authorized business/branch context.
2. The staff dashboard displays the active queue within the member's assignment scope.
3. The staff member selects an eligible WAITING ticket and invokes the call action; if allowed by the eventual transition policy, the ticket moves to CALLED.
4. The backend verifies authorization and ticket state, records the transition, and publishes a privacy-safe update to authorized subscribers.
5. The staff member marks the customer as serving when service begins, moving the ticket to SERVING if that transition is allowed by the final lifecycle policy.

#### 5.9 Completing a queue ticket

1. An authorized staff member opens a ticket in a state eligible for completion.
2. The staff member records completion.
3. The backend validates the transition, stores its time and actor attribution, and updates the active queue state.
4. The system publishes the updated public-safe status and refreshes operational views.
5. The ticket remains available according to the approved business and audit retention policies.

#### 5.10 Managing multiple businesses

1. A user signs in and requests their accessible business list.
2. The system returns only businesses for which the user has an active membership or explicitly authorized platform scope.
3. The user selects a business; the application loads permissions for that membership.
4. The user performs an action within that business context.
5. The backend independently verifies the user's membership and role for the resource's actual tenant.
6. Switching context changes the tenant authorization context but does not carry permissions from the prior business.

### 6. Business Rules

| ID | Rule |
|---|---|
| BR-001 Tenant isolation | Every business-owned record is associated with a tenant. All reads, writes, searches, exports, and real-time events are tenant-scoped. A request's client-supplied tenant ID cannot grant access. |
| BR-002 Membership authorization | Tenant roles and permissions derive from a membership between a user and a business. A registered customer account identifies the person booking or joining a queue and does not require membership in each business. One user's role in one business does not imply a role in another; the same person may be both a customer and an owner or staff member where they hold the relevant membership. |
| BR-003 Global and tenant authority | Platform-level permissions and tenant membership permissions are distinct. Platform authority does not silently create owner membership or ordinary tenant access. |
| BR-004 Guest booking | Guest flows are supported for appointments and queues. The minimum collected information, identity verification, duplicate rules, lookup method, and retention period remain TBD. |
| BR-005 Feature enforcement | Initial tenant-controlled features are appointments, walk-in queue, staff selection, service selection, guest booking, customer accounts, notifications, and multiple branches. The backend validates the effective tenant setting before a controlled operation. Guest booking and customer accounts are independent settings; disabling either does not implicitly disable the other. |
| BR-006 Appointment availability and capacity | Offered times reflect applicable branch hours, service duration, schedules, exceptions, and existing reservations. The conceptual capacity model remains TBD: staff-specific reservations, service/resource capacity reservations, or a hybrid assignment. No option is selected by this SRS. |
| BR-007 Appointment conflict prevention | The system detects overlapping reservation intervals, including variable-duration services, and prevents two reservations from consuming the same incompatible capacity simultaneously, including under concurrent requests. Which appointment states consume capacity is a future policy decision and remains TBD. |
| BR-008 Queue sequence allocation | Sequence allocation is atomic and scoped to the applicable branch and queue. Parallel joins must not receive conflicting sequence assignments where uniqueness is required. Reset cadence and numbering presentation are TBD. |
| BR-009 Queue ticket lifecycle | Initial status vocabulary is WAITING, CALLED, SERVING, COMPLETED, NO_SHOW, and CANCELLED. Allowed transitions, recall, skipping, reopening, and other exceptional transitions require further specification and remain TBD. |
| BR-010 Waiting-time estimate | An estimate, if shown, is informational and shall be based on available queue/service data. Estimation method, confidence language, and whether MVP includes estimates are TBD. |
| BR-011 Branch time | Branch operating schedules use an IANA timezone. Persisted instants use UTC; local dates/times are interpreted with the branch timezone, including daylight-saving transitions where applicable. |
| BR-012 QR security | A QR code is a public entry point, not an authorization credential for private data. Sensitive QR-linked token material is stored as a hash, and rotation/revocation policy is TBD. |
| BR-013 Customer privacy | Public pages and queue events disclose only the minimum information needed to identify status, and do not reveal another customer's personal details. |
| BR-014 Auditability | Security-sensitive and important operational changes are attributable and timestamped, without placing secret or unnecessary personal data in audit records. |

### 7. Non-Functional Requirements

Targets not established by product decisions are explicitly TBD. These requirements define quality obligations without inventing SLAs.

#### 7.1 Security

- **NFR-SEC-001:** The backend shall authenticate protected operations and authorize each operation against platform permissions or the relevant tenant membership and assignment.
- **NFR-SEC-002:** Passwords shall be stored using a suitable one-way password hashing approach; authentication secrets shall never be returned to clients.
- **NFR-SEC-003:** All request data and relevant socket messages shall be validated server-side. Invalid input shall not be persisted or acted upon.
- **NFR-SEC-004:** Sensitive public tokens shall be generated securely, stored as hashes, scoped to intended use, and revocable according to an approved policy.
- **NFR-SEC-005:** The application shall apply protections against brute-force and abuse of authentication and public booking/queue endpoints. Exact limits and tuning are TBD.
- **NFR-SEC-006:** Secrets shall be supplied through environment configuration or an approved secrets manager and excluded from source control.
- **NFR-SEC-007:** Error responses and logs shall not expose credentials, internal stack traces, or unneeded private information.

#### 7.2 Performance

- **NFR-PERF-001:** The application shall provide usable responses for booking and queue operations under expected load. Numerical response-time targets and the expected load profile are TBD.
- **NFR-PERF-002:** Queue changes shall be delivered through the real-time channel promptly enough to support live operations. A numerical event-delivery target is TBD.
- **NFR-PERF-003:** Availability checks and tenant-scoped queries shall be designed to avoid unbounded retrieval of unrelated records. Quantitative query targets are TBD.

#### 7.3 Scalability

- **NFR-SCALE-001:** The modular monolith and data access patterns shall support growth in tenants, branches, staff, appointments, and queue tickets without weakening tenant isolation.
- **NFR-SCALE-002:** Real-time connection and event design shall permit capacity planning as concurrent users grow. Expected concurrency and scaling thresholds are TBD.

#### 7.4 Reliability and availability

- **NFR-REL-001:** Appointment reservation and queue sequence operations shall preserve consistency during concurrent requests and report failures without false success.
- **NFR-REL-002:** The system shall recover current authorized queue state after a client disconnect or missed real-time event.
- **NFR-AVAIL-001:** Availability objectives, maintenance windows, recovery time objective, and recovery point objective are TBD; no availability guarantee is established by this SRS.

#### 7.5 Maintainability

- **NFR-MAINT-001:** The backend shall be organized as a modular monolith with clear domain boundaries and separation of routes, controllers, services, models, and validators.
- **NFR-MAINT-002:** Business rules shall be implemented in maintainable, testable modules rather than duplicated in route handlers or frontend-only checks.
- **NFR-MAINT-003:** Architecture and API documentation shall be updated when those contracts change.

#### 7.6 Usability

- **NFR-USE-001:** Core owner, staff, and customer tasks shall provide clear success, error, and next-step feedback.
- **NFR-USE-002:** Customer booking and QR queue flows shall work in a responsive web layout suitable for mobile browsers.
- **NFR-USE-003:** The application shall distinguish local branch time from stored/system time in user-facing scheduling flows.

#### 7.7 Accessibility

- **NFR-ACC-001:** Interactive web controls shall be operable with keyboard input and have programmatically determinable labels and state.
- **NFR-ACC-002:** Status and errors shall not rely on color alone and shall be available to assistive technologies.
- **NFR-ACC-003:** The conformance target (for example, a WCAG version and level) is TBD.

#### 7.8 Compatibility

- **NFR-COMP-001:** The web application shall support the agreed modern desktop and mobile browser matrix. Exact browser versions are TBD.
- **NFR-COMP-002:** QR links shall open a standard web flow without requiring a native application. Camera/QR scanning compatibility depends on device and browser capabilities.

#### 7.9 Data integrity

- **NFR-DATA-001:** Tenant ownership, membership relations, appointment states, and queue ticket states shall be validated consistently by the backend.
- **NFR-DATA-002:** Uniqueness constraints shall be used where required to prevent duplicate identities, memberships, reservation conflicts, sequence allocation conflicts, or token records; exact indexes follow detailed design.
- **NFR-DATA-003:** System timestamps shall be stored in UTC; branch timezone identifiers shall be stored and validated as IANA identifiers.
- **NFR-DATA-004:** Retention, deletion, backup, restore, and data export policies are TBD.

#### 7.10 Privacy

- **NFR-PRIV-001:** Customer personal information shall be visible only to actors with a defined need and authorization.
- **NFR-PRIV-002:** Public endpoints and real-time events shall use privacy-safe payloads and reveal no other customer's private information.
- **NFR-PRIV-003:** Applicable jurisdictions, legal basis, consent requirements, data residency, and privacy request handling are TBD and require product/legal review before launch.

### 8. External Interface Requirements

#### 8.1 Frontend interfaces

The web frontend shall provide role-appropriate interfaces for business onboarding and configuration, staff operations, customer booking, guest queue entry, and queue tracking. It shall present only actions and information appropriate to the current authenticated identity, selected business context, membership, and public flow. UI hiding is not a substitute for backend authorization.

#### 8.2 Backend REST APIs

The React frontend shall communicate with the Express backend through documented REST APIs for account, business, branch, service, staff, schedule, appointment, queue, and dashboard operations. Exact endpoint paths, versioning, pagination, error format, and API schema are TBD. The backend shall validate request parameters and enforce authentication, authorization, tenant scoping, and business rules for each operation.

#### 8.3 MongoDB interaction

The backend shall access MongoDB through Mongoose. Persistence structures and indexes will be finalized in a separate design stage. Database interactions shall preserve tenant scoping, uniqueness, and concurrency-sensitive booking and queue behavior. Database credentials and connection details shall be managed as secrets/configuration, not embedded in source code.

#### 8.4 Socket.IO communication

Socket.IO shall be used for real-time queue updates. Connection authentication, public ticket access, room naming, event schema, reconnection policy, and authorization details are design TBDs. Every subscription and emitted payload shall be scoped and privacy-reviewed; clients shall be able to fetch current state after reconnecting.

#### 8.5 QR code interaction

The system shall provide a QR representation that resolves to a public web entry point for the intended branch queue flow. QR content shall not embed private customer data or grant general tenant access. QR format, printable layout, token expiration, rotation, and revocation UX are TBD.

#### 8.6 Future notification integrations

The architecture may later support external notification providers for confirmation or reminders. No provider, channel, delivery SLA, consent model, or notification integration is committed for MVP. WhatsApp integration is explicitly out of scope.

### 9. Data Requirements

This section identifies conceptual entities and relationships only; it does not finalize schemas, field types, indexes, or collection names.

| Entity | Requirements-level purpose and relationships |
|---|---|
| User | Represents an account holder and, for a registered customer, the person's identity across booking and queue flows. May have memberships in multiple businesses and may also act as an owner or staff member. A customer booking at a business does not itself require a membership there. Authentication data is protected separately from public profile information. |
| Business (tenant) | Represents an independently managed organization. Owns branches, services, settings, memberships, and related operational data. |
| Membership | Links one user to one business and assigns tenant-level role/permissions and status. A user may have multiple memberships. |
| Branch | Belongs to one business and has location, IANA timezone, operating hours, and service/staff associations. |
| Feature settings | Belong to or are effective for a business and define enabled platform capabilities subject to backend validation. Whether settings can vary by branch is TBD. |
| Service | Belongs to a business and may be offered at selected branches and by eligible staff; contains booking/queue and duration configuration. |
| Staff assignment and schedule | Relates a staff membership to branches/services and defines availability and exceptions. Exact schedule model is TBD. |
| Customer profile | Holds customer details needed for account or business interactions and may be linked to bookings without a business membership, subject to privacy and retention policy. Guest identity handling and duplicate-profile handling are TBD. |
| Appointment | Associates a customer/guest, business, branch, service, time, and optionally staff; has status and lifecycle history. Tenant ownership is required. |
| Queue configuration | Represents an operational queue scope associated with a business/branch and possibly service. Queue reset and numbering policy are TBD. |
| Queue ticket | Associates customer/guest with the queue and sequence, status, timestamps, and relevant service details. Tenant ownership is required. |
| Public access token | Supports limited access to a public flow or customer's own status. Sensitive token values are represented by hashes and have defined scope/lifecycle. |
| Audit event | Records important security/configuration/operational changes, actor, tenant context where applicable, action, and UTC time, without unnecessary sensitive content. |

All business-owned entities and records shall be tenant-scoped, including indirect relationships. Relationships crossing tenant boundaries shall be rejected unless a specifically approved platform-level operation applies.

### 10. Security and Privacy Requirements

1. **Authentication:** Protected operations require a valid authenticated identity. Credential storage, recovery, token/session expiry, revocation, and multi-factor policy require detailed policy decisions; passwords shall not be stored in plaintext.
2. **Authorization:** The backend shall verify the actor's platform permission or tenant membership and role for every protected operation. Branch and service assignments further constrain staff actions where applicable.
3. **Tenant isolation:** The backend shall derive tenant authority from authenticated context and membership. Client-supplied tenant identifiers may select context but cannot establish authority. Queries, writes, exports, and socket subscriptions shall be tenant-scoped.
4. **Secure tokens:** Sensitive public tokens shall be generated using a secure random source, stored as hashes, limited in scope, protected against guessing, and revocable under an approved policy. Plaintext secrets shall not be logged.
5. **Public endpoint protection:** Public booking and queue flows shall return only required public information, validate all input, and apply abuse controls. Public queue status shall not reveal private details about other customers.
6. **Request and event validation:** REST input and relevant Socket.IO messages shall be validated server-side. Invalid or unauthorized requests shall be rejected consistently.
7. **Error and logging controls:** Centralized error handling shall produce safe client messages. Logs and audit events shall exclude passwords, raw tokens, API keys, and unnecessary customer data.
8. **Auditability:** Sensitive membership, configuration, appointment, and queue changes shall be attributable and timestamped according to approved access and retention rules.
9. **Privacy governance:** Data minimization, purpose, consent, retention/deletion, access requests, legal jurisdiction, and breach response policies remain open decisions and must be established before production launch.

### 11. MVP Scope

The initial MVP shall include the following capability set, subject to resolution of the TBDs that block safe implementation:

- User account registration and authentication sufficient for owners and operational users.
- Business owner self-registration and creation of a tenant with an owner membership.
- Tenant isolation and membership-based, business-specific authorization.
- Business profile, branch, branch timezone/hours, service, and basic staff configuration.
- Tenant-controlled feature settings for appointments, walk-in queue, staff selection, service selection, guest booking, customer accounts, notifications, and multiple branches, validated by the backend. Guest booking and customer accounts are independent.
- Staff working schedules sufficient to determine appointment availability.
- Customer appointment discovery and booking as guest or registered user.
- Appointment confirmation, customer/authorized business viewing, and cancellation; rescheduling is a Should Have pending scope confirmation.
- Branch-specific QR entry point for walk-in queue joining as guest or registered user.
- Queue ticket creation with atomic sequence allocation, staff queue operation, and the initial status vocabulary WAITING, CALLED, SERVING, COMPLETED, NO_SHOW, and CANCELLED. Allowed transitions and exceptional transitions remain TBD.
- Customer queue status page and privacy-safe real-time Socket.IO updates, with recovery by fetching current state.
- Basic role-appropriate owner, staff, and customer web views needed to complete the above workflows.
- Essential security-sensitive audit logging.
- Basic, business-scoped operational analytics for agreed appointment and queue counts (Must Have); metric definitions remain TBD.
- Basic platform administration: viewing registered businesses, managing tenant accounts, monitoring platform usage, suspending/activating businesses, and viewing platform-level analytics. This does not grant unrestricted access to private tenant/customer data; sensitive support-access policy is TBD.

External email/SMS delivery, advanced support tooling, detailed invitations, and advanced staff permissions need explicit scope decisions. Basic platform administration and basic operational analytics are MVP requirements. Advanced analytics, forecasting, and cross-business intelligence are out of scope. Priorities in Section 4 are the per-requirement baseline.

### 12. Out-of-Scope Features

The following are explicitly excluded from the MVP:

- Online payments.
- SaaS subscription billing.
- WhatsApp integration.
- AI scheduling.
- Advanced analytics, forecasting, and cross-business intelligence.
- Native mobile applications.
- Advanced marketing.
- Complex resource management (for example, sophisticated room, equipment, or shared-resource scheduling beyond the defined appointment capacity model).

These exclusions do not prevent future consideration through a separately approved scope change.

### 13. Acceptance Criteria

The MVP may be considered successful when high-level acceptance testing demonstrates all of the following:

1. A new owner can register, create a business, receive the corresponding owner membership, and complete required branch/service setup.
2. A user with memberships in two businesses can act in each business according to that membership, and cannot use one membership to access the other's tenant data.
3. Attempts to access tenant resources using an unauthorized or forged client-supplied tenant identifier are rejected without disclosing the resource.
4. An owner can create a branch with a valid IANA timezone, configure a service and staff, and make eligible availability visible to a customer.
5. A guest and an authenticated customer can each complete an appointment booking flow when the corresponding tenant feature is enabled; guest booking and customer accounts can be disabled independently. Invalid or stale availability does not result in conflicting successful reservations, including variable-duration overlap and concurrent requests against incompatible capacity.
6. Authorized customers and business users can cancel appointments according to the implemented policy, and released availability is reflected correctly.
7. A customer can scan/open a branch QR destination, join an enabled walk-in queue, and receive a ticket; disabled or closed queue entry is rejected clearly.
8. Concurrent queue joins preserve the approved unique/order guarantees for sequence allocation.
9. Authorized staff can call and complete tickets using the initial status vocabulary WAITING, CALLED, SERVING, COMPLETED, NO_SHOW, and CANCELLED and the approved transition rules; unauthorized actors and invalid transitions are rejected.
10. A queue status change reaches authorized connected clients through Socket.IO without exposing private information about other customers; reconnecting clients can retrieve current status.
11. Backend validation rejects malformed or unsupported inputs for the tested flows, and safe errors are returned without secrets or stack traces.
12. Sensitive tokens are not stored or logged in plaintext, and audit records exist for the agreed sensitive actions without unnecessary private content.
13. Core customer flows are usable on the agreed mobile and desktop browser matrix and pass the agreed accessibility criteria once selected.
14. Owners can review agreed appointment and queue counts scoped to their business, and platform administrators can view registered businesses, manage tenant activation, monitor usage, and review approved platform analytics without unrestricted private tenant/customer data access.
15. The initial queue statuses are WAITING, CALLED, SERVING, COMPLETED, NO_SHOW, and CANCELLED; implemented actions follow the approved transition policy, while unspecified exceptional transitions remain unavailable until defined.
16. All acceptance tests, security checks, and other release gates are defined and executed before release; numerical performance and availability gates remain TBD until approved.

### 14. Risks and Constraints

| Risk / constraint | Potential impact | Requirement/design response |
|---|---|---|
| Tenant scoping omissions | Cross-business data exposure or modification | Centralize and test tenant-aware authorization and data access; treat tenant isolation as a release-critical acceptance area. |
| Concurrent reservation requests | Double booking or inconsistent availability | Define constrained capacity precisely and use an atomic persistence strategy; test competing requests. |
| Concurrent queue joins | Duplicate, missing, or misordered sequence numbers | Allocate sequence atomically in the correct branch/queue scope and test contention. |
| Unclear business scheduling models | Incorrect availability across services, staff, or locations | Resolve capacity, staff assignment, duration/buffer, holidays, and timezone rules before finalizing scheduling design. |
| Guest access and public tokens | Account enumeration, ticket disclosure, or abuse | Minimize guest data, use hashed scoped tokens, establish verification, expiry, rotation, and rate-limit policies. |
| Real-time authorization | Cross-tenant event leakage or stale customer information | Authorize connections/subscriptions, minimize payloads, and support authoritative state refetch after reconnect. |
| Timezone and daylight-saving transitions | Customer sees incorrect local time or conflicting slot | Use IANA branch timezones and define how ambiguous/nonexistent local times are handled. |
| External delivery dependency | Notifications may be delayed or unavailable | External providers are not committed for MVP; define behavior and delivery expectations if later added. |
| Unspecified scale and hosting | Inability to size infrastructure or set operational targets | Establish expected tenants, traffic, concurrent sockets, hosting region, and recovery targets before production readiness. |
| Privacy/legal obligations unknown | Product may not meet applicable jurisdictional obligations | Identify launch jurisdictions and establish legal, consent, retention, deletion, and data residency requirements before launch. |
| Scope breadth across industries | Domain workflows may diverge and expand MVP | Keep initial workflows configurable but bounded; approve industry-specific variations separately. |

### 15. Future Enhancements

Capabilities below are postponed or conditional and are not MVP commitments:

- Online payment collection, refunds, and payment-provider integrations.
- SaaS subscription plans, metering, and billing administration.
- WhatsApp, SMS, email, push, or other external notification integrations beyond any separately approved basic channel.
- AI-assisted scheduling or demand forecasting.
- Advanced analytics, exports, and cross-branch business intelligence.
- Native iOS and Android applications.
- Marketing campaigns, promotions, loyalty, and customer engagement tools.
- Complex shared-resource scheduling for rooms, equipment, vehicles, or other capacity units.
- Advanced platform support tooling, including workflows for sensitive tenant/customer data access; exact support-access policy remains TBD. Basic tenant management, activation/suspension, usage monitoring, and platform-level analytics remain in MVP.
- Advanced membership invitations, granular staff permissions, and branch-specific feature settings.

### 16. Open Questions and TBD Items

These items require product, operational, or legal decisions. They are not silently assumed by this SRS.

1. **Account identity:** Which sign-in identifiers are required (email, phone, or both)? Is email/phone verification required before booking or business activation?
2. **Authentication policy:** What are session/token expiry, refresh, revocation, password recovery, MFA, and account lockout requirements?
3. **Guest verification:** What minimum details are collected, how does a guest retrieve/cancel a booking or access queue status, and how long do guest records and access tokens remain valid?
4. **Business onboarding:** Is a newly created business immediately active, or is verification/approval required? Which profile fields are mandatory?
5. **Membership lifecycle:** How are staff invited, accepted, removed, and transferred? Can a business have multiple owners, and what prevents removal of its last owner?
6. **Permission detail:** What precise actions belong to owner, staff, and platform-admin roles? Are staff permissions branch-specific, service-specific, or configurable?
7. **Platform administration:** Which platform functions are required in MVP, and under what audited support-access policy may an administrator inspect tenant data?
8. **Feature settings:** Which features are configurable in MVP? Are settings business-wide or branch-specific? Are there plan/entitlement restrictions later?
9. **Branch/service model:** Which branch location fields are required? Can a service have different durations, prices, or queue rules by branch? (Price capture does not imply online payment.)
10. **Scheduling capacity:** Which conceptual model is approved: staff-specific reservations, service/resource capacity reservations, or hybrid assignment? How are incompatible capacities determined, and how are buffers, parallel capacity, holidays, breaks, and exceptions modeled? Overlapping intervals, including variable-duration services, must be detected. Which appointment states consume capacity remains a future policy decision.
11. **Appointment policy:** What booking horizon, minimum notice, cancellation cutoff, late/no-show handling, rescheduling rules, and confirmation status apply?
12. **Queue model:** Is there one queue per branch, per service, or configurable queues? What are opening/closing rules, pause behavior, reset cadence, numbering format, and duplicate-entry limits?
13. **Queue lifecycle:** Which states and transitions are mandatory? Can tickets be skipped, recalled, transferred, reopened, or marked no-show, and who can do so?
14. **Waiting estimates:** Are estimates required for MVP? If shown, what calculation and wording should be used, and how should uncertainty be represented?
15. **QR/token policy:** Are QR codes static or rotatable? Do customers need ticket tokens, branch tokens, or both? What are expiry, revocation, and printed-code replacement rules?
16. **Notifications:** Are email or SMS confirmations/reminders required for MVP? Which provider, consent rules, delivery failure handling, and cost constraints apply? WhatsApp remains out of scope.
17. **Analytics:** Which exact business-scoped appointment and queue counts are needed for basic MVP analytics, and what date-range and timezone semantics apply? Basic platform-level usage metrics are also required; advanced analytics, forecasting, and cross-business intelligence are out of scope.
18. **Audit and retention:** Which events are retained, for how long, who can view them, and how do deletion requests interact with audit integrity?
19. **Privacy and jurisdiction:** Which countries/regions are in the initial launch? What legal, consent, data residency, retention, export, and deletion obligations apply?
20. **Scale and operations:** What are expected tenant counts, bookings/queue joins per day, concurrent sockets, service regions, deployment provider, backup policy, RTO, and RPO?
21. **Quality targets:** What response-time, event-delivery, uptime, accessibility conformance, and supported-browser targets should be committed? These remain TBD; this SRS establishes no numeric SLA.
22. **API and error contract:** What API versioning, pagination, standard error shape, and public endpoint throttling policy are required?
23. **Customer identity model:** How are duplicate customer profiles or account merges handled? A registered customer account does not require membership in each business where the person books; memberships represent authorized business relationships. The same person may also be a staff member or owner through a separate membership.

Until these decisions are resolved, implementation should use only the approved requirements and should not infer policy where the choice affects privacy, authorization, booking correctness, or customer commitments.
