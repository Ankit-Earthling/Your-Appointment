import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import { api, businessCreationKey, jsonBody, API } from './lib/api.js';

const ownerNavigation = [
  { heading: null, items: [['overview', 'Overview']] },
  {
    heading: 'Business Management',
    items: [
      ['branches', 'Branches'],
      ['services', 'Services'],
      ['staff', 'Staff'],
    ],
  },
  {
    heading: 'Operations',
    items: [
      ['appointments', 'Appointments'],
      ['queue', 'Queue Management'],
      ['live-rooms', 'Live Rooms'],
      ['queue-activity', 'Activity Log'],
      ['customers', 'Customers'],
    ],
  },
  {
    heading: 'Insights and Settings',
    items: [
      ['analytics', 'Analytics'],
      ['settings', 'Business Settings'],
      ['public-booking', 'Public Booking Link'],
      ['queue-qr', 'QR Entry Links'],
    ],
  },
];
const staffNavigation = [
  {
    heading: null,
    items: [
      ['overview', 'My Overview'],
      ['appointments', 'My Appointments'],
      ['queue', 'My Queue'],
      ['customers', 'Customer Details'],
      ['schedule', 'My Schedule'],
    ],
  },
];
const weekdays = [1, 2, 3, 4, 5, 6];
const defaultHours = weekdays.map((dayOfWeek) => ({
  dayOfWeek,
  opensLocal: '09:00',
  closesLocal: '17:00',
}));

function roleBusinesses(businesses, role) {
  return businesses.filter((business) => business.membership.roles.includes(role));
}

