import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
async function call(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed');
  return body.data;
}
function Shell({ children, user, onLogout }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between p-5">
        <Link to="/" className="text-xl font-bold">
          Your Appointment
        </Link>
        <nav className="flex gap-4">
          {user ? (
            <>
              <span>{user.displayName}</span>
              <button onClick={onLogout}>Sign out</button>
            </>
          ) : (
            <Link to="/auth">Sign in</Link>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-16">{children}</main>
    </div>
  );
}
function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const nav = useNavigate();
  async function submit(e) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      if (mode === 'register') {
        await call('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            displayName: f.get('displayName'),
            email: f.get('email'),
            password: f.get('password'),
          }),
        });
      }
      const data = await call('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
      });
      onLogin(data.user);
      nav('/owner');
    } catch (x) {
      setError(x.message);
    }
  }
  return (
    <section className="mx-auto mt-14 max-w-md rounded-2xl bg-white p-8 shadow">
      <h1 className="text-3xl font-bold">
        {mode === 'login' ? 'Welcome back' : 'Create an account'}
      </h1>
      <form onSubmit={submit} className="mt-6 grid gap-4">
        {mode === 'register' && (
          <input name="displayName" required minLength="2" placeholder="Your name" />
        )}
        <input name="email" type="email" required placeholder="Email" />
        <input
          name="password"
          type="password"
          minLength={mode === 'register' ? 12 : 1}
          required
          placeholder="Password"
        />
        <button className="rounded bg-indigo-700 p-3 text-white">
          {mode === 'login' ? 'Sign in' : 'Register'}
        </button>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </form>
      <button
        className="mt-5 underline"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? 'Create an account' : 'I already have an account'}
      </button>
    </section>
  );
}
function OwnerHome({ user }) {
  const [businesses, setBusinesses] = useState([]),
    [business, setBusiness] = useState(null),
    [error, setError] = useState(''),
    [qr, setQr] = useState('');
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  async function refresh() {
    try {
      const d = await call('/me/businesses');
      setBusinesses(d);
      if (d[0]) setBusiness(d[0].id);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!business) return;
    call(`/businesses/${business}/branches`)
      .then((d) => {
        setBranches(d.data);
        if (d.data[0]) setBranchId((current) => current || d.data[0].id);
      })
      .catch((e) => setError(e.message));
  }, [business]);
  async function create(e) {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name');
    try {
      const d = await call('/businesses', { method: 'POST', body: JSON.stringify({ name }) });
      setBusiness(d.business.id);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function setup(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call(`/businesses/${business}/feature-settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          features: {
            appointments: true,
            walkInQueue: true,
            guestBooking: true,
            customerAccounts: true,
          },
        }),
      });
      const branch = await call(`/businesses/${business}/branches`, {
        method: 'POST',
        body: JSON.stringify({
          name: f.get('branch'),
          timezone: f.get('timezone'),
          operatingHours: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            opensLocal: '09:00',
            closesLocal: '17:00',
          })),
        }),
      });
      await call(`/businesses/${business}/services`, {
        method: 'POST',
        body: JSON.stringify({
          name: f.get('service'),
          branchIds: [branch.branch.id],
          appointmentEnabled: true,
          queueEnabled: true,
          durationMinutes: 30,
        }),
      });
      setBranchId(branch.branch.id);
      setError('Setup complete. Add a staff account and assignment in the next section.');
    } catch (e) {
      setError(e.message);
    }
  }
  async function assign(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call(`/businesses/${business}/staff-assignments`, {
        method: 'POST',
        body: JSON.stringify({
          email: f.get('email'),
          branchId,
          workingHours: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            opensLocal: '09:00',
            closesLocal: '17:00',
          })),
        }),
      });
      setError('Staff assigned.');
    } catch (e) {
      setError(e.message);
    }
  }
  async function rotate(e) {
    e.preventDefault();
    try {
      const d = await call(`/businesses/${business}/branches/${branchId}/queue-qr-rotations`, {
        method: 'POST',
        body: '{}',
      });
      setQr(await QRCode.toDataURL(d.entryUrl));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <h1 className="mt-8 text-4xl font-bold">Business workspace</h1>
      <p className="mt-2 text-slate-600">Signed in as {user?.email}</p>
      {error && <p className="my-4 rounded bg-amber-100 p-3">{error}</p>}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="panel">
          <h2 className="text-2xl font-semibold">Create a business</h2>
          <form onSubmit={create} className="mt-4 flex gap-2">
            <input name="name" required placeholder="Business name" />
            <button>Create</button>
          </form>
          <select
            className="mt-4 w-full"
            value={business ?? ''}
            onChange={(e) => setBusiness(e.target.value)}
          >
            <option value="">Select business</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </section>
        <section className="panel">
          <h2 className="text-2xl font-semibold">Initial setup</h2>
          <form onSubmit={setup} className="mt-4 grid gap-3">
            <input name="branch" required placeholder="Branch name" />
            <input
              name="timezone"
              defaultValue="Asia/Kolkata"
              required
              placeholder="IANA timezone"
            />
            <input name="service" required placeholder="Service name" />
            <button disabled={!business}>Create branch and service</button>
          </form>
          {branchId && (
            <p className="mt-3 break-all text-xs text-slate-600">Branch ID: {branchId}</p>
          )}
        </section>
        <section className="panel">
          <h2 className="text-2xl font-semibold">Assign staff</h2>
          <form onSubmit={assign} className="mt-4 grid gap-3">
            <input name="email" required type="email" placeholder="Existing staff account email" />
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              <option value="">Choose branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button disabled={!business}>Assign staff</button>
          </form>
        </section>
        <section className="panel">
          <h2 className="text-2xl font-semibold">Queue QR code</h2>
          <form onSubmit={rotate} className="mt-4 grid gap-3">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              <option value="">Choose branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button disabled={!business}>Generate QR</button>
          </form>
          {qr && <img className="mt-4 w-48" src={qr} alt="Queue entry QR code" />}
        </section>
      </div>
      <Operations businessId={business} branchId={branchId} />
    </>
  );
}
function Operations({ businessId, branchId }) {
  const [items, setItems] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!businessId) return;
    const load = () =>
      Promise.all([
        call(`/businesses/${businessId}/appointments`).catch(() => ({ data: [] })),
        call(
          `/businesses/${businessId}/queue-tickets${branchId ? `?branchId=${branchId}` : ''}`,
        ).catch(() => ({ data: [] })),
        call(`/businesses/${businessId}/analytics`).catch(() => null),
      ]).then(([appointments, queue, counts]) => {
        setItems(appointments.data ?? appointments);
        setTickets(queue.data ?? queue);
        setAnalytics(counts);
      });
    load();
    const socket = io(API.replace('/api/v1', ''), {
      withCredentials: true,
      path: '/api/socket.io',
    });
    if (branchId) socket.emit('tenant:join', { businessId, branchId });
    socket.on('queue.updated', load);
    return () => socket.disconnect();
  }, [businessId, branchId]);
  async function mutate(path, status) {
    try {
      await call(path, {
        method: path.endsWith('/call-next') ? 'POST' : 'PATCH',
        body: JSON.stringify(status ? { status } : {}),
      });
      window.location.reload();
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <section className="panel mt-6">
      <h2 className="text-2xl font-semibold">Appointments</h2>
      <p className="mt-2">{items.length} loaded</p>
      {analytics && (
        <p className="mt-2 text-sm">
          Appointments: {Object.values(analytics.appointments ?? {}).reduce((x, y) => x + y, 0)} ·
          Queue tickets: {Object.values(analytics.queueTickets ?? {}).reduce((x, y) => x + y, 0)}
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      <ul className="mt-3 grid gap-2">
        {items.map((a) => (
          <li key={a._id} className="rounded bg-slate-50 p-3">
            {a.status === 'BOOKED' && (
              <span className="mr-2">
                <button
                  onClick={() =>
                    mutate(`/businesses/${businessId}/appointments/${a._id}`, 'COMPLETED')
                  }
                >
                  Complete
                </button>{' '}
                <button
                  onClick={() =>
                    mutate(`/businesses/${businessId}/appointments/${a._id}`, 'CANCELLED')
                  }
                >
                  Cancel
                </button>
              </span>
            )}
            {new Date(a.startAt).toLocaleString()} · {a.status}
          </li>
        ))}
      </ul>
      <h3 className="mt-6 text-lg font-semibold">Walk-in queue</h3>
      <button
        disabled={!branchId}
        onClick={() => mutate(`/businesses/${businessId}/branches/${branchId}/queue/call-next`)}
      >
        Call next
      </button>
      <ul className="mt-3 grid gap-2">
        {tickets.map((t) => (
          <li key={t._id} className="rounded bg-slate-50 p-3">
            Ticket #{t.sequenceNumber} · {t.status}{' '}
            {t.status === 'CALLED' && (
              <button
                onClick={() =>
                  mutate(`/businesses/${businessId}/queue-tickets/${t._id}`, 'SERVING')
                }
              >
                Start service
              </button>
            )}{' '}
            {t.status === 'SERVING' && (
              <button
                onClick={() =>
                  mutate(`/businesses/${businessId}/queue-tickets/${t._id}`, 'COMPLETED')
                }
              >
                Complete
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
function PublicBook() {
  const { businessId } = useParams();
  const [branches, setBranches] = useState([]),
    [branch, setBranch] = useState(''),
    [services, setServices] = useState([]),
    [service, setService] = useState(''),
    [result, setResult] = useState(''),
    [error, setError] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    call(`/public/businesses/${businessId}/branches?flow=appointments`)
      .then((d) => setBranches(d.data))
      .catch((e) => setError(e.message));
  }, [businessId]);
  useEffect(() => {
    if (!branch || !service || !date) return;
    setSlots([]);
    setSelected(null);
    call(`/public/branches/${branch}/availability?serviceId=${service}&date=${date}`)
      .then((d) => setSlots(d.slots))
      .catch((e) => setError(e.message));
  }, [branch, service, date]);
  async function selectBranch(id) {
    setBranch(id);
    try {
      const d = await call(`/public/branches/${id}/services?flow=appointments`);
      setServices(d.data);
    } catch (e) {
      setError(e.message);
    }
  }
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const d = await call(`/public/branches/${branch}/appointments`, {
        method: 'POST',
        body: JSON.stringify({
          serviceId: service,
          staffAssignmentId: selected?.staffAssignmentId,
          startAt: selected?.startAt,
          displayName: f.get('displayName'),
          email: f.get('email'),
        }),
      });
      sessionStorage.setItem(`appointment:${d.appointment.id}`, d.accessToken);
      setResult(`Appointment booked. Reference: ${d.appointment.id}`);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="panel mt-10">
      <h1 className="text-3xl font-bold">Book an appointment</h1>
      <select className="mt-5" value={branch} onChange={(e) => selectBranch(e.target.value)}>
        <option value="">Choose branch</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <select required value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">Choose service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="grid gap-1">
          Appointment date
          <input
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <div>
          <p className="mb-2 font-medium">Available times</p>
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <button
                type="button"
                key={`${slot.startAt}:${slot.staffAssignmentId}`}
                aria-pressed={
                  selected?.startAt === slot.startAt &&
                  selected?.staffAssignmentId === slot.staffAssignmentId
                }
                onClick={() => setSelected(slot)}
              >
                {new Intl.DateTimeFormat(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: branches.find((b) => b.id === branch)?.timezone,
                }).format(new Date(slot.startAt))}
              </button>
            ))}
          </div>
          {slots.length === 0 && (
            <p className="text-sm text-slate-500">No available times for this date.</p>
          )}
        </div>
        <input name="displayName" required placeholder="Your name" />
        <input name="email" type="email" required placeholder="Email" />
        <button disabled={!selected}>Book</button>
      </form>
      {result && <p className="mt-4">{result}</p>}
      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
function QueueEntry() {
  const { credential } = useParams();
  const [context, setContext] = useState(null),
    [message, setMessage] = useState('');
  const [ticket, setTicket] = useState(null);
  const [token, setToken] = useState('');
  useEffect(() => {
    call(`/public/qr/${credential}`)
      .then(setContext)
      .catch((e) => setMessage(e.message));
  }, [credential]);
  useEffect(() => {
    if (!ticket?.id || !token) return undefined;
    const socket = io(API.replace('/api/v1', ''), {
      path: '/api/socket.io',
      auth: { publicAccessToken: token },
    });
    socket.on('ticket.updated', (update) => setTicket((current) => ({ ...current, ...update })));
    return () => socket.disconnect();
  }, [ticket?.id, token]);
  async function join(serviceId) {
    try {
      const d = await call(`/public/branches/${context.branch.id}/queue-tickets`, {
        method: 'POST',
        body: JSON.stringify({ serviceId, displayName: prompt('Your name') || 'Guest' }),
      });
      sessionStorage.setItem(`ticket:${d.ticket.id}`, d.accessToken);
      setTicket(d.ticket);
      setToken(d.accessToken);
      setMessage(`You joined queue #${d.ticket.sequenceNumber}. Keep this page open.`);
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <section className="panel mt-10">
      <h1 className="text-3xl font-bold">Join the walk-in queue</h1>
      <p className="mt-2">{context?.branch.name}</p>
      {context?.services.map((s) => (
        <button className="m-2" key={s.id} onClick={() => join(s.id)}>
          {s.name}
        </button>
      ))}
      <p>{message}</p>
      {ticket && (
        <p className="mt-4 rounded bg-indigo-50 p-3">
          Ticket #{ticket.sequenceNumber}: {ticket.status}
        </p>
      )}
    </section>
  );
}
export default function App() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    call('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => {});
  }, []);
  async function logout() {
    await call('/auth/logout', { method: 'POST', body: '{}' });
    setUser(null);
  }
  return (
    <Shell user={user} onLogout={logout}>
      <Routes>
        <Route
          path="/"
          element={
            <section className="mt-16">
              <p className="text-sm font-semibold uppercase tracking-widest text-indigo-700">
                Scheduling made simple
              </p>
              <h1 className="mt-4 max-w-2xl text-5xl font-bold">
                Appointments and walk-in queues, in one place.
              </h1>
              <p className="mt-5 text-lg text-slate-600">
                Set up your business or use your business’s booking link.
              </p>
              <Link
                className="mt-7 inline-block rounded bg-indigo-700 px-5 py-3 text-white"
                to={user ? '/owner' : '/auth'}
              >
                {user ? 'Open workspace' : 'Get started'}
              </Link>
            </section>
          }
        />
        <Route path="/auth" element={<Auth onLogin={setUser} />} />
        <Route
          path="/owner"
          element={user ? <OwnerHome user={user} /> : <Auth onLogin={setUser} />}
        />
        <Route path="/book/:businessId" element={<PublicBook />} />
        <Route path="/queue/entry/:credential" element={<QueueEntry />} />
      </Routes>
    </Shell>
  );
}
