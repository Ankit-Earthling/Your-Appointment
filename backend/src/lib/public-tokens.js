import { AppError } from './errors.js';
import { createPublicToken, hashToken } from './security.js';
import { PublicAccessToken } from '../models/index.js';

export async function issuePublicToken({ tenantId, purpose, resourceId, expiresAt = null }) {
  const token = createPublicToken();
  await PublicAccessToken.create({
    tenantId,
    purpose,
    resourceId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

export async function verifyPublicToken({ token, purpose, resourceId }) {
  if (!token || typeof token !== 'string' || token.length > 200) {
    throw new AppError(404, 'RESOURCE_NOT_FOUND', 'The requested item was not found.');
  }

  const record = await PublicAccessToken.findOne({
    tokenHash: hashToken(token),
    purpose,
    resourceId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });
  if (!record) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'The requested item was not found.');
  return record;
}
