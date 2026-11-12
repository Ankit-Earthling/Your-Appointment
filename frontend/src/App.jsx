import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api.js';
import {
  AuthPage,
  CustomerAppointmentDetails,
  CustomerAppointments,
  CustomerQueue,
  LandingPage,
  LoadingView,
  OwnerOnboarding,
  OwnerWorkspace,
  PublicBooking,
  QueueEntry,
  StaffWorkspace,
  StaffPending,
} from './RolePages.jsx';

function roleBusinesses(businesses, role) {
  return businesses.filter((business) => business.membership.roles.includes(role));
}

function AuthGate({ loading, user, children, intent }) {
  const location = useLocation();
  if (loading) return <LoadingView label="Checking your session" />;
  if (!user)
    return (
      <Navigate
        to={`/auth${intent ? `?intent=${intent}` : ''}`}
        replace
        state={{ from: location }}
      />
    );
  return children;
}

export default function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState({ loading: true, user: null, businesses: [] });

  const reloadBusinessMemberships = useCallback(async (user) => {
    if (!user) {
      setSession({ loading: false, user: null, businesses: [] });
      return [];
    }
    const businesses = await api('/me/businesses');
    setSession({ loading: false, user, businesses });
    return businesses;
  }, []);

  useEffect(() => {
    let current = true;
    api('/auth/me')
      .then(async ({ user }) => {
        const businesses = await api('/me/businesses');
        if (current) setSession({ loading: false, user, businesses });
      })
      .catch(() => {
        if (current) setSession({ loading: false, user: null, businesses: [] });
      });
    return () => {
      current = false;
    };
  }, []);

  async function onAuthenticated(user, intent) {
    setSession({ loading: true, user, businesses: [] });
    try {
      const businesses = await reloadBusinessMemberships(user);
      const owners = roleBusinesses(businesses, 'owner');
      const staff = roleBusinesses(businesses, 'staff');
      if (intent === 'customer') {
        navigate('/customer/appointments', { replace: true });
      } else if (intent === 'owner') {
        navigate(owners[0] ? `/owner/${owners[0].id}/overview` : '/owner/onboarding', {
          replace: true,
        });
      } else if (intent === 'staff') {
        navigate(staff[0] ? `/staff/${staff[0].id}/overview` : '/staff/pending', { replace: true });
      } else if (owners[0]) {
        navigate(`/owner/${owners[0].id}/overview`, { replace: true });
      } else if (staff[0]) {
        navigate(`/staff/${staff[0].id}/overview`, { replace: true });
      } else {
        navigate('/customer/appointments', { replace: true });
      }
    } catch (error) {
      setSession({ loading: false, user: null, businesses: [] });
      navigate(`/auth?intent=${intent === 'owner' ? 'owner' : 'customer'}`, {
        replace: true,
        state: { error: error.message },
      });
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    setSession({ loading: false, user: null, businesses: [] });
    navigate('/', { replace: true });
  }

  function onBusinessCreated(business) {
    setSession((current) => ({
      ...current,
      businesses: [
        { ...business, membership: { roles: ['owner'] } },
        ...current.businesses.filter((item) => item.id !== business.id),
      ],
    }));
  }

  const shared = useMemo(
    () => ({ session, logout, reloadBusinessMemberships, onBusinessCreated }),
    [session, reloadBusinessMemberships],
  );

  return (
    <Routes>
      <Route path="/" element={<LandingPage user={session.user} />} />
      <Route path="/auth" element={<AuthPage onAuthenticated={onAuthenticated} />} />
      <Route
        path="/owner"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="owner">
            <OwnerOnboarding {...shared} />
          </AuthGate>
        }
      />
      <Route
        path="/owner/onboarding"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="owner">
            <OwnerOnboarding {...shared} />
          </AuthGate>
        }
      />
      <Route
        path="/owner/:businessId/:section"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="owner">
            <OwnerWorkspace {...shared} />
          </AuthGate>
        }
      />
      <Route
        path="/staff"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="staff">
            <StaffEntry {...shared} />
          </AuthGate>
        }
      />
      <Route
        path="/staff/pending"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="staff">
            <StaffPending user={session.user} logout={logout} />
          </AuthGate>
        }
      />
      <Route
        path="/staff/:businessId/:section"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="staff">
            <StaffWorkspace {...shared} />
          </AuthGate>
        }
      />
      <Route
        path="/customer/appointments"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="customer">
            <CustomerAppointments {...shared} />
          </AuthGate>
        }
      />
      <Route
        path="/customer/queue"
        element={
          <AuthGate loading={session.loading} user={session.user} intent="customer">
            <CustomerQueue {...shared} />
          </AuthGate>
        }
      />
      <Route path="/appointments/:appointmentId" element={<CustomerAppointmentDetails />} />
      <Route
        path="/book/:businessId"
        element={<PublicBooking user={session.user} sessionLoading={session.loading} />}
      />
      <Route path="/queue/entry/:credential" element={<QueueEntry />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function StaffEntry({ session }) {
  const staffBusiness = roleBusinesses(session.businesses, 'staff')[0];
  if (staffBusiness) return <Navigate to={`/staff/${staffBusiness.id}/overview`} replace />;
  const ownerBusiness = roleBusinesses(session.businesses, 'owner')[0];
  if (ownerBusiness) return <Navigate to={`/owner/${ownerBusiness.id}/overview`} replace />;
  return <Navigate to="/staff/pending" replace />;
}
