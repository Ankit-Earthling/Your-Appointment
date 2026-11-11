import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { shutdownServer, startServer } from './server.js';

describe('backend foundation', () => {
  it.each(['connected', 'disconnected'])(
    'reports application and database status (%s) without connection details',
    async (databaseStatus) => {
      const app = createApp({ databaseStatus: () => databaseStatus });
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', database: databaseStatus });
      expect(JSON.stringify(response.body)).not.toContain('mongodb://');
    },
  );

  it('returns a centralized not-found error for unknown routes', async () => {
    const app = createApp();
    const response = await request(app).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Route not found: GET /missing',
    });
  });

  it('returns a safe centralized error for malformed JSON', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"invalid":');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'REQUEST_ERROR',
      message: 'Request body must contain valid JSON.',
    });
  });

  it('connects to MongoDB before opening the HTTP listener', async () => {
    const events = [];
    const server = {};
    const app = {
      listen: vi.fn((port, onListening) => {
        events.push(`listen:${port}`);
        onListening();
        return server;
      }),
    };

    const result = await startServer({
      app,
      mongoUri: 'mongodb://localhost/example',
      port: 4100,
      connect: async (uri) => events.push(`connect:${uri}`),
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result).toBe(server);
    expect(events).toEqual(['connect:mongodb://localhost/example', 'listen:4100']);
  });

  it('does not listen and sets a failing exit code when initial connection fails', async () => {
    const previousExitCode = process.exitCode;
    const logger = { info: vi.fn(), error: vi.fn() };
    const app = { listen: vi.fn() };
    const disconnect = vi.fn();

    try {
      const result = await startServer({
        app,
        mongoUri: 'mongodb://user:secret@localhost/example',
        connect: async () => {
          throw new Error('mongodb://user:secret@localhost/example is unavailable');
        },
        disconnect,
        logger,
      });

      expect(result).toBeNull();
      expect(process.exitCode).toBe(1);
      expect(app.listen).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(logger.error.mock.calls.flat().join(' ')).not.toContain('secret');
      expect(logger.error).toHaveBeenCalledWith(
        'Initial MongoDB connection failed; API server was not started.',
      );
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('closes the HTTP listener before disconnecting MongoDB', async () => {
    const events = [];
    const server = {
      close: vi.fn((callback) => {
        events.push('server closed');
        callback();
      }),
    };

    await shutdownServer(server, {
      signal: 'SIGTERM',
      disconnect: async () => events.push('database disconnected'),
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(events).toEqual(['server closed', 'database disconnected']);
  });
});