function todayAt(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dateTime(value, timezone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}

function customerName(ticket) {
  const name =
    ticket.customerDisplayName ?? ticket.displayName ?? ticket.customerSnapshot?.displayName;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Guest customer';
}

function elapsedMinutes(start, end = Date.now()) {
  if (!start) return '—';
  const startTime = new Date(start).getTime();
  const endTime = typeof end === 'number' ? end : new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return '—';
  return `${Math.max(0, Math.floor((endTime - startTime) / 60000))} min`;
}

function queueStatusLabel(status) {
  return status?.replaceAll('_', ' ') ?? 'Unknown';
}

function ticketStaffLabel(ticket) {
  const staffByStatus = {
    CALLED: ['Called by', ticket.calledByUserId?.displayName],
    SERVING: ['Serving', ticket.servingStaffUserId?.displayName],
    COMPLETED: [
      'Served by',
      ticket.servingStaffUserId?.displayName ?? ticket.completedByUserId?.displayName,
    ],
    NO_SHOW: ['No-show marked by', ticket.noShowByUserId?.displayName],
    CANCELLED: [
      'Cancelled by',
      ticket.cancelledByUserId?.displayName ?? ticket.calledByUserId?.displayName,
    ],
  };
  const [label, name] = staffByStatus[ticket.status] ?? [];
  return name ? `${label}: ${name}` : '';
}

function statusClass(status) {
  const classes = {
    BOOKED: 'bg-blue-50 text-blue-700',
    WAITING: 'bg-amber-50 text-amber-800',
    CALLED: 'bg-violet-50 text-violet-700',
    SERVING: 'bg-emerald-50 text-emerald-700',
    COMPLETED: 'bg-slate-100 text-slate-700',
    CANCELLED: 'bg-rose-50 text-rose-700',
    NO_SHOW: 'bg-orange-50 text-orange-800',
  };
  return `inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${classes[status] ?? 'bg-slate-100 text-slate-700'}`;
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-700">{eyebrow}</p>
        )}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function Alert({ type = 'error', children }) {
  if (!children) return null;
  return (
    <div
      className={`mb-5 rounded-xl border px-4 py-3 text-sm ${type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
      role={type === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function PrimaryButton({ children, disabled, ...props }) {
  return (
    <button className="button-primary" disabled={disabled} {...props}>
      {children}
    </button>
  );
}

function SecondaryButton({ children, ...props }) {
  return (
    <button className="button-secondary" {...props}>
      {children}
    </button>
  );
}

function Input({ label, className = '', ...props }) {
  return (
    <label className={`field-label ${className}`}>
      {label}
      <input className="field-control" {...props} />
    </label>
  );
}

function Select({ label, children, className = '', ...props }) {
  return (
    <label className={`field-label ${className}`}>
      {label}
      <select className="field-control" {...props}>
        {children}
      </select>
    </label>
  );
}

export function LoadingView({ label = 'Loading your workspace' }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-5 py-10">
      <section className="surface w-full max-w-3xl p-6" role="status" aria-busy="true">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <div className="mt-5 grid animate-pulse gap-4 sm:grid-cols-3" aria-hidden="true">
          <div className="h-24 rounded-xl bg-slate-100" />
          <div className="h-24 rounded-xl bg-slate-100" />
          <div className="h-24 rounded-xl bg-slate-100" />
        </div>
        <div className="mt-4 h-40 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />
      </section>
    </main>
  );
}

export function LandingPage({ user }) {
  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-700 text-lg text-white">
            Y
          </span>
          Your Appointment
        </Link>
        <Link
          to={user ? '/customer/appointments' : '/auth?intent=customer'}
          className="text-sm font-semibold text-slate-700 hover:text-indigo-700"
        >
          {user ? 'My account' : 'Sign in'}
        </Link>
      </header>
      <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:pt-20">
        <div>
          <p className="inline-flex rounded-full border border-indigo-100 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800">
            Appointments and live queues
          </p>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.08] tracking-tight text-slate-950 sm:text-6xl">
            A calmer way to manage every visit.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
            Book a time, join a walk-in line, and keep your business team in sync from one simple
            workspace.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              className="button-primary inline-flex"
              to={user ? '/owner' : '/auth?intent=owner'}
            >
              {user ? 'Open business workspace' : 'Set up your business'}
            </Link>
            <Link
              className="button-secondary inline-flex"
              to={user ? '/customer/appointments' : '/auth?intent=customer'}
            >
              Customer sign in
            </Link>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl bg-indigo-700 p-7 text-white sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-indigo-200">
              One shared view
            </p>
            <p className="mt-4 max-w-md text-2xl font-semibold leading-8">
              See the day ahead, the next guest, and the work that’s already done.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl bg-white/10 p-3">Appointments</div>
              <div className="rounded-xl bg-white/10 p-3">Walk-ins</div>
              <div className="rounded-xl bg-white/10 p-3">Team</div>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <span className="text-sm font-semibold text-slate-500">For customers</span>
            <h2 className="mt-3 text-xl font-semibold">Choose a time or join the line.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Guest booking is available whenever the business enables it.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <span className="text-sm font-semibold text-slate-500">For teams</span>
            <h2 className="mt-3 text-xl font-semibold">Know what needs attention.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Owners and staff get separate workspaces based on their business role.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export function PublicQueueTicket() {
  const { ticketId } = useParams();
  const [ticket, setTicket] = useState(null),
    [error, setError] = useState(''),
    [profileSaved, setProfileSaved] = useState(false),
    [declined, setDeclined] = useState(false),
    [consent, setConsent] = useState(false);
  const token = decodeURIComponent(window.location.hash.slice(1));
  const refresh = useCallback(async () => {
    try {
      const result = await api(`/public/queue-tickets/${ticketId}`, {
        headers: { 'X-Public-Access-Token': token },
      });
      setTicket(result.ticket);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [ticketId, token]);
  useEffect(() => {
    if (token) refresh();
  }, [refresh, token]);
  useEffect(() => {
    if (!token) return;
    const socket = io(API.replace('/api/v1', ''), {
      path: '/api/socket.io',
      auth: { publicAccessToken: token },
    });
    socket.on('ticket.updated', refresh);
    socket.on('connect', refresh);
    return () => socket.disconnect();
  }, [token, refresh]);
  async function leave() {
    try {
      await api(`/public/queue-tickets/${ticketId}/leave`, {
        method: 'PATCH',
        headers: { 'X-Public-Access-Token': token },
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveProfile(event) {
    event.preventDefault();
    try {
      await api(`/public/queue-tickets/${ticketId}/profile`, {
        method: 'POST',
        headers: { 'X-Public-Access-Token': token },
        body: jsonBody({ consent: true }),
      });
      setProfileSaved(true);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <section className="surface mx-auto max-w-xl p-7 sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-700">
          Private queue ticket
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          {ticket?.service?.name ?? 'Your room queue'}
        </h1>
        <Alert>{error || (!token ? 'This secure link is missing its access token.' : '')}</Alert>
        {ticket && (
          <div className="mt-6 rounded-2xl bg-indigo-50 p-6">
            <p className="text-4xl font-semibold">
              {ticket.service?.name ?? 'Room'} · #{ticket.sequenceNumber}
            </p>
            <p className="mt-3">
              <span className={statusClass(ticket.status)}>{ticket.status}</span>
            </p>
            <p className="mt-3 text-sm">
              {ticket.branch?.name} · {ticket.peopleAhead} people ahead
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Joined {dateTime(ticket.joinedAt, ticket.branch?.timezone)}
            </p>
            {['WAITING', 'CALLED'].includes(ticket.status) && (
              <button className="button-danger mt-4" onClick={leave}>
                Leave queue
              </button>
            )}
          </div>
        )}
        {ticket?.status === 'COMPLETED' && !profileSaved && !declined && (
          <form className="mt-6 grid gap-3" onSubmit={saveProfile}>
            <p className="font-semibold">Save my details with this business for future visits.</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>I agree to save my visit details as a business-specific customer profile.</span>
            </label>
            <div className="flex gap-2">
              <PrimaryButton disabled={!consent}>Save my details</PrimaryButton>
              <button type="button" className="button-secondary" onClick={() => setDeclined(true)}>
                No thanks
              </button>
            </div>
          </form>
        )}
        {profileSaved && <p className="mt-4 text-sm text-emerald-800">Your profile was saved.</p>}
        {declined && <p className="mt-4 text-sm text-slate-600">No profile was created.</p>}
      </section>
    </main>
  );
}

export function AuthPage({ onAuthenticated }) {
  const location = useLocation();
  const intent = new URLSearchParams(location.search).get('intent') ?? 'customer';
  const [mode, setMode] = useState(intent === 'owner' || intent === 'staff' ? 'register' : 'login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(location.state?.error ?? '');
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email')).trim().toLowerCase();
    const password = String(values.get('password'));
    try {
      if (mode === 'register') {
        try {
          await api('/auth/register', {
            method: 'POST',
            body: jsonBody({ displayName: values.get('displayName'), email, password }),
          });
        } catch (registrationError) {
          if (registrationError.code !== 'EMAIL_ALREADY_REGISTERED') throw registrationError;
          setMode('login');
          setMessage('An account already exists for this email. Sign in to continue.');
          setBusy(false);
          return;
        }
      }
      const { user } = await api('/auth/login', {
        method: 'POST',
        body: jsonBody({ email, password }),
      });
      await onAuthenticated(user, intent);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const roleLabel =
    intent === 'owner' ? 'business owner' : intent === 'staff' ? 'staff member' : 'customer';
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <Link to="/" className="text-sm font-semibold text-indigo-700">
          ← Your Appointment
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[.16em] text-indigo-700">
          {roleLabel} access
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {intent === 'owner'
            ? 'Start with your business profile. You can invite staff after setup.'
            : intent === 'staff'
              ? 'Create a staff account, then ask your business owner to assign your branch.'
              : 'Sign in to see your bookings, or continue as a guest from a business booking link.'}
        </p>
        <form onSubmit={submit} className="mt-7 grid gap-4">
          {mode === 'register' && (
            <Input
              label="Your name"
              name="displayName"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
            />
          )}
          <Input
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 12 : 1}
            maxLength={128}
          />
          <Alert>{error}</Alert>
          <Alert type="success">{message}</Alert>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </PrimaryButton>
        </form>
        <p className="mt-6 text-center text-sm text-slate-600">
          {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            className="font-semibold text-indigo-700 underline-offset-4 hover:underline"
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
              setMessage('');
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  );
}

function RoleLayout({
  role,
  user,
  businesses,
  selectedBusiness,
  onBusinessChange,
  onLogout,
  navigation,
  children,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const businessId = selectedBusiness?.id;
  const navItems = navigation.flatMap(({ heading, items }) => [
    ...(heading
      ? [
          <p className="nav-group-label" key={`heading-${heading}`}>
            {heading}
          </p>,
        ]
      : []),
    ...items.map(([section, label]) => (
      <NavLink
        key={section}
        onClick={() => setMobileNavOpen(false)}
        to={`/${role}/${businessId}/${section}`}
        className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
      >
        {label}
      </NavLink>
    )),
  ]);
  const switchRole =
    role === 'owner'
      ? roleBusinesses(businesses, 'staff')[0]
      : roleBusinesses(businesses, 'owner')[0];
  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <Link
          to="/"
          className="flex h-20 items-center gap-3 border-b border-slate-100 px-6 font-semibold"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-700 text-white">
            Y
          </span>
          Your Appointment
        </Link>
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[.15em] text-slate-400">
            {role === 'owner' ? 'Owner workspace' : 'Staff workspace'}
          </p>
          <select
            aria-label="Select business"
            className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
            value={businessId}
            onChange={(event) => onBusinessChange(event.target.value)}
          >
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label={`${role} navigation`} className="flex-1 space-y-1 overflow-y-auto p-4">
          {navItems}
        </nav>
        <div className="border-t border-slate-100 p-4">
          {switchRole && (
            <Link
              className="nav-link mb-2"
              to={`/${role === 'owner' ? 'staff' : 'owner'}/${switchRole.id}/overview`}
            >
              Switch to {role === 'owner' ? 'staff' : 'owner'} view
            </Link>
          )}
          <p className="truncate px-3 text-xs text-slate-500">{user.email}</p>
          <button className="nav-link mt-1 w-full text-left" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-7">
          <button
            className="button-secondary lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-workspace-navigation"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            Menu
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{user.displayName}</span>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold capitalize text-indigo-800">
              {role}
            </span>
          </div>
        </header>
        {mobileNavOpen && (
          <nav
            aria-label="Mobile navigation"
            id="mobile-workspace-navigation"
            className="sticky top-16 z-20 grid grid-cols-2 gap-1 border-b border-slate-200 bg-white p-3 sm:grid-cols-3 lg:hidden"
          >
            <label className="field-label col-span-full px-2">
              Business
              <select
                aria-label="Select business"
                className="field-control"
                value={businessId}
                onChange={(event) => onBusinessChange(event.target.value)}
              >
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </label>
            {navItems}
            <button className="nav-link text-left" onClick={onLogout}>
              Sign out
            </button>
          </nav>
        )}
        <main className="mx-auto max-w-7xl px-4 py-7 sm:px-7 sm:py-9">{children}</main>
      </div>
    </div>
  );
}

export function OwnerOnboarding({ session, onBusinessCreated, logout }) {
  const navigate = useNavigate();
  const existing = roleBusinesses(session.businesses, 'owner');
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState(null);
  const [branch, setBranch] = useState(null);
  const [service, setService] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function createBusiness(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const creation = businessCreationKey();
    try {
      const result = await api('/businesses', {
        method: 'POST',
        headers: { 'Idempotency-Key': creation.key },
        body: jsonBody({
          name: form.get('name'),
          businessType: form.get('businessType') || undefined,
        }),
      });
      setBusiness(result.business);
      onBusinessCreated(result.business);
      creation.clear();
      setStep(2);
      setNotice('Business created. Next, add your first branch.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createBranch(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/businesses/${business.id}/feature-settings`, {
        method: 'PATCH',
        body: jsonBody({
          features: {
            appointments: true,
            walkInQueue: true,
            guestBooking: true,
            customerAccounts: true,
          },
        }),
      });
      const result = await api(`/businesses/${business.id}/branches`, {
        method: 'POST',
        body: jsonBody({
          name: form.get('name'),
          timezone: form.get('timezone'),
          operatingHours: defaultHours,
        }),
      });
      setBranch(result.branch);
      setStep(3);
      setNotice('Branch saved. Add your first service.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createService(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api(`/businesses/${business.id}/services`, {
        method: 'POST',
        body: jsonBody({
          name: form.get('name'),
          branchIds: [branch.id],
          appointmentEnabled: true,
          queueEnabled: true,
          durationMinutes: Number(form.get('durationMinutes')),
        }),
      });
      setService(result.service);
      setStep(4);
      setNotice('Service saved. Staff setup is optional; you can finish now.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function assignStaff(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/businesses/${business.id}/staff-assignments`, {
        method: 'POST',
        body: jsonBody({
          email: form.get('email'),
          branchId: branch.id,
          serviceIds: [service.id],
          workingHours: defaultHours,
        }),
      });
      setNotice('Staff member assigned. Finish setup when you are ready.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (existing.length && step === 0 && !business) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="flex justify-between border-b bg-white px-6 py-4">
          <Link to="/">Your Appointment</Link>
          <button className="button-secondary" onClick={logout}>
            Sign out
          </button>
        </header>
        <main className="mx-auto max-w-4xl px-5 py-12">
          <PageHeading
            eyebrow="Welcome back"
            title="Choose a business"
            description="Open a workspace you already manage, or start a new business setup."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {existing.map((item) => (
              <Link
                className="surface p-5 transition hover:border-indigo-300"
                key={item.id}
                to={`/owner/${item.id}/overview`}
              >
                <p className="text-lg font-semibold">{item.name}</p>
                <p className="mt-1 text-sm text-slate-500">Open owner dashboard →</p>
              </Link>
            ))}
          </div>
          <button className="button-primary mt-5" onClick={() => setStep(1)}>
            Create another business
          </button>
        </main>
      </div>
    );
  }

  const steps = ['Welcome', 'Business', 'Branch', 'Service', 'Staff (optional)'];
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-7 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-9 flex items-center justify-between">
          <Link to="/" className="font-semibold">
            Your Appointment
          </Link>
          <button className="button-secondary" onClick={logout}>
            Sign out
          </button>
        </header>
        <div className="surface p-6 sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-700">
            Owner setup · Step {Math.max(1, step)} of 4
          </p>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Setup progress">
            {steps.slice(1).map((label, index) => (
              <span
                key={label}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${step >= index + 1 ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-500'}`}
              >
                {index + 1}. {label}
              </span>
            ))}
          </div>
          {step === 0 && (
            <>
              <h1 className="mt-7 text-3xl font-semibold">Welcome, {session.user.displayName}</h1>
              <p className="mt-3 max-w-xl leading-7 text-slate-600">
                We’ll help you create a business, set up its first branch and service, then open
                your dashboard. Staff setup can wait until later.
              </p>
              <PrimaryButton className="mt-7" onClick={() => setStep(1)}>
                Start business setup
              </PrimaryButton>
            </>
          )}
          {step === 1 && (
            <form className="mt-7 grid gap-4" onSubmit={createBusiness}>
              <h1 className="text-3xl font-semibold">Create your business</h1>
              <p className="text-sm text-slate-600">
                Your business workspace is private to its owner and assigned staff.
              </p>
              <Input
                label="Business name"
                name="name"
                minLength={2}
                maxLength={120}
                required
                autoFocus
              />
              <Input
                label="Business type (optional)"
                name="businessType"
                maxLength={80}
                placeholder="Salon, clinic, repair shop…"
              />
              <Alert>{error}</Alert>
              <div className="flex justify-end">
                <PrimaryButton type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create business'}
                </PrimaryButton>
              </div>
            </form>
          )}
          {step === 2 && (
            <form className="mt-7 grid gap-4" onSubmit={createBranch}>
              <h1 className="text-3xl font-semibold">Add your first branch</h1>
              <Input
                label="Branch name"
                name="name"
                minLength={2}
                maxLength={120}
                required
                autoFocus
              />
              <Input
                label="Branch timezone (IANA)"
                name="timezone"
                defaultValue="Asia/Kolkata"
                required
              />
              <p className="text-sm text-slate-500">
                Default opening hours are Monday–Saturday, 9:00 AM–5:00 PM. You can adjust them in
                Branches.
              </p>
              <Alert>{error}</Alert>
              <div className="flex justify-end">
                <PrimaryButton type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save branch'}
                </PrimaryButton>
              </div>
            </form>
          )}
          {step === 3 && (
            <form className="mt-7 grid gap-4" onSubmit={createService}>
              <h1 className="text-3xl font-semibold">Add your first service</h1>
              <Input
                label="Service name"
                name="name"
                minLength={2}
                maxLength={120}
                required
                autoFocus
              />
              <Select label="Appointment duration" name="durationMinutes" defaultValue="30">
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </Select>
              <p className="text-sm text-slate-500">
                Appointments and walk-in queue are enabled for your business and this service.
              </p>
              <Alert>{error}</Alert>
              <div className="flex justify-end">
                <PrimaryButton type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save service'}
                </PrimaryButton>
              </div>
            </form>
          )}
          {step === 4 && (
            <>
              <h1 className="mt-7 text-3xl font-semibold">Add staff (optional)</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                Staff members create their own account first. Enter that account’s email to assign
                this branch and service. You can also skip this step.
              </p>
              <form onSubmit={assignStaff} className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto]">
                <Input label="Staff account email" name="email" type="email" required />
                <div className="self-end">
                  <PrimaryButton disabled={busy}>{busy ? 'Assigning…' : 'Add staff'}</PrimaryButton>
                </div>
              </form>
              <Alert>{error}</Alert>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
                <p className="text-sm text-slate-500">
                  {notice || 'You can manage staff from the dashboard later.'}
                </p>
                <PrimaryButton onClick={() => navigate(`/owner/${business.id}/overview`)}>
                  Finish and open dashboard
                </PrimaryButton>
              </div>
            </>
          )}
          {notice && step < 4 && <Alert type="success">{notice}</Alert>}
          {step > 1 && step < 4 && (
            <button
              className="mt-6 text-sm font-semibold text-slate-500 hover:text-slate-900"
              onClick={() => setStep(step - 1)}
              type="button"
            >
              ← Back
            </button>
          )}
        </div>
        {business && (
          <p className="mt-4 text-center text-xs text-slate-400">Setting up {business.name}</p>
        )}
      </div>
    </main>
  );
}

