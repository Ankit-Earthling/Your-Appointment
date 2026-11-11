import rateLimit from 'express-rate-limit';

function publicRateLimit(limit, windowMs) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response) {
      response.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
      });
    },
  });
}

export const loginLimiter = publicRateLimit(10, 15 * 60 * 1000);
export const publicFlowLimiter = publicRateLimit(60, 60 * 1000);
