import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  Business,
  Branch,
  Membership,
  PublicAccessToken,
  QueueConfiguration,
  Service,
  StaffAssignment,
  User,
} from '../models/index.js';
import { asyncRoute, AppError } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { issuePublicToken } from '../lib/public-tokens.js';
import { hashToken } from '../lib/security.js';
import { isIanaTimezone } from '../lib/time.js';
import { validate, validateObjectIds, rejectUnknownQuery } from '../lib/validation.js';
import { authenticate, resolveMembership, requireRole } from '../middleware/authentication.js';
import { publicFlowLimiter } from '../lib/rate-limits.js';
import { env } from '../config/env.js';
import { ioRef } from '../lib/socket.js';

const router = Router();
const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const hoursSchema = z
  .array(
    z
      .object({
        dayOfWeek: z.number().int().min(0).max(6),
        opensLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        closesLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .refine(
        (hours) => hours.opensLocal < hours.closesLocal,
        'closing time must follow opening time',
      ),
  )
  .max(7)
  .refine(
    (hours) => new Set(hours.map((entry) => entry.dayOfWeek)).size === hours.length,
    'days must be unique',
  );

const businessCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    businessType: z.string().trim().max(80).optional(),
  })
  .strict();
const businessPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    businessType: z.string().trim().max(80).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');
const featureKeys = [
  'appointments',
  'walkInQueue',
  'staffSelection',
  'serviceSelection',
  'guestBooking',
  'customerAccounts',
  'notifications',
  'multipleBranches',
];
const featureSchema = z
  .object({
    features: z
      .object(Object.fromEntries(featureKeys.map((key) => [key, z.boolean().optional()])))
      .strict(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body.features).length > 0,
    'at least one feature setting is required',
  );
const branchCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string().refine(isIanaTimezone, 'must be a valid IANA timezone'),
    address: z
      .object({
        city: z.string().trim().max(100).optional(),
        countryCode: z.string().trim().length(2).optional(),
        addressLine: z.string().trim().max(200).optional(),
      })
      .strict()
      .optional(),
    operatingHours: hoursSchema.default([]),
  })
  .strict();
const branchPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    timezone: z.string().refine(isIanaTimezone, 'must be a valid IANA timezone').optional(),
    address: branchCreateSchema.shape.address.optional(),
    operatingHours: hoursSchema.optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');
const serviceCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    branchIds: z.array(idSchema).min(1),
    appointmentEnabled: z.boolean().default(false),
    queueEnabled: z.boolean().default(false),
    durationMinutes: z.number().int().min(5).max(720).default(30),
  })
  .strict()
  .refine(
    (body) => body.appointmentEnabled || body.queueEnabled,
    'service must support at least one flow',
  );
const servicePatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    branchIds: z.array(idSchema).min(1).optional(),
    appointmentEnabled: z.boolean().optional(),
    queueEnabled: z.boolean().optional(),
    durationMinutes: z.number().int().min(5).max(720).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');
const assignmentCreateSchema = z
  .object({
    email: z.string().trim().email().max(254),
    branchId: idSchema,
    serviceIds: z.array(idSchema).min(1),
    workingHours: hoursSchema.default([]),
  })
  .strict();

function businessDto(business) {
  return {
    id: business._id,
    name: business.name,
    businessType: business.businessType,
    status: business.status,
    features: business.features,
  };
}

function branchDto(branch) {
  return {
    id: branch._id,
    name: branch.name,
    timezone: branch.timezone,
    address: branch.address,
    operatingHours: branch.operatingHours,
    status: branch.status,
  };
}

function publicBranchDto(branch) {
  return {
    id: branch._id,
    name: branch.name,
    addressSummary: [branch.address?.city, branch.address?.countryCode].filter(Boolean).join(', '),
    timezone: branch.timezone,
  };
}

function serviceDto(service) {
  return {
    id: service._id,
    name: service.name,
    branchIds: service.branchIds,
    appointmentEnabled: service.appointmentEnabled,
    queueEnabled: service.queueEnabled,
    durationMinutes: service.durationMinutes,
    status: service.status,
  };
}

function publicServiceDto(service) {
  return { id: service._id, name: service.name };
}

