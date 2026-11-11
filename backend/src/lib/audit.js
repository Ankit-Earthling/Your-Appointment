import { AuditEvent } from '../models/index.js';

export async function recordAudit({
  tenantId = null,
  actorUserId = null,
  action,
  resourceType,
  resourceId,
  summary = '',
}) {
  await AuditEvent.create({
    tenantId,
    actorUserId,
    action,
    resourceType,
    resourceId,
    summary: summary.slice(0, 240),
    occurredAt: new Date(),
  });
}
