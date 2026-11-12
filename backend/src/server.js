import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { setIo } from './lib/socket.js';
import { verifySession, SESSION_COOKIE } from './lib/security.js';
import { User, Membership, StaffAssignment, Branch, Service } from './models/index.js';
import { PublicAccessToken } from './models/index.js';
import { hashToken } from './lib/security.js';

export async function startServer({
  app = createApp({ frontendOrigin: env.FRONTEND_ORIGIN }),
  mongoUri = env.MONGODB_URI,
  port = env.PORT,
  connect = connectDatabase,
  disconnect = disconnectDatabase,
  logger = console,
} = {}) {
  try {
    await connect(mongoUri);
  } catch {
    logger.error('Initial MongoDB connection failed; API server was not started.');

    try {
      await disconnect();
    } catch {
      logger.error('MongoDB cleanup after failed startup also failed.');
    }

    process.exitCode = 1;
    return null;
  }

  if (typeof app.use !== 'function')
    return app.listen(port, () => logger.info(`Your Appointment API listening on port ${port}`));

  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    path: '/api/socket.io',
    cors: { origin: env.FRONTEND_ORIGIN, credentials: true },
  });
  setIo(io);
  io.use(async (socket, next) => {
    try {
      const publicCredential = socket.handshake.auth?.publicAccessToken;
      if (typeof publicCredential === 'string') {
        const access = await PublicAccessToken.findOne({
          tokenHash: hashToken(publicCredential),
          purpose: 'queue_ticket',
          revokedAt: null,
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        });
        if (!access) return next(new Error('authentication required'));
        socket.data.publicTicketId = String(access.resourceId);
        return next();
      }
      const raw = socket.handshake.headers.cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith(`${SESSION_COOKIE}=`))
        ?.slice(SESSION_COOKIE.length + 1);
      if (!raw) return next(new Error('authentication required'));
      const claims = verifySession(decodeURIComponent(raw));
      const user = await User.findById(claims.sub).select('_id');
      if (!user) return next(new Error('authentication required'));
      socket.data.userId = String(user._id);
      socket.join(`user:${user._id}`);
      next();
    } catch {
      next(new Error('authentication required'));
    }
  });
  io.on('connection', (socket) => {
    if (socket.data.publicTicketId) socket.join(`queue-ticket:${socket.data.publicTicketId}`);
    socket.on('tenant:join', async ({ businessId, branchId } = {}) => {
      if (!businessId || !branchId) return;
      const branch = await Branch.findOne({
        _id: branchId,
        tenantId: businessId,
        status: 'active',
      });
      if (!branch) return;
      const membership = await Membership.findOne({
        tenantId: businessId,
        userId: socket.data.userId,
        status: 'active',
      });
      if (!membership) return;
      if (membership.roles.includes('owner'))
        return socket.join(`tenant:${businessId}:branch:${branchId}`);
      const assignment = await StaffAssignment.findOne({
        tenantId: businessId,
        branchId,
        membershipId: membership._id,
        status: 'active',
      });
      if (assignment) {
        const serviceIds = assignment.serviceIds.length
          ? assignment.serviceIds
          : (
              await Service.find({
                tenantId: businessId,
                branchIds: branchId,
                status: 'active',
                queueEnabled: true,
              }).select('_id')
            ).map((service) => service._id);
        for (const serviceId of serviceIds)
          socket.join(`tenant:${businessId}:branch:${branchId}:service:${serviceId}`);
      }
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(port, () => {
      httpServer.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  logger.info(`Your Appointment API listening on port ${port}`);
  httpServer.io = io;
  return httpServer;
}

export async function shutdownServer(
  server,
  { disconnect = disconnectDatabase, logger = console, signal = 'shutdown' } = {},
) {
  logger.info(`Received ${signal}; shutting down.`);

  try {
    await new Promise((resolveClose, rejectClose) => {
      const close = server.io
        ? (callback) => server.io.close(callback)
        : (callback) => server.close(callback);
      close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }

        resolveClose();
      });
    });
  } finally {
    await disconnect();
  }
}

async function runFromCommandLine() {
  const server = await startServer();
  if (!server) return;

  let shuttingDown = false;
  const handleSignal = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    shutdownServer(server, { signal })
      .then(() => {
        process.exitCode = 0;
      })
      .catch(() => {
        console.error('Graceful shutdown failed.');
        process.exitCode = 1;
      });
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  await runFromCommandLine();
}
