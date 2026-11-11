import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './modules/auth.routes.js';
import businessRoutes from './modules/business.routes.js';
import journeyRoutes from './modules/journeys.routes.js';
import { requireOrigin } from './middleware/authentication.js';
import { getDatabaseStatus } from './db/connection.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp({
  databaseStatus = getDatabaseStatus,
  frontendOrigin = 'http://localhost:5173',
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: frontendOrigin,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Public-Access-Token'],
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(requireOrigin(frontendOrigin));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (request, response) => {
    response.status(200).json({
      status: 'ok',
      database: databaseStatus(),
    });
  });

  const api = express.Router();
  api.use('/auth', authRoutes);
  api.use(businessRoutes);
  api.use(journeyRoutes);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