function useBusinessData(businessId, branchId, withAnalytics = false) {
  const [data, setData] = useState({
    business: null,
    branches: [],
    services: [],
    assignments: [],
    appointments: [],
    tickets: [],
    analytics: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    const queryBranch = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
    const tasks = [
      api(`/businesses/${businessId}`),
      api(`/businesses/${businessId}/branches`),
      api(`/businesses/${businessId}/services`),
      api(`/businesses/${businessId}/staff-assignments`),
      api(`/businesses/${businessId}/appointments${queryBranch}`),
      api(`/businesses/${businessId}/queue-tickets${queryBranch}`),
      ...(withAnalytics ? [api(`/businesses/${businessId}/analytics`)] : []),
    ];
    const results = await Promise.allSettled(tasks);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) setError(failure.reason.message);
    const value = (index, fallback) =>
      results[index]?.status === 'fulfilled' ? results[index].value : fallback;
    const collection = (index) => {
      const value = results[index]?.status === 'fulfilled' ? results[index].value : [];
      return Array.isArray(value) ? value : [];
    };
    setData({
      business: value(0, {}).business ?? null,
      branches: collection(1),
      services: collection(2),
      assignments: collection(3),
      appointments: collection(4),
      tickets: collection(5),
      analytics: withAnalytics ? value(6, null) : null,
    });
    setLoading(false);
  }, [businessId, branchId, withAnalytics]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const subscribedBranchIds = branchId
    ? [String(branchId)]
    : data.branches.map((branch) => String(branch.id));
  const branchSubscriptionKey = subscribedBranchIds.join(',');
  useEffect(() => {
    if (!businessId || !branchSubscriptionKey) return;
    const socket = io(API.replace('/api/v1', ''), {
      withCredentials: true,
      path: '/api/socket.io',
    });
    const joinBranches = () => {
      branchSubscriptionKey
        .split(',')
        .forEach((subscribedBranchId) =>
          socket.emit('tenant:join', { businessId, branchId: subscribedBranchId }),
        );
    };
    socket.on('queue.updated', refresh);
    socket.on('staff.assignment.updated', refresh);
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect', () => {
      joinBranches();
      refresh();
    });
    return () => socket.disconnect();
  }, [businessId, branchSubscriptionKey, refresh]);
  return { ...data, loading, error, refresh, businessId };
}

function WorkspaceShell({
  role,
  user,
  businesses,
  businessId,
  onBusinessChange,
  onLogout,
  error,
  onRetry,
  children,
}) {
  const navigation = role === 'owner' ? ownerNavigation : staffNavigation;
  const selected = businesses.find((business) => business.id === businessId);
  return (
    <RoleLayout
      role={role}
      user={user}
      businesses={businesses}
      selectedBusiness={selected}
      onBusinessChange={onBusinessChange}
      onLogout={onLogout}
      navigation={navigation}
    >
      {error && (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          role="alert"
        >
          <p>{error}</p>
          <button className="button-secondary" onClick={onRetry}>
            Retry loading workspace
          </button>
        </div>
      )}
      {children}
    </RoleLayout>
  );
}

export function OwnerWorkspace({ session, logout, reloadBusinessMemberships }) {
  const { businessId, section = 'overview' } = useParams();
  const navigate = useNavigate();
  const owners = roleBusinesses(session.businesses, 'owner');
  const selected = owners.find((business) => business.id === businessId);
  const [branchId, setBranchId] = useState('');
  const data = useBusinessData(businessId, branchId, true);
  const ownerData = useMemo(
    () => ({ ...data, branchId, setBranchId, businessId }),
    [data, branchId, businessId],
  );
  if (!selected)
    return (
      <Navigate to={owners[0] ? `/owner/${owners[0].id}/overview` : '/owner/onboarding'} replace />
    );
  return (
    <WorkspaceShell
      role="owner"
      user={session.user}
      businesses={owners}
      businessId={businessId}
      onBusinessChange={(id) => navigate(`/owner/${id}/overview`)}
      onLogout={logout}
      error={data.error}
      onRetry={data.refresh}
    >
      <OwnerPage
        section={section}
        data={ownerData}
        reloadBusinessMemberships={reloadBusinessMemberships}
        session={session}
      />
    </WorkspaceShell>
  );
}

function OwnerPage({ section, data, reloadBusinessMemberships, session }) {
  switch (section) {
    case 'appointments':
      return <AppointmentsPage data={data} role="owner" />;
    case 'queue':
      return <QueueManagementPage data={data} role="owner" />;
    case 'live-rooms':
      return <RoomMonitorPage data={data} />;
    case 'queue-activity':
      return <QueueActivityPage data={data} />;
    case 'customers':
      return <CustomersPage businessId={data.businessId} />;
    case 'staff':
      return <StaffManagementPage data={data} />;
    case 'services':
      return <ServicesPage data={data} />;
    case 'branches':
      return <BranchesPage data={data} />;
    case 'analytics':
      return <AnalyticsPage data={data} />;
    case 'settings':
      return (
        <BusinessSettingsPage
          data={data}
          session={session}
          reloadBusinessMemberships={reloadBusinessMemberships}
        />
      );
    case 'public-booking':
      return <PublicBookingLinkPage businessId={data.businessId} />;
    case 'queue-qr':
      return <QueueQrPage data={data} />;
    default:
      return <OwnerOverview data={data} />;
  }
}