async function assertBranchesInTenant(tenantId, branchIds) {
  const uniqueIds = [...new Set(branchIds.map(String))];
  const count = await Branch.countDocuments({
    tenantId,
    _id: { $in: uniqueIds },
    status: 'active',
  });
  if (count !== uniqueIds.length) {
    throw new AppError(
      422,
      'INVALID_RELATIONSHIP',
      'Every branch must be active and belong to this business.',
    );
  }
}

router.post(
  '/businesses',
  authenticate,
  validate(businessCreateSchema),
  asyncRoute(async (request, response) => {
    const creationKey = request.get('Idempotency-Key');
    if (creationKey && !/^[a-f\d-]{36}$/i.test(creationKey)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key must be a UUID.');
    }
    async function finishCreation(business, statusCode) {
      let membership = await Membership.findOne({
        tenantId: business._id,
        userId: request.user._id,
      });
      let createdMembership = false;
      if (membership?.status === 'inactive') {
        throw new AppError(409, 'MEMBERSHIP_INACTIVE', 'The owner membership is inactive.');
      }
      if (!membership) {
        try {
          membership = await Membership.create({
            tenantId: business._id,
            userId: request.user._id,
            roles: ['owner'],
            ...(creationKey ? { creationKey } : {}),
          });
          createdMembership = true;
        } catch (error) {
          if (error.code !== 11000) throw error;
          membership = await Membership.findOne({
            tenantId: business._id,
            userId: request.user._id,
            status: 'active',
          });
          if (!membership) throw error;
        }
      }
      if (createdMembership) {
        await recordAudit({
          tenantId: business._id,
          actorUserId: request.user._id,
          action: 'business.created',
          resourceType: 'business',
          resourceId: business._id,
          summary: 'Business and owner membership created.',
        });
      }
      response.status(statusCode).json({
        data: {
          business: businessDto(business),
          membership: { id: membership._id, roles: membership.roles },
        },
      });
    }
    if (creationKey) {
      const priorMembership = await Membership.findOne({
        userId: request.user._id,
        creationKey,
        status: 'active',
      }).select('+creationKey');
      if (priorMembership) {
        const priorBusiness = await Business.findById(priorMembership.tenantId);
        if (priorBusiness) {
          await finishCreation(priorBusiness, 200);
          return;
        }
      }
      const priorBusiness = await Business.findOne({
        createdByUserId: request.user._id,
        creationKey,
      }).select('+creationKey');
      if (priorBusiness) {
        await finishCreation(priorBusiness, 200);
        return;
      }
    }

    const _id = new mongoose.Types.ObjectId();
    let business;
    try {
      business = await Business.create({
        _id,
        tenantId: _id,
        name: request.body.name,
        businessType: request.body.businessType ?? '',
        ...(creationKey ? { createdByUserId: request.user._id, creationKey } : {}),
      });
    } catch (error) {
      if (creationKey && error.code === 11000) {
        const priorBusiness = await Business.findOne({
          createdByUserId: request.user._id,
          creationKey,
        }).select('+creationKey');
        if (priorBusiness) {
          await finishCreation(priorBusiness, 200);
          return;
        }
      }
      throw error;
    }
    await finishCreation(business, 201);
  }),
);

router.get(
  '/me/businesses',
  authenticate,
  asyncRoute(async (request, response) => {
    const memberships = await Membership.find({
      userId: request.user._id,
      status: 'active',
    }).lean();
    const businesses = await Business.find({
      _id: { $in: memberships.map((membership) => membership.tenantId) },
      status: 'active',
    });
    const membershipByTenant = new Map(
      memberships.map((membership) => [String(membership.tenantId), membership]),
    );
    response.json({
      data: businesses.map((business) => ({
        ...businessDto(business),
        membership: {
          id: membershipByTenant.get(String(business._id))._id,
          roles: membershipByTenant.get(String(business._id)).roles,
        },
      })),
    });
  }),
);

