import { User, Membership, Business, StaffAssignment } from '../models/index.js';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE, verifySession } from '../lib/security.js';

function readSessionToken(request) {
  return request.cookies?.[SESSION_COOKIE];
}

export async function maybeAuthenticate(request, response, next) {
  const token = readSessionToken(request);
  if (!token) return next();

  try {
    const claims = verifySession(token);
    const user = await User.findById(claims.sub).select('_id email displayName platformRoles');
    if (user) request.user = user;
  } catch {
    // Invalid or expired optional sessions do not turn a public request into a private one.
  }
  next();
}

export async function authenticate(request, response, next) {
  const token = readSessionToken(request);
  if (!token) return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.'));

  try {
    const claims = verifySession(token);
    const user = await User.findById(claims.sub).select('_id email displayName platformRoles');
    if (!user) throw new Error('Unknown session user');
    request.user = user;
    next();
  } catch {
    next(new AppError(401, 'CREDENTIAL_EXPIRED', 'Your session has expired. Sign in again.'));
  }
}

export async function resolveMembership(request, response, next) {
  try {
    const businessId = request.params.businessId;
    const [business, membership] = await Promise.all([
      Business.findById(businessId),
      Membership.findOne({
        tenantId: businessId,
        userId: request.user._id,
        status: 'active',
      }),
    ]);

    if (!business || business.status !== 'active' || !membership) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Business was not found.');
    }

    request.business = business;
    request.membership = membership;
    request.tenantId = business._id;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.membership?.roles.some((role) => roles.includes(role))) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      return;
    }
    next();
  };
}

export async function requireBranchScope(request, response, next) {
  try {
    if (request.membership.roles.includes('owner')) return next();

    const branchId = request.params.branchId ?? request.body.branchId ?? request.query.branchId;
    if (!branchId) {
      throw new AppError(403, 'FORBIDDEN', 'A branch assignment is required for this action.');
    }

    const assignment = await StaffAssignment.findOne({
      tenantId: request.tenantId,
      membershipId: request.membership._id,
      branchId,
      status: 'active',
    });
    if (!assignment)
      throw new AppError(403, 'FORBIDDEN', 'This branch is outside your assignment.');
    request.staffAssignment = assignment;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireOrigin(frontendOrigin) {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (request, response, next) => {
    if (safeMethods.has(request.method)) return next();

    const origin = request.get('origin');
    const hasSessionCookie = Boolean(request.cookies?.[SESSION_COOKIE]);
    if (origin && origin !== frontendOrigin) {
      next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.'));
      return;
    }
    if (hasSessionCookie && origin !== frontendOrigin) {
      next(new AppError(403, 'ORIGIN_REQUIRED', 'A valid request origin is required.'));
      return;
    }
    next();
  };
}