function OwnerOverview({ data }) {
  if (data.loading && !data.business) return <LoadingView label="Loading business overview" />;
  const branch = data.branches.find((item) => item.id === data.branchId) ?? data.branches[0];
  const dateKey = todayAt(branch?.timezone);
  const todayAppointments = data.appointments.filter((item) => item.localDate === dateKey);
  const todayTickets = data.tickets.filter((item) => item.localDate === dateKey);
  const metrics = [
    [
      'Today’s appointments',
      todayAppointments.filter((item) => item.status === 'BOOKED').length,
      'Scheduled visits',
    ],
    [
      'Waiting queue',
      todayTickets.filter((item) => item.status === 'WAITING').length,
      'Customers waiting',
    ],
    [
      'Currently serving',
      todayTickets.filter((item) => item.status === 'SERVING').length,
      'In service',
    ],
    [
      'Completed today',
      todayAppointments.filter((item) => item.status === 'COMPLETED').length +
        todayTickets.filter((item) => item.status === 'COMPLETED').length,
      'Appointments and queue',
    ],
    [
      'No-shows today',
      todayAppointments.filter((item) => item.status === 'NO_SHOW').length +
        todayTickets.filter((item) => item.status === 'NO_SHOW').length,
      'Across both workflows',
    ],
    [
      'Active staff',
      data.assignments.filter((item) => item.status === 'active').length,
      'Branch assignments',
    ],
  ];
  const upcoming = data.appointments
    .filter((item) => item.status === 'BOOKED' && new Date(item.startAt) > new Date())
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
    .slice(0, 5);
  const recent = [
    ...data.appointments.map((appointment) => ({
      at: appointment.createdAt ?? appointment.startAt,
      branchId: appointment.branchId?._id ?? appointment.branchId,
      label: 'Appointment booking',
      detail: `${data.services.find((service) => String(service.id) === String(appointment.serviceId?._id ?? appointment.serviceId))?.name ?? 'Appointment'} · ${appointment.status}`,
    })),
    ...data.tickets.flatMap((ticket) =>
      (ticket.statusHistory ?? []).map((event) => ({
        at: event.at,
        branchId: ticket.branchId?._id ?? ticket.branchId,
        label: `Queue ticket ${queueStatusLabel(event.status).toLowerCase()}`,
        detail: `${ticket.serviceId?.name ?? 'Room'} · #${ticket.sequenceNumber} · ${customerName(ticket)}`,
      })),
    ),
  ]
    .filter((event) => event.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 6);
  return (
    <>
      <PageHeading
        eyebrow={data.business?.name}
        title="Overview"
        description="A live view of today’s appointments, queue and team activity."
        action={
          <Select
            label="Branch"
            value={data.branchId || branch?.id || ''}
            onChange={(e) => data.setBranchId(e.target.value)}
          >
            <option value="">All branches</option>
            {data.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, value, detail]) => (
          <Metric key={label} label={label} value={data.loading ? '—' : value} detail={detail} />
        ))}
      </div>
      <div className="mt-7 grid gap-6 xl:grid-cols-2">
        <section className="surface p-5">
          <SectionTitle
            title="Upcoming appointments"
            link={`/owner/${data.businessId}/appointments`}
            linkLabel="View all"
          />
          {upcoming.length ? (
            <div className="divide-y divide-slate-100">
              {upcoming.map((item) => (
                <AppointmentRow
                  key={item._id}
                  appointment={item}
                  branches={data.branches}
                  services={data.services}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No upcoming appointments"
              description="Customer bookings will appear here as soon as they’re made."
            />
          )}
        </section>
        <section className="surface p-5">
          <SectionTitle
            title="Recent business activity"
            link={`/owner/${data.businessId}/queue-activity`}
            linkLabel="View queue activity"
          />
          {recent.length ? (
            <div className="divide-y divide-slate-100">
              {recent.map((item, index) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={`${item.at}-${item.label}-${index}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{item.label}</p>
                    <p className="mt-1 break-words text-sm text-slate-600">{item.detail}</p>
                  </div>
                  <time className="text-xs text-slate-500">
                    {dateTime(
                      item.at,
                      data.branches.find((branch) => String(branch.id) === String(item.branchId))
                        ?.timezone,
                    )}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No recent activity"
              description="Appointment bookings and recorded queue actions will appear here."
            />
          )}
        </section>
      </div>
    </>
  );
}

function Metric({ label, value, detail }) {
  return (
    <article className="surface p-5">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}
function SectionTitle({ title, link, linkLabel }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {link && (
        <Link className="text-sm font-semibold text-indigo-700 hover:underline" to={link}>
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

function AppointmentRow({ appointment, branches, services, actions }) {
  const branch = branches.find(
    (item) => String(item.id) === String(appointment.branchId?._id ?? appointment.branchId),
  );
  const service = services.find(
    (item) => String(item.id) === String(appointment.serviceId?._id ?? appointment.serviceId),
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <p className="font-medium text-slate-900">
          {service?.name ?? 'Appointment'} · {dateTime(appointment.startAt, branch?.timezone)}
        </p>
        {appointment.customerDisplayName && (
          <p className="mt-1 text-sm text-slate-700">
            {customerName({ customerDisplayName: appointment.customerDisplayName })}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          {branch?.name ?? 'Branch'} · {appointment._id}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={statusClass(appointment.status)}>{appointment.status}</span>
        {actions}
      </div>
    </div>
  );
}

function AppointmentsPage({ data, role }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  async function update(id, status) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}/appointments/${id}`, {
        method: 'PATCH',
        body: jsonBody({ status }),
      });
      setNotice(`Appointment marked ${queueStatusLabel(status).toLowerCase()}.`);
      await data.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  }
  const items = [...data.appointments].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  return (
    <>
      <PageHeading
        eyebrow={role === 'owner' ? 'Operations' : 'Assigned work'}
        title={role === 'owner' ? 'Appointments' : 'My Appointments'}
        description={
          role === 'owner'
            ? 'Review and update appointments across your business.'
            : 'Only appointments assigned to your active branch or service assignments are shown.'
        }
      />
      <Alert>{error || data.error}</Alert>
      <Alert type="success">{notice}</Alert>
      {data.loading && !items.length ? (
        <LoadingView />
      ) : items.length ? (
        <section className="surface divide-y divide-slate-100 px-5">
          {items.map((item) => (
            <AppointmentRow
              key={item._id}
              appointment={item}
              branches={data.branches}
              services={data.services}
              actions={
                item.status === 'BOOKED' ? (
                  <>
                    {item.startAt && (
                      <button
                        className="button-secondary"
                        disabled={busyId === item._id}
                        onClick={() => update(item._id, 'COMPLETED')}
                      >
                        Complete
                      </button>
                    )}
                    <button
                      className="button-secondary"
                      disabled={busyId === item._id}
                      onClick={() => update(item._id, 'NO_SHOW')}
                    >
                      No-show
                    </button>
                    <button
                      className="button-danger"
                      disabled={busyId === item._id}
                      onClick={() => update(item._id, 'CANCELLED')}
                    >
                      Cancel
                    </button>
                  </>
                ) : null
              }
            />
          ))}
        </section>
      ) : (
        <EmptyState
          title="No appointments yet"
          description="New customer reservations will appear here."
        />
      )}
    </>
  );
}

export function QueueManagementPage({ data, role }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const services = data.services.filter(
    (service) =>
      service.queueEnabled &&
      (!data.branchId || service.branchIds.some((id) => String(id) === String(data.branchId))),
  );
  const selectedBranch = data.branches.find(
    (branch) => String(branch.id) === String(data.branchId),
  );
  useEffect(() => {
    if (!services.some((service) => String(service.id) === String(serviceId)))
      setServiceId(services[0]?.id ?? '');
  }, [data.branchId, data.services, serviceId]);
  async function callNext() {
    if (!data.branchId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api(
        `/businesses/${data.businessId}/branches/${data.branchId}/queue/call-next`,
        {
          method: 'POST',
          body: jsonBody({ serviceId }),
        },
      );
      setNotice(`Ticket #${result.sequenceNumber} called for the selected room.`);
      await data.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(ticket, status) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}/queue-tickets/${ticket._id}`, {
        method: 'PATCH',
        body: jsonBody({ status }),
      });
      setNotice(
        `Ticket #${ticket.sequenceNumber} marked ${queueStatusLabel(status).toLowerCase()}.`,
      );
      await data.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow={role === 'owner' ? 'Live operations' : 'Assigned branch'}
        title={role === 'owner' ? 'Queue Management' : 'My Queue'}
        description="Call the next waiting ticket and record service progress. Customer updates are delivered to their private ticket room."
        action={
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Branch"
              value={data.branchId || ''}
              onChange={(e) => data.setBranchId(e.target.value)}
            >
              <option value="">Choose branch</option>
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select
              label="Room / service queue"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              <option value="">Choose room</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <Alert>{error || data.error}</Alert>
      <Alert type="success">{notice}</Alert>
      <div className="surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Today’s tickets</h2>
          <p className="text-sm font-semibold text-indigo-800">
            Selected room:{' '}
            {services.find((item) => String(item.id) === String(serviceId))?.name ??
              'Choose a room'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Assigned staff:{' '}
            {data.assignments
              .filter(
                (assignment) =>
                  assignment.status === 'active' &&
                  String(assignment.branchId) === String(data.branchId) &&
                  (assignment.serviceIds.length === 0 ||
                    assignment.serviceIds.some((id) => String(id) === String(serviceId))),
              )
              .map((assignment) => assignment.user?.displayName ?? 'Staff')
              .join(', ') || 'No staff assigned'}
          </p>
          <PrimaryButton disabled={!data.branchId || !serviceId || busy} onClick={callNext}>
            Call next waiting ticket
          </PrimaryButton>
        </div>
        {data.loading && !data.tickets.length ? (
          <div className="grid gap-3" aria-label="Loading queue tickets">
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : data.tickets.length ? (
          <div className="divide-y divide-slate-100">
            {data.tickets
              .filter(
                (ticket) =>
                  String(ticket.serviceId?._id ?? ticket.serviceId) === String(serviceId) &&
                  String(ticket.branchId?._id ?? ticket.branchId) === String(data.branchId),
              )
              .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
              .map((ticket) => (
                <div
                  key={ticket._id}
                  className="queue-ticket-row flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {ticket.serviceId?.name ??
                        services.find((item) => String(item.id) === String(serviceId))?.name ??
                        'Room'}{' '}
                      · Ticket #{ticket.sequenceNumber}
                    </p>
                    <p className="text-sm text-slate-600">{customerName(ticket)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Joined {dateTime(ticket.joinedAt, selectedBranch?.timezone)} ·{' '}
                      <span>
                        Waiting{' '}
                        {elapsedMinutes(
                          ticket.joinedAt,
                          ticket.calledAt ?? ticket.cancelledAt ?? ticket.noShowAt ?? now,
                        )}
                      </span>
                    </p>
                    {ticketStaffLabel(ticket) && (
                      <p className="mt-1 text-xs text-slate-500">{ticketStaffLabel(ticket)}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={statusClass(ticket.status)}>
                      {queueStatusLabel(ticket.status)}
                    </span>
                    {ticket.status === 'CALLED' && (
                      <PrimaryButton disabled={busy} onClick={() => setStatus(ticket, 'SERVING')}>
                        Start service
                      </PrimaryButton>
                    )}
                    {ticket.status === 'SERVING' && (
                      <PrimaryButton disabled={busy} onClick={() => setStatus(ticket, 'COMPLETED')}>
                        Complete
                      </PrimaryButton>
                    )}
                    {ticket.status === 'WAITING' && (
                      <button
                        className="button-danger"
                        disabled={busy}
                        onClick={() => setStatus(ticket, 'CANCELLED')}
                      >
                        Cancel
                      </button>
                    )}
                    {ticket.status === 'CALLED' && (
                      <>
                        <button
                          className="button-danger"
                          disabled={busy}
                          onClick={() => setStatus(ticket, 'NO_SHOW')}
                        >
                          No-show
                        </button>
                        <button
                          className="button-danger"
                          disabled={busy}
                          onClick={() => setStatus(ticket, 'CANCELLED')}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <EmptyState
            title={serviceId ? 'This room queue is clear' : 'Choose a room'}
            description="Only this room’s tickets appear here. Customers can join through the branch QR link."
          />
        )}
      </div>
    </>
  );
}

function RoomMonitorPage({ data }) {
  const [monitor, setMonitor] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => {
    if (!data.branchId) return;
    setLoading(true);
    try {
      setMonitor(
        await api(`/businesses/${data.businessId}/branches/${data.branchId}/queue-monitor`),
      );
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [data.businessId, data.branchId]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!data.branchId) return;
    const socket = io(API.replace('/api/v1', ''), {
      withCredentials: true,
      path: '/api/socket.io',
    });
    socket.emit('tenant:join', { businessId: data.businessId, branchId: data.branchId });
    socket.on('connect', () => {
      socket.emit('tenant:join', { businessId: data.businessId, branchId: data.branchId });
      refresh();
    });
    socket.on('queue.updated', refresh);
    socket.on('staff.assignment.updated', refresh);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, [data.businessId, data.branchId, refresh]);
  const branch = data.branches.find((item) => String(item.id) === String(data.branchId));
  const elapsed = (start, end = now) =>
    start ? `${Math.max(0, Math.floor((end - new Date(start).getTime()) / 60000))} min` : '—';
  return (
    <>
      <PageHeading
        title="Live Rooms"
        description="Live queue state and staff workload for every active room at the selected branch."
        action={
          <Select
            label="Branch"
            value={data.branchId || ''}
            onChange={(event) => data.setBranchId(event.target.value)}
          >
            <option value="">Choose branch</option>
            {data.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        }
      />
      <Alert>{error || data.error}</Alert>
      {error && (
        <button className="button-secondary mb-5" onClick={refresh}>
          Retry room monitor
        </button>
      )}
      {!data.branchId ? (
        <EmptyState
          title="Choose a branch"
          description="Select a branch to monitor its active rooms."
        />
      ) : loading ? (
        <div className="grid gap-4 xl:grid-cols-2" aria-label="Loading room monitor">
          <div className="surface h-56 animate-pulse bg-slate-100" />
          <div className="surface h-56 animate-pulse bg-slate-100" />
        </div>
      ) : monitor?.rooms?.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {monitor.rooms.map((room) => (
            <article className="surface p-5" key={room.service.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
                    {room.branch.name}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">{room.service.name}</h2>
                </div>
                <span className={statusClass(room.state === 'IDLE' ? 'CANCELLED' : room.state)}>
                  {room.state}
                </span>
              </div>
              <p className="mt-4 text-sm text-slate-600">
                Waiting: <strong>{room.waitingCount}</strong>
              </p>
              {room.current ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                  <p className="text-2xl font-semibold">
                    {room.service.name} · #{room.current.sequenceNumber}
                  </p>
                  <p className="mt-1">{customerName({ displayName: room.current.displayName })}</p>
                  <p className="text-sm text-slate-600">
                    Staff: {room.current.servingStaff ?? 'Not assigned yet'}
                  </p>
                  <p className="mt-3 text-xs text-slate-500">
                    Joined {dateTime(room.current.joinedAt, branch?.timezone)} · Waiting{' '}
                    {elapsed(
                      room.current.joinedAt,
                      room.current.calledAt ? new Date(room.current.calledAt) : now,
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    Called{' '}
                    {room.current.calledAt
                      ? dateTime(room.current.calledAt, branch?.timezone)
                      : '—'}{' '}
                    · Started{' '}
                    {room.current.serviceStartedAt
                      ? dateTime(room.current.serviceStartedAt, branch?.timezone)
                      : '—'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Service duration {elapsed(room.current.serviceStartedAt)}
                  </p>
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  No current customer.
                </p>
              )}
              <h3 className="mt-5 text-sm font-semibold">Assigned staff and workload</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {room.assignedStaff.length ? (
                  room.assignedStaff.map((staff) => (
                    <span
                      className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-900"
                      key={staff.id}
                    >
                      {staff.displayName} · {staff.available ? 'Available' : 'Serving'} ·{' '}
                      {staff.currentWorkload} active
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">No active staff assignment</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No active rooms"
          description="Active queue-enabled services with an open queue will appear here."
        />
      )}
    </>
  );
}

function QueueActivityPage({ data }) {
  const [result, setResult] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!data.branchId) return;
    setLoading(true);
    try {
      setResult(
        await api(
          `/businesses/${data.businessId}/queue-activity?branchId=${encodeURIComponent(data.branchId)}`,
        ),
      );
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [data.businessId, data.branchId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!data.branchId) return;
    const socket = io(API.replace('/api/v1', ''), {
      withCredentials: true,
      path: '/api/socket.io',
    });
    socket.emit('tenant:join', { businessId: data.businessId, branchId: data.branchId });
    socket.on('connect', () => {
      socket.emit('tenant:join', { businessId: data.businessId, branchId: data.branchId });
      load();
    });
    socket.on('queue.updated', load);
    return () => socket.disconnect();
  }, [data.businessId, data.branchId, load]);
  return (
    <>
      <PageHeading
        title="Queue Activity Log"
        description="Chronological, server-timestamped queue actions for this branch, displayed in its local timezone."
        action={
          <Select
            label="Branch"
            value={data.branchId || ''}
            onChange={(event) => data.setBranchId(event.target.value)}
          >
            <option value="">Choose branch</option>
            {data.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        }
      />
      <Alert>{error || data.error}</Alert>
      {error && (
        <button className="button-secondary mb-5" onClick={load}>
          Retry activity log
        </button>
      )}
      {loading ? (
        <div className="surface h-56 animate-pulse bg-slate-100" aria-label="Loading activity" />
      ) : result?.entries?.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date and time</th>
                <th>Room</th>
                <th>Ticket / customer</th>
                <th>Action</th>
                <th>Staff</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry, index) => (
                <tr key={`${entry.at}-${entry.sequenceNumber}-${index}`}>
                  <td>{dateTime(entry.at, result.branch.timezone)}</td>
                  <td>{entry.service}</td>
                  <td>
                    #{entry.sequenceNumber} · {entry.customer}
                  </td>
                  <td>{entry.action}</td>
                  <td>{entry.staff ?? 'Customer / system'}</td>
                  <td>{entry.durationMinutes != null ? `${entry.durationMinutes} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={data.branchId ? 'No queue activity yet' : 'Choose a branch'}
          description="Recorded queue events will appear here."
        />
      )}
    </>
  );
}

function CustomersPage({ businessId }) {
  const [customers, setCustomers] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const loadCustomers = useCallback(() => {
    setLoading(true);
    setError('');
    api(`/businesses/${businessId}/customers`)
      .then((customers) => setCustomers(customers))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [businessId]);
  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);
  return (
    <>
      <PageHeading
        title="Customers"
        description="Customer profiles and recent booking activity within your authorized business scope."
      />
      <Alert>{error}</Alert>
      {error && (
        <button className="button-secondary mb-5" onClick={loadCustomers}>
          Retry loading customers
        </button>
      )}
      {loading ? (
        <LoadingView label="Loading customers" />
      ) : customers.length ? (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Visits</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="font-medium">{customer.displayName}</td>
                  <td>{customer.email || '—'}</td>
                  <td>{customer.phone || '—'}</td>
                  <td>{customer.count}</td>
                  <td>{dateTime(customer.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No customer history yet"
          description="Guest and registered customer bookings will appear here."
        />
      )}
    </>
  );
}

function StaffManagementPage({ data }) {
  const [email, setEmail] = useState(''),
    [branchId, setBranchId] = useState(''),
    [serviceIds, setServiceIds] = useState([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  async function add(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}/staff-assignments`, {
        method: 'POST',
        body: jsonBody({ email, branchId, serviceIds, workingHours: defaultHours }),
      });
      setNotice('Staff assignment saved.');
      setEmail('');
      setServiceIds([]);
      await data.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const toggleService = (id) =>
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
  return (
    <>
      <PageHeading
        title="Staff"
        description="Assign existing accounts to branches and services. Staff create their own sign-in account first."
        action={
          <Link className="button-secondary" to="/auth?intent=staff">
            Staff sign-up link
          </Link>
        }
      />
      <Alert>{error}</Alert>
      <Alert type="success">{notice}</Alert>
      <form onSubmit={add} className="surface mb-6 grid gap-4 p-5 md:grid-cols-2">
        <Input
          className="md:col-span-2"
          label="Staff account email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Select
          label="Branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          required
        >
          <option value="">Choose branch</option>
          {data.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <fieldset>
          <legend className="field-label">Services</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.services.map((service) => (
              <label
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                key={service.id}
              >
                <input
                  className="h-4 w-4"
                  type="checkbox"
                  checked={serviceIds.includes(service.id)}
                  onChange={() => toggleService(service.id)}
                />
                {service.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-2">
          <PrimaryButton disabled={busy || !branchId || !serviceIds.length}>
            {busy ? 'Saving…' : 'Add or update staff assignment'}
          </PrimaryButton>
        </div>
      </form>
      <div className="surface overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Staff member</th>
              <th>Branch</th>
              <th>Services</th>
              <th>Booked appointments</th>
              <th>Actions</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.assignments.map((assignment) => (
              <tr key={assignment.id}>
                <td>
                  <p className="font-medium">{assignment.user?.displayName ?? 'Account'}</p>
                  <p className="text-xs text-slate-500">{assignment.user?.email}</p>
                </td>
                <td>{data.branches.find((b) => b.id === assignment.branchId)?.name ?? '—'}</td>
                <td>
                  {assignment.serviceIds
                    .map((id) => data.services.find((s) => s.id === id)?.name ?? 'Service')
                    .join(', ') || 'All active services'}
                </td>
                <td>
                  {
                    data.appointments.filter(
                      (appointment) =>
                        String(appointment.staffAssignmentId) === String(assignment.id) &&
                        appointment.status === 'BOOKED',
                    ).length
                  }
                </td>
                <td>
                  <button
                    className="button-secondary"
                    onClick={async () => {
                      try {
                        setError('');
                        setNotice('');
                        await api(
                          `/businesses/${data.businessId}/staff-assignments/${assignment.id}`,
                          {
                            method: 'PATCH',
                            body: jsonBody({
                              status: assignment.status === 'active' ? 'inactive' : 'active',
                            }),
                          },
                        );
                        setNotice(
                          `Staff assignment ${assignment.status === 'active' ? 'deactivated' : 'reactivated'}.`,
                        );
                        await data.refresh();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    {assignment.status === 'active' ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
                <td>
                  <span
                    className={statusClass(
                      assignment.status === 'active' ? 'SERVING' : 'CANCELLED',
                    )}
                  >
                    {assignment.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.assignments.length && (
          <div className="p-5 text-sm text-slate-500">No staff assignments yet.</div>
        )}
      </div>
    </>
  );
}

function ServicesPage({ data }) {
  const [name, setName] = useState(''),
    [branchIds, setBranchIds] = useState([]),
    [duration, setDuration] = useState('30'),
    [appointments, setAppointments] = useState(true),
    [queue, setQueue] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function create(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}/services`, {
        method: 'POST',
        body: jsonBody({
          name,
          branchIds,
          durationMinutes: Number(duration),
          appointmentEnabled: appointments,
          queueEnabled: queue,
        }),
      });
      setNotice('Service created.');
      setName('');
      setBranchIds([]);
      await data.refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function toggle(service, key) {
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}/services/${service.id}`, {
        method: 'PATCH',
        body: jsonBody({ [key]: !service[key] }),
      });
      setNotice(
        `${service.name}: ${key === 'queueEnabled' ? 'walk-in queue' : 'appointments'} ${service[key] ? 'disabled' : 'enabled'}.`,
      );
      await data.refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageHeading
        title="Services"
        description="Manage bookable services, appointment duration, branch availability, and queue participation."
      />
      <Alert>{error}</Alert>
      <Alert type="success">{notice}</Alert>
      <form className="surface mb-6 grid gap-4 p-5 md:grid-cols-2" onSubmit={create}>
        <Input
          label="Service name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <Select
          label="Appointment duration"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        >
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
        </Select>
        <fieldset className="md:col-span-2">
          <legend className="field-label">Available at branches</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.branches.map((b) => (
              <label
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                key={b.id}
              >
                <input
                  className="h-4 w-4"
                  type="checkbox"
                  checked={branchIds.includes(b.id)}
                  onChange={() =>
                    setBranchIds((ids) =>
                      ids.includes(b.id) ? ids.filter((id) => id !== b.id) : [...ids, b.id],
                    )
                  }
                />
                {b.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            className="h-4 w-4"
            type="checkbox"
            checked={appointments}
            onChange={(e) => setAppointments(e.target.checked)}
          />
          Appointments
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            className="h-4 w-4"
            type="checkbox"
            checked={queue}
            onChange={(e) => setQueue(e.target.checked)}
          />
          Walk-in queue
        </label>
        <PrimaryButton
          className="md:col-span-2"
          disabled={!branchIds.length || (!appointments && !queue)}
        >
          Create service
        </PrimaryButton>
      </form>
      <div className="grid gap-3">
        {data.services.map((service) => (
          <article
            className="surface flex flex-wrap items-center justify-between gap-4 p-5"
            key={service.id}
          >
            <div>
              <h2 className="font-semibold">{service.name}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {service.durationMinutes} minutes ·{' '}
                {service.branchIds
                  .map((id) => data.branches.find((b) => b.id === id)?.name ?? 'Branch')
                  .join(', ')}
              </p>
              <p className="mt-1 text-xs text-slate-500">{service.status}</p>
              <p className="mt-2 text-sm text-slate-600">
                <span className="font-medium">Assigned staff:</span>{' '}
                {data.assignments
                  .filter(
                    (assignment) =>
                      assignment.status === 'active' &&
                      (!assignment.serviceIds.length ||
                        assignment.serviceIds.some((id) => String(id) === String(service.id))),
                  )
                  .map(
                    (assignment) =>
                      assignment.user?.displayName ?? assignment.user?.email ?? 'Staff',
                  )
                  .join(', ') || 'None assigned'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={service.appointmentEnabled ? 'toggle-on' : 'button-secondary'}
                onClick={() => toggle(service, 'appointmentEnabled')}
              >
                Appointments {service.appointmentEnabled ? 'On' : 'Off'}
              </button>
              <button
                className={service.queueEnabled ? 'toggle-on' : 'button-secondary'}
                onClick={() => toggle(service, 'queueEnabled')}
              >
                Queue {service.queueEnabled ? 'On' : 'Off'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!data.services.length && (
        <EmptyState
          title="No services yet"
          description="Add a service to make the first appointment or queue journey available."
        />
      )}
    </>
  );
}

function BranchesPage({ data }) {
  const [name, setName] = useState(''),
    [timezone, setTimezone] = useState('Asia/Kolkata'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function create(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}/branches`, {
        method: 'POST',
        body: jsonBody({ name, timezone, operatingHours: defaultHours }),
      });
      setNotice('Branch created.');
      setName('');
      await data.refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function update(branch) {
    const nextName = window.prompt('Branch name', branch.name);
    if (!nextName) return;
    try {
      await api(`/businesses/${data.businessId}/branches/${branch.id}`, {
        method: 'PATCH',
        body: jsonBody({ name: nextName }),
      });
      await data.refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  const allowMultiple = data.business?.features?.multipleBranches;
  return (
    <>
      <PageHeading
        title="Branches"
        description="Each branch has its own IANA timezone and local opening schedule."
      />
      <Alert>{error || data.error}</Alert>
      <Alert type="success">{notice}</Alert>
      <form onSubmit={create} className="surface mb-6 grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          label="Branch name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          required
        />
        <Input
          label="IANA timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          required
        />
        <div className="self-end">
          <PrimaryButton disabled={data.branches.length > 0 && !allowMultiple}>
            Add branch
          </PrimaryButton>
        </div>
        {data.branches.length > 0 && !allowMultiple && (
          <p className="text-sm text-slate-500 sm:col-span-3">
            Multiple branches are disabled. Enable this setting under Business Settings to add
            another branch.
          </p>
        )}
      </form>
      <div className="grid gap-3">
        {data.branches.map((branch) => (
          <article
            className="surface flex flex-wrap items-center justify-between gap-4 p-5"
            key={branch.id}
          >
            <div>
              <h2 className="font-semibold">{branch.name}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {branch.timezone} · {branch.operatingHours.length} opening windows
              </p>
            </div>
            <div className="flex gap-2">
              <span className={statusClass(branch.status === 'active' ? 'SERVING' : 'CANCELLED')}>
                {branch.status}
              </span>
              <SecondaryButton onClick={() => update(branch)}>Edit name</SecondaryButton>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function AnalyticsPage({ data }) {
  const appointments = data.analytics?.appointments ?? {};
  const tickets = data.analytics?.queueTickets ?? {};
  return (
    <>
      <PageHeading
        title="Analytics"
        description="Business-scoped operational counts from recorded appointments and queue tickets."
      />
      <Alert>{data.error}</Alert>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label="Booked appointments"
          value={appointments.BOOKED ?? 0}
          detail="Current booked status"
        />
        <Metric
          label="Completed appointments"
          value={appointments.COMPLETED ?? 0}
          detail="Recorded completions"
        />
        <Metric
          label="Appointment no-shows"
          value={appointments.NO_SHOW ?? 0}
          detail="Recorded no-shows"
        />
        <Metric
          label="Waiting tickets"
          value={tickets.WAITING ?? 0}
          detail="All recorded queue dates"
        />
        <Metric
          label="Serving tickets"
          value={tickets.SERVING ?? 0}
          detail="Currently in service"
        />
        <Metric
          label="Completed tickets"
          value={tickets.COMPLETED ?? 0}
          detail="Recorded completions"
        />
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Counts reflect business records and do not include forecasting or cross-business
        comparisons.
      </p>
    </>
  );
}

function PublicBookingLinkPage({ businessId }) {
  const bookingUrl = `${window.location.origin}/book/${businessId}`;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function copyLink() {
    setError('');
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setNotice('Booking link copied.');
    } catch {
      setError('Copy is unavailable in this browser. Select the link above and copy it.');
    }
  }
  return (
    <>
      <PageHeading
        title="Public Booking Link"
        description="Share this link so customers can choose a branch, service and available appointment time."
      />
      <Alert>{error}</Alert>
      <Alert type="success">{notice}</Alert>
      <section className="surface max-w-3xl p-5 sm:p-7">
        <label className="field-label" htmlFor="public-booking-url">
          Customer booking page
        </label>
        <input
          id="public-booking-url"
          className="field-control mt-2"
          value={bookingUrl}
          readOnly
          onFocus={(event) => event.target.select()}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="button-primary" onClick={copyLink}>
            Copy booking link
          </button>
          <a className="button-secondary" href={bookingUrl} target="_blank" rel="noreferrer">
            Open booking page
          </a>
        </div>
      </section>
    </>
  );
}

function QueueQrPage({ data }) {
  const [branchId, setBranchId] = useState('');
  const [entryUrl, setEntryUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function generateQr() {
    if (!branchId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api(
        `/businesses/${data.businessId}/branches/${branchId}/queue-qr-rotations`,
        { method: 'POST', body: '{}' },
      );
      const image = await QRCode.toDataURL(result.entryUrl, { width: 300, margin: 2 });
      setEntryUrl(result.entryUrl);
      setQrDataUrl(image);
      setNotice('QR entry link generated.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="QR Entry Links"
        description="Generate a branch-specific QR code for customers joining the walk-in queue."
      />
      <Alert>{error || data.error}</Alert>
      <Alert type="success">{notice}</Alert>
      <section className="surface grid max-w-4xl gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div>
          <Select
            label="Branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">Choose a branch</option>
            {data.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Refreshing a branch QR revokes its previous entry link. Replace any printed QR after
            generating a new one.
          </p>
          <button className="button-primary mt-4" disabled={!branchId || busy} onClick={generateQr}>
            {busy ? 'Generating…' : entryUrl ? 'Refresh QR entry link' : 'Generate QR entry link'}
          </button>
          {entryUrl && (
            <div className="mt-5">
              <label className="field-label" htmlFor="queue-entry-url">
                Branch queue entry URL
              </label>
              <input
                id="queue-entry-url"
                className="field-control mt-2"
                value={entryUrl}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <a
                className="mt-3 inline-flex text-sm font-semibold text-indigo-700 hover:underline"
                href={entryUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open queue entry page
              </a>
            </div>
          )}
        </div>
        {qrDataUrl && (
          <div className="w-fit rounded-2xl border border-slate-200 bg-white p-3">
            <img
              className="h-60 w-60 max-w-full"
              src={qrDataUrl}
              alt="Branch queue entry QR code"
            />
          </div>
        )}
      </section>
    </>
  );
}

function BusinessSettingsPage({ data, session, reloadBusinessMemberships }) {
  const [name, setName] = useState(''),
    [businessType, setBusinessType] = useState(''),
    [features, setFeatures] = useState({}),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    if (!data.business) return;
    setName(data.business.name);
    setBusinessType(data.business.businessType ?? '');
    setFeatures(data.business.features ?? {});
  }, [data.business]);
  const keys = [
    ['appointments', 'Appointments'],
    ['walkInQueue', 'Walk-in queue'],
    ['staffSelection', 'Staff selection'],
    ['serviceSelection', 'Service selection'],
    ['guestBooking', 'Guest booking'],
    ['customerAccounts', 'Customer accounts'],
    ['notifications', 'Notifications'],
    ['multipleBranches', 'Multiple branches'],
  ];
  async function saveProfile(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}`, {
        method: 'PATCH',
        body: jsonBody({ name, businessType }),
      });
      setNotice('Business details saved.');
      await data.refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveFeatures() {
    setError('');
    setNotice('');
    try {
      await api(`/businesses/${data.businessId}/feature-settings`, {
        method: 'PATCH',
        body: jsonBody({ features }),
      });
      setNotice('Feature settings saved.');
      await data.refresh();
      await reloadBusinessMemberships(session.user);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageHeading
        title="Business Settings"
        description="Update your business profile and server-validated feature settings."
      />
      <Alert>{error || data.error}</Alert>
      <Alert type="success">{notice}</Alert>
      <form className="surface grid gap-4 p-5 sm:grid-cols-2" onSubmit={saveProfile}>
        <Input
          label="Business name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <Input
          label="Business type"
          value={businessType}
          onChange={(e) => setBusinessType(e.target.value)}
        />
        <div className="sm:col-span-2">
          <PrimaryButton>Save profile</PrimaryButton>
        </div>
      </form>
      <section className="surface mt-6 p-5">
        <h2 className="text-lg font-semibold">Features</h2>
        <p className="mt-1 text-sm text-slate-500">
          Guest booking and customer accounts can be enabled independently.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {keys.map(([key, label]) => (
            <label
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"
              key={key}
            >
              <span className="text-sm font-medium">{label}</span>
              <input
                className="h-5 w-5 accent-indigo-700"
                type="checkbox"
                checked={Boolean(features[key])}
                onChange={(e) =>
                  setFeatures((current) => ({ ...current, [key]: e.target.checked }))
                }
              />
            </label>
          ))}
        </div>
        <PrimaryButton className="mt-5" onClick={saveFeatures}>
          Save feature settings
        </PrimaryButton>
      </section>
    </>
  );
}

export function StaffWorkspace({ session, logout }) {
  const { businessId, section = 'overview' } = useParams();
  const navigate = useNavigate();
  const staffBusinesses = roleBusinesses(session.businesses, 'staff');
  const selected = staffBusinesses.find((business) => business.id === businessId);
  const [branchId, setBranchId] = useState('');
  const data = useBusinessData(businessId, branchId, false);
  if (!selected) return <Navigate to="/staff" replace />;
  return (
    <WorkspaceShell
      role="staff"
      user={session.user}
      businesses={staffBusinesses}
      businessId={businessId}
      onBusinessChange={(id) => navigate(`/staff/${id}/overview`)}
      onLogout={logout}
      error={data.error}
      onRetry={data.refresh}
    >
      <StaffPage section={section} data={{ ...data, branchId, setBranchId }} />
    </WorkspaceShell>
  );
}

export function StaffPending({ user, logout }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="surface max-w-xl p-8">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-700">Staff access</p>
        <h1 className="mt-3 text-3xl font-semibold">Your account is ready, {user.displayName}.</h1>
        <p className="mt-3 leading-7 text-slate-600">
          A business owner must assign your account to a branch before your staff workspace becomes
          available. Ask them to use <strong>{user.email}</strong> in Staff settings.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="button-primary inline-flex" to="/">
            Back to home
          </Link>
          <button className="button-secondary" onClick={logout}>
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}

function StaffPage({ section, data }) {
  if (section === 'appointments') return <AppointmentsPage data={data} role="staff" />;
  if (section === 'queue') return <QueueManagementPage data={data} role="staff" />;
  if (section === 'customers') return <CustomersPage businessId={data.businessId} />;
  if (section === 'schedule') return <StaffSchedule data={data} />;
  return <StaffOverview data={data} />;
}

function StaffOverview({ data }) {
  const branch = data.branches.find((item) => item.id === data.branchId) ?? data.branches[0];
  const dateKey = todayAt(branch?.timezone);
  const appointments = data.appointments
    .filter((item) => item.localDate === dateKey && item.status === 'BOOKED')
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const tickets = data.tickets.filter((item) => item.localDate === dateKey);
  return (
    <>
      <PageHeading
        eyebrow={data.business?.name}
        title="My Overview"
        description="Your assigned appointments, queue status and working schedule."
        action={
          <Select
            label="My branch"
            value={data.branchId || branch?.id || ''}
            onChange={(e) => data.setBranchId(e.target.value)}
          >
            <option value="">All assigned branches</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        }
      />
      <Alert>{data.error}</Alert>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Today’s appointments"
          value={appointments.length}
          detail="Assigned to your membership"
        />
        <Metric
          label="Next appointment"
          value={appointments[0] ? dateTime(appointments[0].startAt, branch?.timezone) : '—'}
          detail={appointments[0] ? 'Next scheduled visit' : 'No upcoming visit today'}
        />
        <Metric
          label="Waiting customers"
          value={tickets.filter((t) => t.status === 'WAITING').length}
          detail="Your assigned branch"
        />
        <Metric
          label="Being served"
          value={tickets.filter((t) => t.status === 'SERVING').length}
          detail="Active queue work"
        />
      </div>
      <section className="surface mt-7 p-5">
        <SectionTitle
          title="Today’s assigned appointments"
          link={`/staff/${data.businessId}/appointments`}
          linkLabel="Open appointments"
        />
        {appointments.length ? (
          appointments.map((a) => (
            <AppointmentRow
              key={a._id}
              appointment={a}
              branches={data.branches}
              services={data.services}
            />
          ))
        ) : (
          <EmptyState
            title="No appointments assigned today"
            description="Appointments for your assigned branches will appear here."
          />
        )}
      </section>
      <section className="surface mt-6 p-5">
        <SectionTitle
          title="Current queue"
          link={`/staff/${data.businessId}/queue`}
          linkLabel="Manage queue"
        />
        {tickets.filter((t) => ['WAITING', 'CALLED', 'SERVING'].includes(t.status)).length ? (
          tickets
            .filter((t) => ['WAITING', 'CALLED', 'SERVING'].includes(t.status))
            .map((t) => (
              <div
                key={t._id}
                className="flex items-center justify-between border-b border-slate-100 py-3"
              >
                <span>
                  {t.serviceId?.name ??
                    data.services.find((service) => String(service.id) === String(t.serviceId))
                      ?.name ??
                    'Room'}{' '}
                  · Ticket #{t.sequenceNumber}
                </span>
                <p className="text-sm text-slate-600">{customerName(t)}</p>
                <span className={statusClass(t.status)}>{queueStatusLabel(t.status)}</span>
              </div>
            ))
        ) : (
          <p className="text-sm text-slate-500">No active tickets at your assigned branch.</p>
        )}
      </section>
    </>
  );
}

function StaffSchedule({ data }) {
  return (
    <>
      <PageHeading
        title="My Schedule"
        description="Your assigned branches, services and local working hours."
      />
      <Alert>{data.error}</Alert>
      {data.assignments.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {data.assignments.map((assignment) => (
            <article className="surface p-5" key={assignment.id}>
              <h2 className="font-semibold">
                {data.branches.find((b) => b.id === assignment.branchId)?.name ?? 'Assigned branch'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {assignment.serviceIds
                  .map((id) => data.services.find((s) => s.id === id)?.name ?? 'Service')
                  .join(', ') || 'All active services'}
              </p>
              <ul className="mt-4 space-y-2">
                {assignment.workingHours.map((hours) => (
                  <li className="flex justify-between text-sm" key={hours.dayOfWeek}>
                    <span>
                      {new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(
                        new Date(Date.UTC(2024, 0, 7 + hours.dayOfWeek)),
                      )}
                    </span>
                    <span>
                      {hours.opensLocal}–{hours.closesLocal}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No schedule assigned"
          description="Ask your business owner to assign a branch and working hours."
        />
      )}
    </>
  );
}

export function CustomerAppointments({ session, logout }) {
  const [appointments, setAppointments] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    return api('/me/appointments')
      .then((data) => setAppointments(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  async function cancel(id) {
    setError('');
    try {
      await api(`/me/appointments/${id}`, {
        method: 'PATCH',
        body: jsonBody({ status: 'CANCELLED' }),
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  const upcoming = appointments.filter(
    (a) => a.status === 'BOOKED' && new Date(a.startAt) > new Date(),
  );
  const history = appointments.filter((a) => !upcoming.includes(a));
  return (
    <CustomerShell session={session} logout={logout} active="appointments">
      <PageHeading
        eyebrow="Customer area"
        title="My Appointments"
        description="Your own upcoming bookings and appointment history."
      />
      <Alert>{error}</Alert>
      {error && (
        <button className="button-secondary mb-5" onClick={refresh}>
          Retry loading appointments
        </button>
      )}
      {loading ? (
        <LoadingView label="Loading your appointments" />
      ) : appointments.length ? (
        <>
          <section className="surface mb-6 p-5">
            <SectionTitle title="Upcoming" />
            {upcoming.length ? (
              upcoming.map((a) => (
                <CustomerAppointmentRow key={a._id} appointment={a} onCancel={cancel} />
              ))
            ) : (
              <EmptyState
                title="No upcoming bookings"
                description="Use a business booking link to reserve your next visit."
              />
            )}
          </section>
          <section className="surface p-5">
            <SectionTitle title="Booking history" />
            {history.length ? (
              history.map((a) => <CustomerAppointmentRow key={a._id} appointment={a} />)
            ) : (
              <p className="text-sm text-slate-500">
                Completed or cancelled bookings will appear here.
              </p>
            )}
          </section>
        </>
      ) : (
        <EmptyState
          title="No appointments yet"
          description="Open a business’s booking link to choose a branch, service and available time. Guest booking does not require an account."
        />
      )}
    </CustomerShell>
  );
}

function CustomerAppointmentRow({ appointment, onCancel }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-4">
      <div>
        <p className="font-semibold">
          {appointment.serviceId?.name ?? 'Appointment'} ·{' '}
          {dateTime(appointment.startAt, appointment.branchId?.timezone)}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {appointment.branchId?.name ?? 'Branch'} · Ref {appointment._id}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={statusClass(appointment.status)}>{appointment.status}</span>
        {appointment.status === 'BOOKED' && onCancel && (
          <button className="button-danger" onClick={() => onCancel(appointment._id)}>
            Cancel booking
          </button>
        )}
      </div>
    </div>
  );
}

export function CustomerQueue({ session, logout }) {
  const [tickets, setTickets] = useState([]),
    [updates, setUpdates] = useState({}),
    [error, setError] = useState(''),
    [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let sockets = [];
    setError('');
    api('/me/queue-tickets')
      .then(async (items) => {
        setTickets(items);
        const next = {};
        for (const ticket of items) {
          const token = sessionStorage.getItem(`ticket:${ticket._id}`);
          if (!token) continue;
          try {
            const result = await api(`/public/queue-tickets/${ticket._id}`, {
              headers: { 'X-Public-Access-Token': token },
            });
            next[ticket._id] = result.ticket;
            const socket = io(API.replace('/api/v1', ''), {
              path: '/api/socket.io',
              auth: { publicAccessToken: token },
            });
            socket.on('ticket.updated', (update) =>
              setUpdates((current) => ({
                ...current,
                [ticket._id]: { ...current[ticket._id], ...update },
              })),
            );
            sockets.push(socket);
          } catch {
            /* Expired or unavailable guest token; show the authenticated snapshot. */
          }
        }
        setUpdates(next);
      })
      .catch((e) => setError(e.message));
    return () => sockets.forEach((socket) => socket.disconnect());
  }, [reloadKey]);
  return (
    <CustomerShell session={session} logout={logout} active="queue">
      <PageHeading
        eyebrow="Customer area"
        title="Queue Tracking"
        description="Your ticket numbers and statuses. Private queue details are never shown."
      />
      <Alert>{error}</Alert>
      {error && (
        <button className="button-secondary mb-5" onClick={() => setReloadKey((key) => key + 1)}>
          Retry loading queue tickets
        </button>
      )}
      {tickets.length ? (
        tickets.map((ticket) => {
          const live = updates[ticket._id];
          return (
            <article
              className="surface mb-3 flex flex-wrap items-center justify-between gap-3 p-5"
              key={ticket._id}
            >
              <div>
                <p className="text-xl font-semibold">Ticket #{ticket.sequenceNumber}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {ticket.serviceId?.name ?? 'Service'} · {ticket.branchId?.name ?? 'Branch'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  People ahead: {live?.peopleAhead ?? '—'}
                </p>
              </div>
              <span className={statusClass(live?.status ?? ticket.status)}>
                {live?.status ?? ticket.status}
              </span>
            </article>
          );
        })
      ) : (
        <EmptyState
          title="No queue tickets yet"
          description="Use a branch QR link to join a walk-in queue. Your ticket will appear here when you are signed in."
        />
      )}
    </CustomerShell>
  );
}

export function CustomerAccount({ session, logout }) {
  return (
    <CustomerShell session={session} logout={logout}>
      <PageHeading
        eyebrow="Customer area"
        title="Account"
        description="Your signed-in customer identity. It is separate from any business membership."
      />
      <section className="surface grid max-w-2xl gap-5 p-5 sm:grid-cols-2 sm:p-7">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Name</p>
          <p className="mt-2 font-medium text-slate-900">{session.user.displayName}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Email</p>
          <p className="mt-2 break-all font-medium text-slate-900">{session.user.email}</p>
        </div>
        <p className="text-sm leading-6 text-slate-600 sm:col-span-2">
          To make an appointment, open the booking link shared by the business. Guest bookings do
          not require an account.
        </p>
        <button className="button-secondary sm:col-span-2 sm:justify-self-start" onClick={logout}>
          Sign out
        </button>
      </section>
    </CustomerShell>
  );
}

function CustomerShell({ session, logout, children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="font-semibold">
            Your Appointment
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">
              {session.user.displayName}
            </span>
            <button className="button-secondary" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-7">
        <nav className="mb-7 flex flex-wrap gap-2">
          <NavLink
            className={({ isActive }) => `customer-tab ${isActive ? 'customer-tab-active' : ''}`}
            to="/customer/appointments"
          >
            My Appointments
          </NavLink>
          <NavLink
            className={({ isActive }) => `customer-tab ${isActive ? 'customer-tab-active' : ''}`}
            to="/customer/queue"
          >
            Queue Tracking
          </NavLink>
          <NavLink
            className={({ isActive }) => `customer-tab ${isActive ? 'customer-tab-active' : ''}`}
            to="/customer/account"
          >
            Account
          </NavLink>
        </nav>
        {children}
      </main>
    </div>
  );
}

export function CustomerAppointmentDetails() {
  const { appointmentId } = useParams();
  const [appointment, setAppointment] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    const token = sessionStorage.getItem(`appointment:${appointmentId}`);
    if (!token) {
      setError('This appointment link is no longer available on this device.');
      return;
    }
    api(`/public/appointments/${appointmentId}`, { headers: { 'X-Public-Access-Token': token } })
      .then((data) => setAppointment(data.appointment))
      .catch((e) => setError(e.message));
  }, [appointmentId]);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="surface mx-auto max-w-xl p-7">
        <Link to="/" className="text-sm font-semibold text-indigo-700">
          ← Home
        </Link>
        <h1 className="mt-6 text-3xl font-semibold">Appointment details</h1>
        <Alert>{error}</Alert>
        {appointment && (
          <div className="mt-5 space-y-3">
            <p>
              <strong>Reference:</strong> {appointment._id}
            </p>
            <p>
              <strong>Status:</strong>{' '}
              <span className={statusClass(appointment.status)}>{appointment.status}</span>
            </p>
            <p>
              <strong>Appointment:</strong> {dateTime(appointment.startAt)}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export function PublicBooking({ user, sessionLoading }) {
  const { businessId } = useParams();
  const [branches, setBranches] = useState([]),
    [services, setServices] = useState([]),
    [branch, setBranch] = useState(''),
    [service, setService] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [slots, setSlots] = useState([]),
    [selected, setSelected] = useState(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState(null);
  useEffect(() => {
    api(`/public/businesses/${businessId}/branches?flow=appointments`)
      .then((branches) => setBranches(branches))
      .catch((e) => setError(e.message));
  }, [businessId]);
  useEffect(() => {
    if (!branch) {
      setServices([]);
      return;
    }
    api(`/public/branches/${branch}/services?flow=appointments`)
      .then((services) => setServices(services))
      .catch((e) => setError(e.message));
  }, [branch]);
  useEffect(() => {
    if (!branch || !service || !date) return;
    setLoading(true);
    setSlots([]);
    setSelected(null);
    api(`/public/branches/${branch}/availability?serviceId=${service}&date=${date}`)
      .then((d) => setSlots(d.slots))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [branch, service, date]);
  async function book(event) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api(`/public/branches/${branch}/appointments`, {
        method: 'POST',
        body: jsonBody({
          serviceId: service,
          staffAssignmentId: selected.staffAssignmentId,
          startAt: selected.startAt,
          displayName: user?.displayName ?? form.get('displayName'),
          email: user?.email ?? form.get('email'),
        }),
      });
      sessionStorage.setItem(`appointment:${result.appointment.id}`, result.accessToken);
      setConfirmation(result.appointment);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const branchRecord = branches.find((item) => item.id === branch);
  if (sessionLoading) return <LoadingView label="Loading booking" />;
  if (confirmation)
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12">
        <section className="surface mx-auto max-w-2xl p-7 sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-emerald-700">
            Booking confirmed
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Your appointment is reserved.</h1>
          <p className="mt-3 text-slate-600">
            Reference: <span className="font-mono text-sm">{confirmation.id}</span>
          </p>
          <p className="mt-2 text-slate-600">
            {dateTime(confirmation.startAt, branchRecord?.timezone)} ·{' '}
            {services.find((item) => item.id === service)?.name}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="button-primary inline-flex" to={`/appointments/${confirmation.id}`}>
              View appointment status
            </Link>
            {user && (
              <Link className="button-secondary inline-flex" to="/customer/appointments">
                My appointments
              </Link>
            )}
          </div>
        </section>
      </main>
    );
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="text-sm font-semibold text-indigo-700">
          ← Your Appointment
        </Link>
        <section className="surface mt-5 p-6 sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-700">
            Customer booking
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Choose a time that works.</h1>
          <p className="mt-2 text-sm text-slate-600">
            Book as a guest. You can optionally sign in to keep your bookings in your account.
          </p>
          <Alert>{error}</Alert>
          {error && (
            <button
              className="button-secondary"
              type="button"
              onClick={() => window.location.reload()}
            >
              Retry booking page
            </button>
          )}
          <form onSubmit={book} className="mt-7 grid gap-5">
            <Select
              label="Branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              required
            >
              <option value="">Choose a branch</option>
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.timezone}
                </option>
              ))}
            </Select>
            <Select
              label="Service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              required
              disabled={!branch}
            >
              <option value="">Choose a service</option>
              {services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Input
              label="Appointment date"
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              required
            />
            <fieldset>
              <legend className="field-label">
                Available times{branchRecord ? ` · ${branchRecord.timezone}` : ''}
              </legend>
              {loading ? (
                <p className="mt-2 text-sm text-slate-500">Checking availability…</p>
              ) : slots.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((slot) => (
                    <button
                      aria-pressed={
                        selected?.startAt === slot.startAt &&
                        selected?.staffAssignmentId === slot.staffAssignmentId
                      }
                      className={`slot-button ${selected?.startAt === slot.startAt && selected?.staffAssignmentId === slot.staffAssignmentId ? 'slot-button-selected' : ''}`}
                      key={`${slot.startAt}:${slot.staffAssignmentId}`}
                      onClick={() => setSelected(slot)}
                      type="button"
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: branchRecord?.timezone,
                      }).format(new Date(slot.startAt))}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  Choose a branch, service and date to see available times.
                </p>
              )}
            </fieldset>
            {!user && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Your name"
                  name="displayName"
                  required
                  minLength={2}
                  maxLength={100}
                />
                <Input label="Email address" name="email" type="email" required maxLength={254} />
              </div>
            )}
            {user && (
              <p className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">
                Booking for {user.displayName} ({user.email})
              </p>
            )}
            <PrimaryButton disabled={!selected || busy}>
              {busy ? 'Booking…' : 'Confirm booking'}
            </PrimaryButton>
          </form>
        </section>
      </div>
    </main>
  );
}

export function QueueEntry() {
  const { credential } = useParams();
  const [context, setContext] = useState(null),
    [serviceId, setServiceId] = useState(''),
    [displayName, setDisplayName] = useState(''),
    [email, setEmail] = useState(''),
    [phone, setPhone] = useState(''),
    [profileSaved, setProfileSaved] = useState(false),
    [profileDeclined, setProfileDeclined] = useState(false),
    [profileConsent, setProfileConsent] = useState(false),
    [ticket, setTicket] = useState(null),
    [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/public/qr/${credential}`)
      .then((result) => {
        setContext(result);
        if (result.services[0]) setServiceId(result.services[0].id);
      })
      .catch((e) => setError(e.message));
  }, [credential]);
  useEffect(() => {
    if (!ticket || !token) return;
    const socket = io(API.replace('/api/v1', ''), {
      path: '/api/socket.io',
      auth: { publicAccessToken: token },
    });
    const refreshTicket = async (update) => {
      setTicket((current) => ({ ...current, ...update }));
      try {
        const result = await api(`/public/queue-tickets/${ticket.id}`, {
          headers: { 'X-Public-Access-Token': token },
        });
        setTicket((current) => ({ ...current, ...result.ticket }));
      } catch {
        /* Keep the last received status visible during transient network errors. */
      }
    };
    socket.on('ticket.updated', refreshTicket);
    socket.on('connect', () => refreshTicket({}));
    return () => socket.disconnect();
  }, [ticket?.id, token]);
  async function join(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api(`/public/branches/${context.branch.id}/queue-tickets`, {
        method: 'POST',
        body: jsonBody({
          serviceId,
          displayName,
          email: email || undefined,
          phone: phone || undefined,
        }),
      });
      sessionStorage.setItem(`ticket:${result.ticket.id}`, result.accessToken);
      setTicket({
        ...result.ticket,
        service: result.service,
        branch: result.branch,
        joinedAt: result.joinedAt,
      });
      setToken(result.accessToken);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function leaveQueue() {
    try {
      await api(`/public/queue-tickets/${ticket.id}/leave`, {
        method: 'PATCH',
        headers: { 'X-Public-Access-Token': token },
      });
      setTicket((current) => ({ ...current, status: 'CANCELLED' }));
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveProfile(event) {
    event.preventDefault();
    try {
      await api(`/public/queue-tickets/${ticket.id}/profile`, {
        method: 'POST',
        headers: { 'X-Public-Access-Token': token },
        body: jsonBody({
          consent: true,
          displayName: displayName || undefined,
          email: email || undefined,
          phone: phone || undefined,
        }),
      });
      setProfileSaved(true);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <section className="surface mx-auto max-w-xl p-7 sm:p-9">
        <Link to="/" className="text-sm font-semibold text-indigo-700">
          ← Your Appointment
        </Link>
        <p className="mt-7 text-xs font-bold uppercase tracking-[.16em] text-indigo-700">
          Walk-in queue
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          {context?.branch.name ?? 'Join this branch’s queue'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Join as a guest with your name. Contact details and sign-in are optional.
        </p>
        <Alert>{error}</Alert>
        {error && (
          <button className="button-secondary mb-5" onClick={() => window.location.reload()}>
            Reload queue entry link
          </button>
        )}
        {ticket ? (
          <div className="mt-7 rounded-2xl bg-indigo-50 p-6">
            <p className="text-sm font-semibold text-indigo-800">Your ticket</p>
            <p className="mt-2 text-4xl font-semibold text-slate-950">
              {ticket.service?.name ??
                context?.services.find((item) => item.id === serviceId)?.name ??
                'Room'}{' '}
              · #{ticket.sequenceNumber}
            </p>
            <p className="mt-3">
              <span className={statusClass(ticket.status)}>{ticket.status}</span>
            </p>
            <p className="mt-3 text-sm text-slate-600">
              {ticket.branch?.name ?? context?.branch.name} · Joined{' '}
              {ticket.joinedAt
                ? dateTime(ticket.joinedAt, ticket.branch?.timezone ?? context?.branch.timezone)
                : 'just now'}
              . Keep this page open for updates.
            </p>
            {['WAITING', 'CALLED'].includes(ticket.status) && (
              <button type="button" className="button-danger mt-4" onClick={leaveQueue}>
                Leave queue
              </button>
            )}
            {ticket.status === 'COMPLETED' && !profileSaved && !profileDeclined && (
              <form className="mt-5 border-t border-indigo-100 pt-4" onSubmit={saveProfile}>
                <p className="text-sm font-semibold">
                  Save my details with this business for future visits.
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  This is optional. Your queue ticket does not create a customer profile unless you
                  opt in.
                </p>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    required
                    checked={profileConsent}
                    onChange={(event) => setProfileConsent(event.target.checked)}
                  />
                  <span>
                    I agree to save my visit details as a business-specific customer profile.
                  </span>
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <PrimaryButton disabled={!profileConsent}>Save my details</PrimaryButton>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => setProfileDeclined(true)}
                  >
                    No thanks
                  </button>
                </div>
              </form>
            )}
            {profileSaved && (
              <p className="mt-4 text-sm text-emerald-800">
                Your details were saved with this business.
              </p>
            )}
            {profileDeclined && (
              <p className="mt-4 text-sm text-slate-600">
                You declined profile saving. Your queue visit is complete.
              </p>
            )}
            <button
              className="button-secondary mt-4"
              type="button"
              onClick={async () => {
                const url = `${window.location.origin}/queue/ticket/${ticket.id}#${encodeURIComponent(token)}`;
                try {
                  await navigator.clipboard.writeText(url);
                  setError('Secure ticket link copied.');
                } catch {
                  window.prompt('Copy your secure ticket link', url);
                }
              }}
            >
              Copy secure ticket link
            </button>
          </div>
        ) : (
          <form className="mt-7 grid gap-4" onSubmit={join}>
            {context?.services.length === 1 ? (
              <p className="rounded-xl bg-slate-50 p-3 text-sm">
                <span className="font-semibold">Room / service:</span> {context.services[0].name}
              </p>
            ) : (
              <Select
                label="Service"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                required
              >
                <option value="">Choose a service</option>
                {context?.services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
            <Input
              label="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
            />
            <Input
              label="Email (optional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Phone (optional)"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <PrimaryButton disabled={!context || busy}>
              {busy ? 'Joining…' : 'Join queue'}
            </PrimaryButton>
          </form>
        )}
      </section>
    </main>
  );
}