router.get(
  '/public/businesses/:businessId/branches',
  publicFlowLimiter,
  validateObjectIds('businessId'),
  rejectUnknownQuery(['flow', 'limit', 'cursor']),
  asyncRoute(async (request, response) => {
    const flow = request.query.flow;
    if (!['appointments', 'walk-in-queue'].includes(flow)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'flow must be appointments or walk-in-queue.');
    }
    const business = await Business.findOne({ _id: request.params.businessId, status: 'active' });
    const feature = flow === 'appointments' ? 'appointments' : 'walkInQueue';
    if (!business) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Business was not found.');
    if (!business.features[feature])
      throw new AppError(403, 'FEATURE_DISABLED', 'This service is not available.');
    const branches = await Branch.find({ tenantId: business._id, status: 'active' })
      .sort({ createdAt: 1 })
      .limit(50);
    response.json({
      data: branches.map(publicBranchDto),
      meta: { nextCursor: null, limit: branches.length },
    });
  }),
);

router.get(
  '/public/branches/:branchId/services',
  publicFlowLimiter,
  validateObjectIds('branchId'),
  rejectUnknownQuery(['flow', 'limit', 'cursor']),
  asyncRoute(async (request, response) => {
    const flow = request.query.flow;
    if (!['appointments', 'walk-in-queue'].includes(flow)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'flow must be appointments or walk-in-queue.');
    }
    const branch = await Branch.findOne({ _id: request.params.branchId, status: 'active' });
    const business = branch && (await Business.findOne({ _id: branch.tenantId, status: 'active' }));
    const feature = flow === 'appointments' ? 'appointments' : 'walkInQueue';
    if (!business || !branch)
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    if (!business.features[feature])
      throw new AppError(403, 'FEATURE_DISABLED', 'This service is not available.');
    const capability = flow === 'appointments' ? 'appointmentEnabled' : 'queueEnabled';
    const services = await Service.find({
      tenantId: business._id,
      branchIds: branch._id,
      status: 'active',
      [capability]: true,
    })
      .sort({ name: 1 })
      .limit(50);
    response.json({
      data: services.map(publicServiceDto),
      meta: { nextCursor: null, limit: services.length },
    });
  }),
);

router.get(
  '/public/qr/:credential',
  publicFlowLimiter,
  asyncRoute(async (request, response) => {
    const token = await PublicAccessToken.findOne({
      tokenHash: hashToken(request.params.credential),
      purpose: 'branch_qr',
      revokedAt: null,
    });
    if (!token) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'QR entry point was not found.');
    const branch = await Branch.findOne({
      _id: token.resourceId,
      tenantId: token.tenantId,
      status: 'active',
    });
    const business = branch && (await Business.findOne({ _id: token.tenantId, status: 'active' }));
    if (!business || !branch)
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'QR entry point was not found.');
    if (!business.features.walkInQueue)
      throw new AppError(403, 'FEATURE_DISABLED', 'Walk-in queue is disabled.');
    const services = await Service.find({
      tenantId: business._id,
      branchIds: branch._id,
      status: 'active',
      queueEnabled: true,
    }).sort({ name: 1 });
    response.json({
      data: { branch: publicBranchDto(branch), services: services.map(publicServiceDto) },
    });
  }),
);

router.get(
  '/businesses/:businessId',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  (request, response) => {
    response.json({ data: { business: businessDto(request.business) } });
  },
);

router.patch(
  '/businesses/:businessId',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  requireRole('owner'),
  validate(businessPatchSchema),
  asyncRoute(async (request, response) => {
    Object.assign(request.business, request.body);
    await request.business.save();
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'business.updated',
      resourceType: 'business',
      resourceId: request.business._id,
      summary: 'Business profile updated.',
    });
    response.json({ data: { business: businessDto(request.business) } });
  }),
);

router.patch(
  '/businesses/:businessId/feature-settings',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  requireRole('owner'),
  validate(featureSchema),
  asyncRoute(async (request, response) => {
    request.business.features = {
      ...request.business.features.toObject?.(),
      ...request.business.features,
      ...request.body.features,
    };
    await request.business.save();
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'business.features_updated',
      resourceType: 'business',
      resourceId: request.business._id,
      summary: 'Business feature settings updated.',
    });
    response.json({ data: { features: request.business.features } });
  }),
);

