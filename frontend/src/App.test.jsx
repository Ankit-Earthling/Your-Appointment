import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';

describe('Your Appointment app', () => {
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
});
