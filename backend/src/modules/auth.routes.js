import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User } from '../models/index.js';
import { asyncRoute, AppError } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { authenticate } from '../middleware/authentication.js';
import { cookieOptions, SESSION_COOKIE, signSession } from '../lib/security.js';
import { loginLimiter } from '../lib/rate-limits.js';

const router = Router();
const registerSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(2).max(100),
  })
  .strict();
const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

function safeUser(user) {
  return {
    id: user._id,
    email: user.email,
    displayName: user.displayName,
    platformRoles: user.platformRoles,
  };
}

router.post(
  '/register',
  loginLimiter,
  validate(registerSchema),
  asyncRoute(async (request, response) => {
    const email = request.body.email.toLowerCase();
    if (await User.exists({ email })) {
      throw new AppError(
        409,
        'EMAIL_ALREADY_REGISTERED',
        'An account with this email already exists.',
      );
    }

    const passwordHash = await bcrypt.hash(request.body.password, 12);
    const user = await User.create({
      email,
      displayName: request.body.displayName,
      passwordHash,
    });
    response.status(201).json({ data: { user: safeUser(user) } });
  }),
);

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncRoute(async (request, response) => {
    const user = await User.findOne({ email: request.body.email.toLowerCase() }).select(
      '+passwordHash',
    );
    const validPassword = user && (await bcrypt.compare(request.body.password, user.passwordHash));
    if (!validPassword) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    response.cookie(SESSION_COOKIE, signSession(user), cookieOptions());
    response.status(200).json({ data: { user: safeUser(user) } });
  }),
);

router.post(
  '/logout',
  asyncRoute(async (request, response) => {
    const clearOptions = cookieOptions();
    delete clearOptions.maxAge;
    response.clearCookie(SESSION_COOKIE, clearOptions);
    response.status(200).json({ data: { signedOut: true } });
  }),
);

router.get('/me', authenticate, (request, response) =>
  response.status(200).json({ data: { user: safeUser(request.user) } }),
);

export default router;