router.post(
  '/businesses/:businessId/branches',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  requireRole('owner'),
  validate(branchCreateSchema),
  asyncRoute(async (request, response) => {
    if (
      !request.business.features.multipleBranches &&
      (await Branch.countDocuments({ tenantId: request.tenantId, status: 'active' })) > 0
    ) {
      throw new AppError(
        403,
        'FEATURE_DISABLED',
        'Enable multiple branches to add another branch.',
      );
    }
    const branch = await Branch.create({ tenantId: request.tenantId, ...request.body });
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'branch.created',
      resourceType: 'branch',
      resourceId: branch._id,
      summary: 'Branch created.',
    });
    response.status(201).json({ data: { branch: branchDto(branch) } });
  }),
);

router.patch(
  '/businesses/:businessId/staff-assignments/:assignmentId',
  authenticate,
  validateObjectIds('businessId', 'assignmentId'),
  resolveMembership,
  requireRole('owner'),
  validate(
    z
      .object({
        serviceIds: z.array(idSchema).min(1).optional(),
        status: z.enum(['active', 'inactive']).optional(),
      })
      .strict()
      .refine((body) => Object.keys(body).length > 0),
  ),
  asyncRoute(async (request, response) => {
    const assignment = await StaffAssignment.findOne({
      _id: request.params.assignmentId,
      tenantId: request.tenantId,
    });
    if (!assignment)
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Staff assignment was not found.');
    if (request.body.serviceIds) {
      const count = await Service.countDocuments({
        tenantId: request.tenantId,
        _id: { $in: request.body.serviceIds },
        branchIds: assignment.branchId,
        status: 'active',
      });
      if (count !== new Set(request.body.serviceIds).size)
        throw new AppError(
          422,
          'INVALID_RELATIONSHIP',
          'Each assigned service must be active at this branch.',
        );
      assignment.serviceIds = request.body.serviceIds;
    }
    if (request.body.status) assignment.status = request.body.status;
    await assignment.save();
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'staff.assignment_updated',
      resourceType: 'staff_assignment',
      resourceId: assignment._id,
      summary: 'Staff branch/service assignment updated.',
    });
    ioRef()
      ?.to(`tenant:${request.tenantId}:branch:${assignment.branchId}`)
      .emit('staff.assignment.updated', { branchId: assignment.branchId });
    const targetMembership = await Membership.findById(assignment.membershipId).select('userId');
    if (targetMembership) ioRef()?.in(`user:${targetMembership.userId}`).disconnectSockets(true);
    response.json({
      data: { id: assignment._id, serviceIds: assignment.serviceIds, status: assignment.status },
    });
  }),
);

router.get(
  '/businesses/:businessId/branches',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  asyncRoute(async (request, response) => {
    const branchFilter = { tenantId: request.tenantId };
    if (request.membership.roles.includes('staff') && !request.membership.roles.includes('owner')) {
      const assignments = await StaffAssignment.find({
        tenantId: request.tenantId,
        membershipId: request.membership._id,
        status: 'active',
      }).select('branchId');
      branchFilter._id = { $in: assignments.map((assignment) => assignment.branchId) };
    }
    const branches = await Branch.find(branchFilter).sort({ createdAt: 1 });
    response.json({ data: branches.map(branchDto) });
  }),
);

router.patch(
  '/businesses/:businessId/branches/:branchId',
  authenticate,
  validateObjectIds('businessId', 'branchId'),
  resolveMembership,
  requireRole('owner'),
  validate(branchPatchSchema),
  asyncRoute(async (request, response) => {
    const branch = await Branch.findOne({
      _id: request.params.branchId,
      tenantId: request.tenantId,
    });
    if (!branch) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    Object.assign(branch, request.body);
    await branch.save();
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'branch.updated',
      resourceType: 'branch',
      resourceId: branch._id,
      summary: 'Branch settings updated.',
    });
    response.json({ data: { branch: branchDto(branch) } });
  }),
);

