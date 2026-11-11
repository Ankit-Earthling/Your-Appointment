import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

describe('Your Appointment app', () => {
  it('shows the appointment and queue product entry point', async () => {
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
    expect(screen.getByRole('heading', { name: /appointments and walk-in queues/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get started' })).toBeTruthy();
  });
});
