import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { PublicQueueTicket } from './RolePages.jsx';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), disconnect: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Your Appointment app', () => {
  it('lets a guest decline post-service profile creation without sending profile data', async () => {
    const requests = [];
    window.location.hash = '#synthetic-ticket-token';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ticket: {
                id: 'ticket-1',
                status: 'COMPLETED',
                sequenceNumber: 3,
                joinedAt: '2026-11-12T10:00:00Z',
                peopleAhead: 0,
                service: { name: 'Room A' },
                branch: { name: 'Central', timezone: 'Asia/Kolkata' },
              },
            },
          }),
        };
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/queue/ticket/ticket-1']}>
        <PublicQueueTicket />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Save my details with this business/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(await screen.findByText('No profile was created.')).toBeTruthy();
    expect(requests.some(({ url }) => url.endsWith('/profile'))).toBe(false);
    window.location.hash = '';
  });

  it('requires explicit consent before saving a guest profile', async () => {
    const requests = [];
    window.location.hash = '#synthetic-ticket-token';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ticket: {
                id: 'ticket-1',
                status: 'COMPLETED',
                sequenceNumber: 3,
                joinedAt: '2026-11-12T10:00:00Z',
                peopleAhead: 0,
                service: { name: 'Room A' },
                branch: { name: 'Central', timezone: 'Asia/Kolkata' },
              },
            },
          }),
        };
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/queue/ticket/ticket-1']}>
        <PublicQueueTicket />
      </MemoryRouter>,
    );

    const save = await screen.findByRole('button', { name: 'Save my details' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(save);
    expect(await screen.findByText('Your profile was saved.')).toBeTruthy();
    expect(
      requests.some(({ url, options }) => url.endsWith('/profile') && options.method === 'POST'),
    ).toBe(true);
    window.location.hash = '';
  });

  it('shows the public appointment and queue entry points', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Sign in' } }) }),
    );
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText('Appointments and live queues')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: /a calmer way to manage every visit/i }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set up your business' })).toHaveAttribute(
      'href',
      '/auth?intent=owner',
    );
    expect(screen.getByRole('link', { name: 'Customer sign in' })).toHaveAttribute(
      'href',
      '/auth?intent=customer',
    );
  });

  it('honors the customer sign-in choice for a user who also owns a business', async () => {
    const requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        requests.push({ url, options });
        if (url.endsWith('/auth/me')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: { message: 'Sign in' } }),
          };
        }
        const data = url.endsWith('/auth/login')
          ? { user: { id: 'user-1', email: 'owner@example.test', displayName: 'Owner' } }
          : url.endsWith('/me/businesses')
            ? [
                {
                  id: 'business-1',
                  name: 'My Business',
                  membership: { roles: ['owner'] },
                },
              ]
            : [];
        return { ok: true, status: 200, json: async () => ({ data }) };
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/auth?intent=customer']}>
        <App />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'valid-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'My Appointments' })).toBeTruthy();
    await waitFor(() =>
      expect(requests.some(({ url }) => url.endsWith('/me/appointments'))).toBe(true),
    );
    expect(requests.some(({ url }) => url.endsWith('/businesses/business-1'))).toBe(false);
  });

  it('loads the owner dashboard from the legacy workspace URL using API-unwrapped arrays', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        let data = [];
        if (url.endsWith('/auth/me')) {
          data = { user: { id: 'owner-1', email: 'owner@example.test', displayName: 'Owner' } };
        } else if (url.endsWith('/me/businesses')) {
          data = [
            {
              id: 'business-1',
              name: 'Alok’s Derma',
              membership: { roles: ['owner'] },
            },
          ];
        } else if (url.endsWith('/businesses/business-1')) {
          data = {
            business: {
              id: 'business-1',
              name: 'Alok’s Derma',
              features: { multipleBranches: true },
            },
          };
        } else if (url.endsWith('/businesses/business-1/branches')) {
          data = [
            {
              id: 'branch-1',
              name: 'Central Clinic',
              timezone: 'Asia/Kolkata',
              operatingHours: [],
            },
          ];
        } else if (url.endsWith('/businesses/business-1/customers')) {
          data = [
            {
              id: 'customer-1',
              displayName: 'Demo Customer',
              email: 'customer@example.test',
              phone: '',
              count: 1,
              lastAt: '2026-11-12T10:00:00.000Z',
            },
          ];
        } else if (url.includes('/queue-qr-rotations')) {
          data = { entryUrl: 'http://localhost:5173/queue/entry/synthetic-credential' };
        } else if (url.endsWith('/businesses/business-1/analytics')) {
          data = { appointments: { BOOKED: 0 }, queueTickets: { WAITING: 0 } };
        }
        return { ok: true, status: 200, json: async () => ({ data }) };
      }),
    );
    render(
      <MemoryRouter initialEntries={['/workspace/business-1/overview']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.getAllByText('Alok’s Derma').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Branches' })).toHaveAttribute(
      'href',
      '/owner/business-1/branches',
    );
    expect(screen.getByLabelText('Branch')).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Public Booking Link' }));
    expect(await screen.findByRole('heading', { name: 'Public Booking Link' })).toBeTruthy();
    expect(screen.getByLabelText('Customer booking page').value).toContain('/book/business-1');
    await user.click(screen.getByRole('link', { name: 'QR Entry Links' }));
    await user.selectOptions(await screen.findByLabelText('Branch'), 'branch-1');
    await user.click(screen.getByRole('button', { name: 'Generate QR entry link' }));
    expect(await screen.findByRole('img', { name: 'Branch queue entry QR code' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open queue entry page' })).toHaveAttribute(
      'href',
      'http://localhost:5173/queue/entry/synthetic-credential',
    );
    await user.click(screen.getByRole('link', { name: 'Customers' }));
    expect(await screen.findByText('Demo Customer')).toBeTruthy();
  });

  it('opens the owner dashboard after selecting an existing business', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        let data = [];
        if (url.endsWith('/auth/me')) {
          data = { user: { id: 'owner-1', email: 'owner@example.test', displayName: 'Owner' } };
        } else if (url.endsWith('/me/businesses')) {
          data = [{ id: 'business-1', name: 'Alok’s Derma', membership: { roles: ['owner'] } }];
        } else if (url.endsWith('/businesses/business-1')) {
          data = {
            business: { id: 'business-1', name: 'Alok’s Derma', features: {} },
          };
        } else if (url.endsWith('/businesses/business-1/analytics')) {
          data = { appointments: {}, queueTickets: {} };
        }
        return { ok: true, status: 200, json: async () => ({ data }) };
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/owner']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Choose a business' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /Alok’s Derma/ }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute(
      'href',
      '/owner/business-1/staff',
    );
  });

  it('shows an actionable workspace error and can retry a failed business request', async () => {
    let businessRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        let response = { ok: true, status: 200, data: [] };
        if (url.endsWith('/auth/me')) {
          response.data = {
            user: { id: 'owner-1', email: 'owner@example.test', displayName: 'Owner' },
          };
        } else if (url.endsWith('/me/businesses')) {
          response.data = [
            { id: 'business-1', name: 'Alok’s Derma', membership: { roles: ['owner'] } },
          ];
        } else if (url.endsWith('/businesses/business-1')) {
          businessRequests += 1;
          if (businessRequests === 1) {
            return {
              ok: false,
              status: 403,
              json: async () => ({ error: { message: 'Owner access is required.' } }),
            };
          }
          response.data = {
            business: { id: 'business-1', name: 'Alok’s Derma', features: {} },
          };
        } else if (url.endsWith('/businesses/business-1/analytics')) {
          response.data = { appointments: {}, queueTickets: {} };
        }
        return {
          ok: response.ok,
          status: response.status,
          json: async () => ({ data: response.data }),
        };
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/owner/business-1/overview']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Owner access is required.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry loading workspace' }));
    await waitFor(() => expect(screen.getAllByText('Alok’s Derma').length).toBeGreaterThan(0));
    expect(businessRequests).toBe(2);
  });

  it('loads public branches and services from the unwrapped API arrays', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.endsWith('/auth/me')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: { message: 'Sign in' } }),
          };
        }
        const data = url.includes('/public/businesses/business-1/branches')
          ? [{ id: 'branch-1', name: 'Central Clinic', timezone: 'Asia/Kolkata' }]
          : url.includes('/public/branches/branch-1/services')
            ? [{ id: 'service-1', name: 'Consultation', durationMinutes: 30 }]
            : { timezone: 'Asia/Kolkata', durationMinutes: 30, slots: [] };
        return { ok: true, status: 200, json: async () => ({ data }) };
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/book/business-1']}>
        <App />
      </MemoryRouter>,
    );

    const branchSelect = await screen.findByLabelText('Branch');
    await user.selectOptions(branchSelect, 'branch-1');
    const serviceSelect = await screen.findByLabelText('Service');
    await waitFor(() => expect(serviceSelect).toHaveValue(''));
    expect(screen.getByRole('option', { name: 'Consultation' })).toBeTruthy();
  });
});