router.post(
  '/businesses/:businessId/services',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  requireRole('owner'),
  validate(serviceCreateSchema),
  asyncRoute(async (request, response) => {
    await assertBranchesInTenant(request.tenantId, request.body.branchIds);
    if (request.body.appointmentEnabled && !request.business.features.appointments) {
      throw new AppError(
        403,
        'FEATURE_DISABLED',
        'Enable appointments before adding appointment services.',
      );
    }
    if (request.body.queueEnabled && !request.business.features.walkInQueue) {
      throw new AppError(
        403,
        'FEATURE_DISABLED',
        'Enable walk-in queue before adding queue services.',
      );
    }
    const service = await Service.create({ tenantId: request.tenantId, ...request.body });
    if (service.queueEnabled) {
      await Promise.all(
        service.branchIds.map((branchId) =>
          QueueConfiguration.updateOne(
            { tenantId: request.tenantId, branchId, serviceId: service._id },
            {
              $setOnInsert: {
                tenantId: request.tenantId,
                branchId,
                serviceId: service._id,
                isOpen: true,
              },
            },
            { upsert: true },
          ),
        ),
      );
    }
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'service.created',
      resourceType: 'service',
      resourceId: service._id,
      summary: 'Service created.',
    });
    response.status(201).json({ data: { service: serviceDto(service) } });
  }),
);

router.get(
  '/businesses/:businessId/services',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  asyncRoute(async (request, response) => {
    const serviceFilter = { tenantId: request.tenantId };
    if (request.membership.roles.includes('staff') && !request.membership.roles.includes('owner')) {
      const assignments = await StaffAssignment.find({
        tenantId: request.tenantId,
        membershipId: request.membership._id,
        status: 'active',
      }).select('branchId serviceIds');
      if (!assignments.some((assignment) => assignment.serviceIds.length === 0)) {
        serviceFilter._id = {
          $in: [...new Set(assignments.flatMap((assignment) => assignment.serviceIds.map(String)))],
        };
      }
      serviceFilter.branchIds = { $in: assignments.map((assignment) => assignment.branchId) };
    }
    const services = await Service.find(serviceFilter).sort({ name: 1 });
    response.json({ data: services.map(serviceDto) });
  }),
);

router.patch(
  '/businesses/:businessId/services/:serviceId',
  authenticate,
  validateObjectIds('businessId', 'serviceId'),
  resolveMembership,
  requireRole('owner'),
  validate(servicePatchSchema),
  asyncRoute(async (request, response) => {
    const service = await Service.findOne({
      _id: request.params.serviceId,
      tenantId: request.tenantId,
    });
    if (!service) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Service was not found.');
    const branchIds = request.body.branchIds ?? service.branchIds;
    await assertBranchesInTenant(request.tenantId, branchIds);
    if (request.body.appointmentEnabled && !request.business.features.appointments) {
      throw new AppError(403, 'FEATURE_DISABLED', 'Appointments are disabled for this business.');
    }
    if (request.body.queueEnabled && !request.business.features.walkInQueue) {
      throw new AppError(403, 'FEATURE_DISABLED', 'Walk-in queue is disabled for this business.');
    }
    Object.assign(service, request.body);
    await service.save();
    if (service.queueEnabled) {
      await Promise.all(
        service.branchIds.map((branchId) =>
          QueueConfiguration.updateOne(
            { tenantId: request.tenantId, branchId, serviceId: service._id },
            {
              $setOnInsert: {
                tenantId: request.tenantId,
                branchId,
                serviceId: service._id,
                isOpen: true,
              },
            },
            { upsert: true },
          ),
        ),
      );
    }
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'service.updated',
      resourceType: 'service',
      resourceId: service._id,
      summary: 'Service settings updated.',
    });
    response.json({ data: { service: serviceDto(service) } });
  }),
);

router.post(
  '/businesses/:businessId/staff-assignments',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  requireRole('owner'),
  validate(assignmentCreateSchema),
  asyncRoute(async (request, response) => {
    const email = request.body.email.toLowerCase();
    const staffUser = await User.findOne({ email });
    if (!staffUser)
      throw new AppError(
        404,
        'STAFF_ACCOUNT_NOT_FOUND',
        'Ask the staff member to create an account first.',
      );
    const branch = await Branch.findOne({
      _id: request.body.branchId,
      tenantId: request.tenantId,
      status: 'active',
    });
    if (!branch)
      throw new AppError(
        422,
        'INVALID_RELATIONSHIP',
        'Branch must be active and belong to this business.',
      );
    if (request.body.serviceIds.length) {
      const serviceCount = await Service.countDocuments({
        tenantId: request.tenantId,
        _id: { $in: request.body.serviceIds },
        branchIds: branch._id,
        status: 'active',
      });
      if (serviceCount !== new Set(request.body.serviceIds).size) {
        throw new AppError(
          422,
          'INVALID_RELATIONSHIP',
          'Each assigned service must be active at this branch.',
        );
      }
    }

    let membership = await Membership.findOne({
      tenantId: request.tenantId,
      userId: staffUser._id,
    });
    if (membership) {
      membership.roles = [...new Set([...membership.roles, 'staff'])];
      membership.status = 'active';
      await membership.save();
    } else {
      membership = await Membership.create({
        tenantId: request.tenantId,
        userId: staffUser._id,
        roles: ['staff'],
      });
    }

    const assignment = await StaffAssignment.findOneAndUpdate(
      { tenantId: request.tenantId, membershipId: membership._id, branchId: branch._id },
      {
        $set: {
          serviceIds: request.body.serviceIds,
          workingHours: request.body.workingHours,
          status: 'active',
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'staff.assignment_updated',
      resourceType: 'staff_assignment',
      resourceId: assignment._id,
      summary: 'Staff branch/service assignment updated.',
    });
    ioRef()
      ?.to(`tenant:${request.tenantId}:branch:${branch._id}`)
      .emit('staff.assignment.updated', { branchId: branch._id });
    ioRef()?.in(`user:${staffUser._id}`).disconnectSockets(true);
    response.status(201).json({
      data: {
        assignment: {
          id: assignment._id,
          membershipId: membership._id,
          user: { id: staffUser._id, email: staffUser.email, displayName: staffUser.displayName },
          branchId: branch._id,
          serviceIds: assignment.serviceIds,
          status: assignment.status,
        },
      },
    });
  }),
);

router.get(
  '/businesses/:businessId/staff-assignments',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  asyncRoute(async (request, response) => {
    let query = { tenantId: request.tenantId };
    if (request.membership.roles.includes('staff')) {
      query.membershipId = request.membership._id;
    } else if (!request.membership.roles.includes('owner')) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view staff assignments.');
    }
    const assignments = await StaffAssignment.find(query).populate(
      'membershipId',
      'userId roles status',
    );
    const userIds = assignments
      .map((assignment) => assignment.membershipId?.userId)
      .filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } }).select('email displayName');
    const userById = new Map(users.map((user) => [String(user._id), user]));
    response.json({
      data: assignments.map((assignment) => ({
        id: assignment._id,
        membershipId: assignment.membershipId?._id,
        user: userById.get(String(assignment.membershipId?.userId))
          ? {
              id: assignment.membershipId.userId,
              email: userById.get(String(assignment.membershipId.userId)).email,
              displayName: userById.get(String(assignment.membershipId.userId)).displayName,
            }
          : null,
        branchId: assignment.branchId,
        serviceIds: assignment.serviceIds,
        workingHours: assignment.workingHours,
        status: assignment.status,
      })),
    });
  }),
);

router.post(
  '/businesses/:businessId/branches/:branchId/queue-qr-rotations',
  authenticate,
  validateObjectIds('businessId', 'branchId'),
  resolveMembership,
  requireRole('owner'),
  asyncRoute(async (request, response) => {
    if (!request.business.features.walkInQueue)
      throw new AppError(403, 'FEATURE_DISABLED', 'Walk-in queue is disabled.');
    const branch = await Branch.findOne({
      _id: request.params.branchId,
      tenantId: request.tenantId,
      status: 'active',
    });
    if (!branch) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    await PublicAccessToken.updateMany(
      { tenantId: request.tenantId, resourceId: branch._id, purpose: 'branch_qr', revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    const credential = await issuePublicToken({
      tenantId: request.tenantId,
      purpose: 'branch_qr',
      resourceId: branch._id,
    });
    const entryUrl = new URL(
      `/queue/entry/${encodeURIComponent(credential)}`,
      env.FRONTEND_ORIGIN,
    ).toString();
    await recordAudit({
      tenantId: request.tenantId,
      actorUserId: request.user._id,
      action: 'branch.qr_rotated',
      resourceType: 'branch',
      resourceId: branch._id,
      summary: 'Branch queue QR credential rotated.',
    });
    response.status(201).json({ data: { entryUrl, credential } });
  }),
);

export default router;
