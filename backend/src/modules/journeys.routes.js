import { Router } from 'express';
import { z } from 'zod';
import {
  Appointment,
  Branch,
  Business,
  CustomerProfile,
  QueueConfiguration,
  QueueCounter,
  QueueTicket,
  ReservationCalendar,
  Service,
  StaffAssignment,
  User,
} from '../models/index.js';
import { AppError, asyncRoute } from '../lib/errors.js';
import { issuePublicToken, verifyPublicToken } from '../lib/public-tokens.js';
import { localDate, localTimeToUtc, parseInstant, scheduleAllows } from '../lib/time.js';
import {
  authenticate,
  maybeAuthenticate,
  resolveMembership,
  requireRole,
  requireBranchScope,
} from '../middleware/authentication.js';
import { publicFlowLimiter } from '../lib/rate-limits.js';
import { validate, validateObjectIds } from '../lib/validation.js';
import { ioRef } from '../lib/socket.js';
import { recordAudit } from '../lib/audit.js';

const router = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i);
const booking = z
  .object({
    branchId: id,
    serviceId: id,
    staffAssignmentId: id.optional(),
    startAt: z.string().datetime(),
    displayName: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(30).optional(),
  })
  .strict();
const join = z
  .object({
    serviceId: id,
    displayName: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .strict();
const callNextBody = z.object({ serviceId: id }).strict();
const statusBody = z
  .object({ status: z.enum(['CALLED', 'SERVING', 'COMPLETED', 'NO_SHOW', 'CANCELLED']) })
  .strict();

async function customer(tenantId, user, body) {
  if (user)
    return CustomerProfile.findOneAndUpdate(
      { tenantId, userId: user._id },
      { $set: { displayName: user.displayName, email: user.email } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  return CustomerProfile.create({
    tenantId,
    displayName: body.displayName,
    email: body.email ?? '',
    phone: body.phone ?? '',
  });
}
function emitQueue(tenantId, branchId, payload) {
  const io = ioRef();
  if (!io) return;
  io.to(`tenant:${tenantId}:branch:${branchId}`).emit('queue.updated', payload);
  if (payload.serviceId)
    io.to(`tenant:${tenantId}:branch:${branchId}:service:${payload.serviceId}`).emit(
      'queue.updated',
      payload,
    );
}

router.get(
  '/public/branches/:branchId/availability',
  publicFlowLimiter,
  validateObjectIds('branchId'),
  asyncRoute(async (req, res) => {
    const serviceId = req.query.serviceId;
    if (!/^[a-f\d]{24}$/i.test(serviceId ?? ''))
      throw new AppError(400, 'VALIDATION_ERROR', 'serviceId is required.');
    const branch = await Branch.findOne({ _id: req.params.branchId, status: 'active' });
    const business = branch && (await Business.findOne({ _id: branch.tenantId, status: 'active' }));
    if (!branch || !business)
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    if (!business.features.appointments)
      throw new AppError(403, 'FEATURE_DISABLED', 'Appointments are disabled.');
    if (!business.features.guestBooking && !business.features.customerAccounts)
      throw new AppError(403, 'FEATURE_DISABLED', 'Booking is unavailable.');
    const service = await Service.findOne({
      _id: serviceId,
      tenantId: business._id,
      branchIds: branch._id,
      status: 'active',
      appointmentEnabled: true,
    });
    if (!service) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Service was not found.');
    const date = String(req.query.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'date must be YYYY-MM-DD in the branch timezone.',
      );
    const assignments = await StaffAssignment.find({
      tenantId: business._id,
      branchId: branch._id,
      status: 'active',
      $or: [{ serviceIds: service._id }, { serviceIds: { $size: 0 } }],
    });
    const slots = [];
    const now = Date.now();
    for (const staff of assignments)
      for (let minute = 0; minute < 1440; minute += 15) {
        const start = localTimeToUtc(date, minute, branch.timezone);
        if (!start) continue;
        const end = new Date(start.getTime() + service.durationMinutes * 60000);
        if (
          start.getTime() <= now ||
          !scheduleAllows(branch.operatingHours, branch.timezone, start, end) ||
          !scheduleAllows(staff.workingHours, branch.timezone, start, end)
        )
          continue;
        const calendar = await ReservationCalendar.findOne({
          tenantId: business._id,
          staffAssignmentId: staff._id,
          localDate: date,
        });
        if (calendar?.reservations.some((r) => r.startAt < end && r.endAt > start)) continue;
        slots.push({
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          staffAssignmentId: staff._id,
        });
      }
    res.json({
      data: { timezone: branch.timezone, durationMinutes: service.durationMinutes, slots },
    });
  }),
);

router.post(
  '/public/branches/:branchId/appointments',
  publicFlowLimiter,
  maybeAuthenticate,
  validateObjectIds('branchId'),
  validate(booking.omit({ branchId: true })),
  asyncRoute(async (req, res) => {
    const branch = await Branch.findOne({ _id: req.params.branchId, status: 'active' });
    const business = branch && (await Business.findOne({ _id: branch.tenantId, status: 'active' }));
    if (!branch || !business)
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    if (!business.features.appointments)
      throw new AppError(403, 'FEATURE_DISABLED', 'Appointments are disabled.');
    if (req.user && !business.features.customerAccounts)
      throw new AppError(403, 'FEATURE_DISABLED', 'Customer accounts are disabled.');
    if (!req.user && !business.features.guestBooking)
      throw new AppError(403, 'FEATURE_DISABLED', 'Guest booking is disabled.');
    const service = await Service.findOne({
      _id: req.body.serviceId,
      tenantId: business._id,
      branchIds: branch._id,
      status: 'active',
      appointmentEnabled: true,
    });
    if (!service) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Service was not found.');
    const start = parseInstant(req.body.startAt, 'startAt');
    if (start.getTime() <= Date.now())
      throw new AppError(
        422,
        'INVALID_APPOINTMENT_TIME',
        'Appointment time must be in the future.',
      );
    const end = new Date(start.getTime() + service.durationMinutes * 60000);
    const date = localDate(start, branch.timezone);
    let eligible = await StaffAssignment.find({
      tenantId: business._id,
      branchId: branch._id,
      status: 'active',
      $or: [{ serviceIds: service._id }, { serviceIds: { $size: 0 } }],
    });
    if (business.features.staffSelection && !req.body.staffAssignmentId)
      throw new AppError(
        422,
        'STAFF_SELECTION_REQUIRED',
        'Choose a staff member for this booking.',
      );
    if (business.features.staffSelection && req.body.staffAssignmentId)
      eligible = eligible.filter((s) => String(s._id) === req.body.staffAssignmentId);
    for (const staff of eligible) {
      if (
        !scheduleAllows(branch.operatingHours, branch.timezone, start, end) ||
        !scheduleAllows(staff.workingHours, branch.timezone, start, end)
      )
        continue;
      const appointmentId = new (await import('mongoose')).default.Types.ObjectId();
      try {
        await ReservationCalendar.updateOne(
          {
            tenantId: business._id,
            staffAssignmentId: staff._id,
            localDate: date,
            $nor: [
              { reservations: { $elemMatch: { startAt: { $lt: end }, endAt: { $gt: start } } } },
            ],
          },
          {
            $setOnInsert: {
              tenantId: business._id,
              branchId: branch._id,
              staffAssignmentId: staff._id,
              localDate: date,
            },
            $push: { reservations: { appointmentId, startAt: start, endAt: end } },
          },
          { upsert: true },
        );
        const profile = await customer(business._id, req.user, req.body);
        const appointment = await Appointment.create({
          _id: appointmentId,
          tenantId: business._id,
          branchId: branch._id,
          serviceId: service._id,
          staffAssignmentId: staff._id,
          customerUserId: req.user?._id ?? null,
          customerProfileId: profile._id,
          startAt: start,
          endAt: end,
          timezone: branch.timezone,
          localDate: date,
          status: 'BOOKED',
          statusHistory: [{ status: 'BOOKED', at: new Date(), actorUserId: req.user?._id ?? null }],
        });
        const accessToken = await issuePublicToken({
          tenantId: business._id,
          purpose: 'appointment',
          resourceId: appointment._id,
          expiresAt: new Date(Date.now() + 30 * 86400000),
        });
        return res.status(201).json({
          data: {
            appointment: {
              id: appointment._id,
              startAt: appointment.startAt,
              endAt: appointment.endAt,
              status: appointment.status,
            },
            accessToken,
          },
        });
      } catch (error) {
        if (error.code === 11000) continue;
        await ReservationCalendar.updateOne(
          { tenantId: business._id, staffAssignmentId: staff._id, localDate: date },
          { $pull: { reservations: { appointmentId } } },
        );
        throw error;
      }
    }
    throw new AppError(409, 'SLOT_UNAVAILABLE', 'That appointment time is no longer available.');
  }),
);

router.get(
  '/public/appointments/:appointmentId',
  publicFlowLimiter,
  validateObjectIds('appointmentId'),
  asyncRoute(async (req, res) => {
    await verifyPublicToken({
      token: req.get('x-public-access-token'),
      purpose: 'appointment',
      resourceId: req.params.appointmentId,
    });
    const a = await Appointment.findById(req.params.appointmentId).select(
      'branchId serviceId startAt endAt status',
    );
    if (!a) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Appointment was not found.');
    res.json({ data: { appointment: a } });
  }),
);

router.get(
  '/businesses/:businessId/appointments',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  asyncRoute(async (req, res) => {
    const filter = { tenantId: req.tenantId };
    if (req.query.branchId) filter.branchId = req.query.branchId;
    if (req.membership.roles.includes('staff')) {
      const as = await StaffAssignment.find({
        tenantId: req.tenantId,
        membershipId: req.membership._id,
        status: 'active',
      });
      filter.staffAssignmentId = { $in: as.map((x) => x._id) };
    } else if (!req.membership.roles.includes('owner'))
      throw new AppError(403, 'FORBIDDEN', 'Not authorized.');
    const appointments = await Appointment.find(filter)
      .sort({ startAt: 1 })
      .limit(200)
      .select('-customerUserId -customerProfileId');
    res.json({ data: appointments });
  }),
);

router.get(
  '/me/appointments',
  authenticate,
  asyncRoute(async (req, res) => {
    const appointments = await Appointment.find({ customerUserId: req.user._id })
      .sort({ startAt: -1 })
      .limit(100)
      .select('branchId serviceId startAt endAt timezone status statusHistory createdAt')
      .populate('branchId', 'name timezone')
      .populate('serviceId', 'name durationMinutes');
    res.json({ data: appointments });
  }),
);

router.patch(
  '/me/appointments/:appointmentId',
  authenticate,
  validateObjectIds('appointmentId'),
  asyncRoute(async (req, res) => {
    const appointment = await Appointment.findOne({
      _id: req.params.appointmentId,
      customerUserId: req.user._id,
    });
    if (!appointment) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Appointment was not found.');
    if (appointment.status !== 'BOOKED')
      throw new AppError(409, 'INVALID_TRANSITION', 'Only booked appointments may be cancelled.');
    appointment.status = 'CANCELLED';
    appointment.statusHistory.push({
      status: 'CANCELLED',
      at: new Date(),
      actorUserId: req.user._id,
    });
    await appointment.save();
    await ReservationCalendar.updateOne(
      {
        tenantId: appointment.tenantId,
        staffAssignmentId: appointment.staffAssignmentId,
        localDate: appointment.localDate,
      },
      { $pull: { reservations: { appointmentId: appointment._id } } },
    );
    await recordAudit({
      tenantId: appointment.tenantId,
      actorUserId: req.user._id,
      action: 'appointment.customer_cancelled',
      resourceType: 'appointment',
      resourceId: appointment._id,
      summary: 'Customer cancelled their appointment.',
    });
    res.json({ data: { id: appointment._id, status: appointment.status } });
  }),
);

router.get(
  '/me/queue-tickets',
  authenticate,
  asyncRoute(async (req, res) => {
    const tickets = await QueueTicket.find({ customerUserId: req.user._id })
      .sort({ joinedAt: -1 })
      .limit(100)
      .select('branchId serviceId queueConfigurationId sequenceNumber status localDate joinedAt')
      .populate('branchId', 'name timezone')
      .populate('serviceId', 'name');
    res.json({ data: tickets });
  }),
);

router.get(
  '/businesses/:businessId/customers',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  requireRole('owner', 'staff'),
  asyncRoute(async (req, res) => {
    let branchIds;
    if (req.membership.roles.includes('staff') && !req.membership.roles.includes('owner')) {
      const assignments = await StaffAssignment.find({
        tenantId: req.tenantId,
        membershipId: req.membership._id,
        status: 'active',
      }).select('branchId');
      branchIds = assignments.map((assignment) => assignment.branchId);
    }
    const activityFilter = { tenantId: req.tenantId };
    if (branchIds) activityFilter.branchId = { $in: branchIds };
    const [appointments, tickets] = await Promise.all([
      Appointment.find(activityFilter)
        .sort({ startAt: -1 })
        .limit(500)
        .select('customerProfileId branchId startAt status serviceId'),
      QueueTicket.find(activityFilter)
        .sort({ joinedAt: -1 })
        .limit(500)
        .select('customerProfileId branchId joinedAt status serviceId'),
    ]);
    const profileIds = [
      ...new Set([...appointments, ...tickets].map((item) => String(item.customerProfileId))),
    ];
    const profiles = await CustomerProfile.find({
      tenantId: req.tenantId,
      _id: { $in: profileIds },
    }).select('displayName email phone');
    const latestActivity = new Map();
    for (const item of [...appointments, ...tickets]) {
      const key = String(item.customerProfileId);
      const timestamp = item.startAt ?? item.joinedAt;
      const current = latestActivity.get(key) ?? { count: 0, lastAt: null };
      current.count += 1;
      if (!current.lastAt || timestamp > current.lastAt) current.lastAt = timestamp;
      latestActivity.set(key, current);
    }
    res.json({
      data: profiles.map((profile) => ({
        id: profile._id,
        displayName: profile.displayName,
        email: profile.email,
        phone: profile.phone,
        ...latestActivity.get(String(profile._id)),
      })),
    });
  }),
);
router.patch(
  '/businesses/:businessId/appointments/:appointmentId',
  authenticate,
  validateObjectIds('businessId', 'appointmentId'),
  resolveMembership,
  requireRole('owner', 'staff'),
  validate(statusBody),
  asyncRoute(async (req, res) => {
    const a = await Appointment.findOne({ _id: req.params.appointmentId, tenantId: req.tenantId });
    if (!a) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Appointment was not found.');
    if (
      req.membership.roles.includes('staff') &&
      !req.membership.roles.includes('owner') &&
      !(await StaffAssignment.exists({
        tenantId: req.tenantId,
        membershipId: req.membership._id,
        _id: a.staffAssignmentId,
        status: 'active',
      }))
    )
      throw new AppError(403, 'FORBIDDEN', 'This appointment is outside your assignment.');
    if (req.body.status !== 'CANCELLED' && a.status !== 'BOOKED')
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        'Only booked appointments may be completed or marked no-show.',
      );
    if (req.body.status === 'CANCELLED' && a.status !== 'BOOKED')
      throw new AppError(409, 'INVALID_TRANSITION', 'Only booked appointments may be cancelled.');
    a.status = req.body.status;
    a.statusHistory.push({ status: a.status, at: new Date(), actorUserId: req.user._id });
    await a.save();
    if (a.status !== 'BOOKED')
      await ReservationCalendar.updateOne(
        { tenantId: req.tenantId, staffAssignmentId: a.staffAssignmentId, localDate: a.localDate },
        { $pull: { reservations: { appointmentId: a._id } } },
      );
    res.json({ data: { id: a._id, status: a.status } });
  }),
);

router.post(
  '/public/branches/:branchId/queue-tickets',
  publicFlowLimiter,
  maybeAuthenticate,
  validateObjectIds('branchId'),
  validate(join),
  asyncRoute(async (req, res) => {
    const branch = await Branch.findOne({ _id: req.params.branchId, status: 'active' });
    const business = branch && (await Business.findOne({ _id: branch.tenantId, status: 'active' }));
    if (!branch || !business)
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    if (!business.features.walkInQueue)
      throw new AppError(403, 'FEATURE_DISABLED', 'Walk-in queue is disabled.');
    const accountUser = req.user && business.features.customerAccounts ? req.user : null;
    if (!accountUser && !business.features.guestBooking)
      throw new AppError(403, 'FEATURE_DISABLED', 'Guest queue entry is disabled.');
    const service = await Service.findOne({
      _id: req.body.serviceId,
      tenantId: business._id,
      branchIds: branch._id,
      status: 'active',
      queueEnabled: true,
    });
    if (!service) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Service was not found.');
    const config = await QueueConfiguration.findOne({
      tenantId: business._id,
      branchId: branch._id,
      serviceId: service._id,
      isOpen: true,
    });
    if (!config) throw new AppError(409, 'QUEUE_CLOSED', 'This queue is closed.');
    const date = localDate(new Date(), branch.timezone);
    let counter;
    try {
      counter = await QueueCounter.findOneAndUpdate(
        { tenantId: business._id, queueConfigurationId: config._id, localDate: date },
        {
          $inc: { currentNumber: 1 },
          $setOnInsert: {
            tenantId: business._id,
            queueConfigurationId: config._id,
            localDate: date,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      counter = await QueueCounter.findOneAndUpdate(
        { tenantId: business._id, queueConfigurationId: config._id, localDate: date },
        { $inc: { currentNumber: 1 } },
        { returnDocument: 'after' },
      );
    }
    const joinedAt = new Date();
    const ticket = await QueueTicket.create({
      tenantId: business._id,
      branchId: branch._id,
      serviceId: service._id,
      queueConfigurationId: config._id,
      customerUserId: accountUser?._id ?? null,
      customerProfileId: null,
      customerSnapshot: {
        displayName: accountUser?.displayName ?? req.body.displayName,
        email: accountUser?.email ?? req.body.email ?? '',
        phone: req.body.phone ?? '',
      },
      localDate: date,
      sequenceNumber: counter.currentNumber,
      status: 'WAITING',
      joinedAt,
      statusHistory: [{ status: 'WAITING', at: joinedAt, actorUserId: accountUser?._id ?? null }],
    });
    const accessToken = await issuePublicToken({
      tenantId: business._id,
      purpose: 'queue_ticket',
      resourceId: ticket._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    emitQueue(business._id, branch._id, {
      ticketId: ticket._id,
      serviceId: service._id,
      status: 'WAITING',
      sequenceNumber: ticket.sequenceNumber,
    });
    ioRef()?.to(`queue-ticket:${ticket._id}`).emit('ticket.updated', {
      ticketId: ticket._id,
      serviceId: service._id,
      status: 'WAITING',
      sequenceNumber: ticket.sequenceNumber,
    });
    res.status(201).json({
      data: {
        ticket: { id: ticket._id, sequenceNumber: ticket.sequenceNumber, status: ticket.status },
        service: { id: service._id, name: service.name },
        branch: { id: branch._id, name: branch.name, timezone: branch.timezone },
        joinedAt,
        accessToken,
      },
    });
  }),
);
router.get(
  '/public/queue-tickets/:ticketId',
  publicFlowLimiter,
  validateObjectIds('ticketId'),
  asyncRoute(async (req, res) => {
    await verifyPublicToken({
      token: req.get('x-public-access-token'),
      purpose: 'queue_ticket',
      resourceId: req.params.ticketId,
    });
    const t = await QueueTicket.findById(req.params.ticketId)
      .select(
        'tenantId branchId serviceId queueConfigurationId sequenceNumber status localDate joinedAt calledAt serviceStartedAt',
      )
      .populate('serviceId', 'name')
      .populate('branchId', 'name timezone');
    if (!t) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Ticket was not found.');
    const ahead = await QueueTicket.countDocuments({
      tenantId: t.tenantId,
      queueConfigurationId: t.queueConfigurationId,
      localDate: t.localDate,
      sequenceNumber: { $lt: t.sequenceNumber },
      status: { $in: ['WAITING', 'CALLED', 'SERVING'] },
    });
    res.json({
      data: {
        ticket: {
          id: t._id,
          sequenceNumber: t.sequenceNumber,
          status: t.status,
          peopleAhead: ahead,
          service: t.serviceId && { id: t.serviceId._id, name: t.serviceId.name },
          branch: t.branchId && {
            id: t.branchId._id,
            name: t.branchId.name,
            timezone: t.branchId.timezone,
          },
          joinedAt: t.joinedAt,
          calledAt: t.calledAt,
          serviceStartedAt: t.serviceStartedAt,
        },
      },
    });
  }),
);
router.patch(
  '/public/queue-tickets/:ticketId/leave',
  publicFlowLimiter,
  validateObjectIds('ticketId'),
  asyncRoute(async (req, res) => {
    await verifyPublicToken({
      token: req.get('x-public-access-token'),
      purpose: 'queue_ticket',
      resourceId: req.params.ticketId,
    });
    const at = new Date();
    const ticket = await QueueTicket.findOneAndUpdate(
      { _id: req.params.ticketId, status: { $in: ['WAITING', 'CALLED'] } },
      {
        $set: { status: 'CANCELLED', cancelledAt: at },
        $push: { statusHistory: { status: 'CANCELLED', at, actorUserId: null } },
      },
      { returnDocument: 'after' },
    );
    if (!ticket)
      throw new AppError(409, 'INVALID_TRANSITION', 'This ticket can no longer be left.');
    emitQueue(ticket.tenantId, ticket.branchId, {
      ticketId: ticket._id,
      serviceId: ticket.serviceId,
      status: ticket.status,
      sequenceNumber: ticket.sequenceNumber,
    });
    ioRef()?.to(`queue-ticket:${ticket._id}`).emit('ticket.updated', {
      ticketId: ticket._id,
      serviceId: ticket.serviceId,
      status: ticket.status,
      sequenceNumber: ticket.sequenceNumber,
    });
    res.json({ data: { id: ticket._id, status: ticket.status, cancelledAt: ticket.cancelledAt } });
  }),
);
router.post(
  '/public/queue-tickets/:ticketId/profile',
  publicFlowLimiter,
  validateObjectIds('ticketId'),
  validate(
    z
      .object({
        consent: z.literal(true),
        displayName: z.string().trim().min(2).max(100).optional(),
        email: z.string().trim().email().max(254).optional(),
        phone: z.string().trim().max(30).optional(),
      })
      .strict(),
  ),
  asyncRoute(async (req, res) => {
    await verifyPublicToken({
      token: req.get('x-public-access-token'),
      purpose: 'queue_ticket',
      resourceId: req.params.ticketId,
    });
    const ticket = await QueueTicket.findById(req.params.ticketId);
    if (!ticket) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Ticket was not found.');
    if (ticket.status !== 'COMPLETED')
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        'A profile can be saved after service is complete.',
      );
    if (ticket.profileCreatedAt && ticket.customerProfileId)
      return res.status(200).json({ data: { saved: true } });
    const legacyProfile = ticket.customerProfileId
      ? await CustomerProfile.findOne({ _id: ticket.customerProfileId, tenantId: ticket.tenantId })
      : null;
    const snapshot = ticket.customerSnapshot ?? {
      displayName: legacyProfile?.displayName ?? 'Customer',
      email: legacyProfile?.email ?? '',
      phone: legacyProfile?.phone ?? '',
    };
    const email = req.body.email ?? snapshot.email;
    const phone = req.body.phone ?? snapshot.phone;
    let profile = null;
    if (ticket.customerUserId) {
      profile = await CustomerProfile.findOne({
        tenantId: ticket.tenantId,
        userId: ticket.customerUserId,
      });
    }
    if (!profile) {
      const verifiedContact = [];
      if (email)
        verifiedContact.push({ email: email.toLowerCase(), emailVerifiedAt: { $ne: null } });
      if (phone) verifiedContact.push({ phone, phoneVerifiedAt: { $ne: null } });
      if (verifiedContact.length)
        profile = await CustomerProfile.findOne({
          tenantId: ticket.tenantId,
          $or: verifiedContact,
        });
    }
    if (!profile) {
      profile = await CustomerProfile.create({
        tenantId: ticket.tenantId,
        displayName: req.body.displayName ?? snapshot.displayName,
        email,
        phone,
      });
    }
    const consentAt = new Date();
    const claimed = await QueueTicket.findOneAndUpdate(
      { _id: ticket._id, tenantId: ticket.tenantId, status: 'COMPLETED', profileCreatedAt: null },
      {
        $set: {
          customerProfileId: profile._id,
          profileConsentAt: consentAt,
          profileCreatedAt: consentAt,
        },
      },
      { returnDocument: 'after' },
    );
    if (!claimed) {
      if (!ticket.customerUserId && profile._id !== ticket.customerProfileId)
        await CustomerProfile.deleteOne({ _id: profile._id, tenantId: ticket.tenantId });
      const latest = await QueueTicket.findById(ticket._id).select('profileCreatedAt');
      if (!latest?.profileCreatedAt)
        throw new AppError(409, 'PROFILE_SAVE_CONFLICT', 'Please try saving your profile again.');
      return res.json({ data: { saved: true } });
    }
    await recordAudit({
      tenantId: ticket.tenantId,
      action: 'queue.profile_opted_in',
      resourceType: 'queue_ticket',
      resourceId: ticket._id,
      summary: 'Customer explicitly opted in to save a business profile.',
    });
    res.status(201).json({ data: { saved: true } });
  }),
);
router.get(
  '/businesses/:businessId/queue-tickets',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  asyncRoute(async (req, res) => {
    if (!req.membership.roles.some((r) => ['owner', 'staff'].includes(r)))
      throw new AppError(403, 'FORBIDDEN', 'Not authorized.');
    const query = { tenantId: req.tenantId };
    if (req.query.branchId) query.branchId = req.query.branchId;
    if (req.query.serviceId) {
      if (!/^[a-f\d]{24}$/i.test(req.query.serviceId))
        throw new AppError(400, 'VALIDATION_ERROR', 'serviceId must be valid.');
      query.serviceId = req.query.serviceId;
    }
    if (req.membership.roles.includes('staff') && !req.membership.roles.includes('owner')) {
      const as = await StaffAssignment.find({
        tenantId: req.tenantId,
        membershipId: req.membership._id,
        status: 'active',
      });
      query.branchId = { $in: as.map((a) => a.branchId) };
      const allServices = as.some((assignment) => assignment.serviceIds.length === 0);
      const serviceIds = allServices
        ? (
            await Service.find({
              tenantId: req.tenantId,
              branchIds: { $in: as.map((item) => item.branchId) },
              status: 'active',
              queueEnabled: true,
            }).select('_id')
          ).map((service) => String(service._id))
        : [...new Set(as.flatMap((assignment) => assignment.serviceIds.map(String)))];
      query.serviceId = query.serviceId
        ? { $in: serviceIds.filter((serviceId) => serviceId === req.query.serviceId) }
        : { $in: serviceIds };
    }
    const tickets = await QueueTicket.find(query)
      .sort({ joinedAt: 1 })
      .limit(200)
      .select('-customerUserId -customerProfileId')
      .populate('serviceId', 'name')
      .populate('branchId', 'name timezone')
      .populate(
        'calledByUserId servingStaffUserId completedByUserId noShowByUserId cancelledByUserId',
        'displayName',
      );
    res.json({ data: tickets });
  }),
);
router.post(
  '/businesses/:businessId/branches/:branchId/queue/call-next',
  authenticate,
  validateObjectIds('businessId', 'branchId'),
  resolveMembership,
  requireRole('owner', 'staff'),
  requireBranchScope,
  validate(callNextBody),
  asyncRoute(async (req, res) => {
    const config = await QueueConfiguration.findOne({
      tenantId: req.tenantId,
      branchId: req.params.branchId,
      serviceId: req.body.serviceId,
      isOpen: true,
    });
    if (!config) throw new AppError(409, 'QUEUE_CLOSED', 'Queue is closed.');
    const service = await Service.findOne({
      _id: req.body.serviceId,
      tenantId: req.tenantId,
      branchIds: req.params.branchId,
      status: 'active',
      queueEnabled: true,
    });
    if (!service) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Service was not found.');
    if (
      !req.membership.roles.includes('owner') &&
      !(await StaffAssignment.exists({
        tenantId: req.tenantId,
        membershipId: req.membership._id,
        branchId: req.params.branchId,
        status: 'active',
        $or: [{ serviceIds: service._id }, { serviceIds: { $size: 0 } }],
      }))
    )
      throw new AppError(403, 'FORBIDDEN', 'This service is outside your assignment.');
    const branch = await Branch.findOne({ _id: req.params.branchId, tenantId: req.tenantId });
    const date = localDate(new Date(), branch.timezone);
    const at = new Date();
    const ticket = await QueueTicket.findOneAndUpdate(
      {
        tenantId: req.tenantId,
        branchId: req.params.branchId,
        queueConfigurationId: config._id,
        localDate: date,
        status: 'WAITING',
      },
      {
        $set: { status: 'CALLED', calledAt: at, calledByUserId: req.user._id },
        $push: { statusHistory: { status: 'CALLED', at, actorUserId: req.user._id } },
      },
      { sort: { sequenceNumber: 1 }, returnDocument: 'after' },
    );
    if (!ticket) throw new AppError(409, 'NO_WAITING_TICKETS', 'There are no waiting tickets.');
    emitQueue(req.tenantId, req.params.branchId, {
      ticketId: ticket._id,
      serviceId: ticket.serviceId,
      status: 'CALLED',
      sequenceNumber: ticket.sequenceNumber,
    });
    ioRef()?.to(`queue-ticket:${ticket._id}`).emit('ticket.updated', {
      ticketId: ticket._id,
      serviceId: ticket.serviceId,
      status: 'CALLED',
      sequenceNumber: ticket.sequenceNumber,
    });
    res.json({
      data: { id: ticket._id, sequenceNumber: ticket.sequenceNumber, status: ticket.status },
    });
  }),
);
router.patch(
  '/businesses/:businessId/queue-tickets/:ticketId',
  authenticate,
  validateObjectIds('businessId', 'ticketId'),
  resolveMembership,
  requireRole('owner', 'staff'),
  asyncRoute(async (req, res) => {
    const ticket = await QueueTicket.findOne({ _id: req.params.ticketId, tenantId: req.tenantId });
    if (!ticket) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Ticket was not found.');
    if (
      req.membership.roles.includes('staff') &&
      !req.membership.roles.includes('owner') &&
      !(await StaffAssignment.exists({
        tenantId: req.tenantId,
        membershipId: req.membership._id,
        branchId: ticket.branchId,
        status: 'active',
        $or: [{ serviceIds: ticket.serviceId }, { serviceIds: { $size: 0 } }],
      }))
    )
      throw new AppError(403, 'FORBIDDEN', 'This branch is outside your assignment.');
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'A valid status is required.');
    const transitions = {
      WAITING: ['CANCELLED'],
      CALLED: ['SERVING', 'NO_SHOW', 'CANCELLED'],
      SERVING: ['COMPLETED'],
      COMPLETED: [],
      NO_SHOW: [],
      CANCELLED: [],
    };
    if (!transitions[ticket.status]?.includes(parsed.data.status))
      throw new AppError(409, 'INVALID_TRANSITION', 'Queue status transition is not allowed.');
    const status = parsed.data.status;
    const at = new Date();
    const set = { status };
    const actorField = {
      SERVING: 'servingStaffUserId',
      COMPLETED: 'completedByUserId',
      NO_SHOW: 'noShowByUserId',
      CANCELLED: 'cancelledByUserId',
    }[status];
    const timestampField = {
      SERVING: 'serviceStartedAt',
      COMPLETED: 'completedAt',
      NO_SHOW: 'noShowAt',
      CANCELLED: 'cancelledAt',
    }[status];
    set[timestampField] = at;
    if (actorField) set[actorField] = req.user._id;
    if (status === 'SERVING') set.servingStaffUserId = req.user._id;
    const updated = await QueueTicket.findOneAndUpdate(
      { _id: ticket._id, tenantId: req.tenantId, status: ticket.status },
      { $set: set, $push: { statusHistory: { status, at, actorUserId: req.user._id } } },
      { returnDocument: 'after' },
    );
    if (!updated)
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        'Ticket status changed; refresh before acting again.',
      );
    emitQueue(req.tenantId, ticket.branchId, {
      ticketId: ticket._id,
      serviceId: ticket.serviceId,
      status: updated.status,
      sequenceNumber: ticket.sequenceNumber,
    });
    ioRef()?.to(`queue-ticket:${ticket._id}`).emit('ticket.updated', {
      ticketId: ticket._id,
      serviceId: ticket.serviceId,
      status: updated.status,
      sequenceNumber: ticket.sequenceNumber,
    });
    res.json({ data: { id: ticket._id, status: updated.status, at } });
  }),
);

router.get(
  '/businesses/:businessId/branches/:branchId/queue-monitor',
  authenticate,
  validateObjectIds('businessId', 'branchId'),
  resolveMembership,
  requireRole('owner'),
  asyncRoute(async (req, res) => {
    const branch = await Branch.findOne({
      _id: req.params.branchId,
      tenantId: req.tenantId,
      status: 'active',
    });
    if (!branch) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    if (!req.business.features.walkInQueue)
      throw new AppError(403, 'FEATURE_DISABLED', 'Walk-in queue is disabled.');
    const services = await Service.find({
      tenantId: req.tenantId,
      branchIds: branch._id,
      status: 'active',
      queueEnabled: true,
    }).sort({ name: 1 });
    const date = localDate(new Date(), branch.timezone);
    const [configs, tickets, assignments] = await Promise.all([
      QueueConfiguration.find({ tenantId: req.tenantId, branchId: branch._id, isOpen: true }),
      QueueTicket.find({
        tenantId: req.tenantId,
        branchId: branch._id,
        localDate: date,
        status: { $in: ['WAITING', 'CALLED', 'SERVING'] },
      }).sort({ sequenceNumber: 1 }),
      StaffAssignment.find({
        tenantId: req.tenantId,
        branchId: branch._id,
        status: 'active',
      }).populate('membershipId', 'userId'),
    ]);
    const memberships = assignments.map((item) => item.membershipId).filter(Boolean);
    const assignedIds = memberships.map((item) => String(item.userId));
    const actorIds = tickets.flatMap((ticket) =>
      [ticket.calledByUserId, ticket.servingStaffUserId].filter(Boolean).map(String),
    );
    const users = await User.find({
      _id: { $in: [...new Set([...assignedIds, ...actorIds])] },
    }).select('displayName');
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const ticketByService = new Map();
    for (const ticket of tickets) {
      const serviceKey = String(ticket.serviceId);
      const items = ticketByService.get(serviceKey) ?? [];
      items.push(ticket);
      ticketByService.set(serviceKey, items);
    }
    const rooms = services
      .filter((service) =>
        configs.some((config) => String(config.serviceId) === String(service._id)),
      )
      .map((service) => {
        const serviceTickets = ticketByService.get(String(service._id)) ?? [];
        const current =
          serviceTickets.find((ticket) => ['CALLED', 'SERVING'].includes(ticket.status)) ??
          serviceTickets.find((ticket) => ticket.status === 'WAITING') ??
          null;
        const activeAssignments = assignments.filter(
          (assignment) =>
            !assignment.serviceIds.length ||
            assignment.serviceIds.some((serviceId) => String(serviceId) === String(service._id)),
        );
        return {
          service: { id: service._id, name: service.name },
          branch: { id: branch._id, name: branch.name, timezone: branch.timezone },
          waitingCount: serviceTickets.filter((ticket) => ticket.status === 'WAITING').length,
          current: current
            ? {
                ticketId: current._id,
                sequenceNumber: current.sequenceNumber,
                status: current.status,
                displayName: current.customerSnapshot?.displayName ?? 'Customer',
                joinedAt: current.joinedAt,
                calledAt: current.calledAt,
                serviceStartedAt: current.serviceStartedAt,
                servingStaff:
                  current.status === 'SERVING'
                    ? (userById.get(String(current.servingStaffUserId))?.displayName ?? null)
                    : null,
              }
            : null,
          state: current?.status ?? 'IDLE',
          assignedStaff: activeAssignments.map((assignment) => {
            const membership = assignment.membershipId;
            const staffUser = membership && userById.get(String(membership.userId));
            const workload = serviceTickets.filter(
              (ticket) =>
                ['CALLED', 'SERVING'].includes(ticket.status) &&
                String(ticket.servingStaffUserId ?? ticket.calledByUserId) ===
                  String(membership?.userId),
            ).length;
            return {
              id: membership?.userId,
              displayName: staffUser?.displayName ?? 'Staff',
              available: workload === 0,
              currentWorkload: workload,
            };
          }),
        };
      });
    res.json({
      data: {
        branch: { id: branch._id, name: branch.name, timezone: branch.timezone },
        rooms,
        generatedAt: new Date(),
      },
    });
  }),
);

router.get(
  '/businesses/:businessId/queue-activity',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  requireRole('owner'),
  asyncRoute(async (req, res) => {
    if (!req.query.branchId || !/^[a-f\d]{24}$/i.test(req.query.branchId))
      throw new AppError(400, 'VALIDATION_ERROR', 'A valid branchId is required.');
    const branch = await Branch.findOne({ _id: req.query.branchId, tenantId: req.tenantId });
    if (!branch) throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Branch was not found.');
    const tickets = await QueueTicket.find({ tenantId: req.tenantId, branchId: branch._id })
      .sort({ joinedAt: -1 })
      .limit(250)
      .populate('serviceId', 'name')
      .select('serviceId sequenceNumber customerSnapshot joinedAt serviceStartedAt statusHistory');
    const actorIds = [
      ...new Set(
        tickets.flatMap((ticket) =>
          ticket.statusHistory
            .map((event) => event.actorUserId)
            .filter(Boolean)
            .map(String),
        ),
      ),
    ];
    const actors = await User.find({ _id: { $in: actorIds } }).select('displayName');
    const actorById = new Map(actors.map((actor) => [String(actor._id), actor.displayName]));
    const entries = tickets
      .flatMap((ticket) =>
        ticket.statusHistory.map((event, index) => {
          const startedAt =
            ticket.serviceStartedAt ??
            ticket.statusHistory.slice(0, index + 1).findLast((entry) => entry.status === 'SERVING')
              ?.at;
          const durationStart = event.status === 'CALLED' ? ticket.joinedAt : startedAt;
          const durationMinutes =
            (event.status === 'CALLED' || event.status === 'COMPLETED') && durationStart
              ? Math.max(0, Math.floor((new Date(event.at) - new Date(durationStart)) / 60000))
              : null;
          return {
            at: event.at,
            service: ticket.serviceId?.name ?? 'Service',
            sequenceNumber: ticket.sequenceNumber,
            customer: ticket.customerSnapshot?.displayName ?? 'Anonymous customer',
            action: event.status,
            staff: event.actorUserId ? (actorById.get(String(event.actorUserId)) ?? 'Staff') : null,
            joinedAt: ticket.joinedAt,
            durationMinutes,
          };
        }),
      )
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 250);
    res.json({
      data: { branch: { id: branch._id, name: branch.name, timezone: branch.timezone }, entries },
    });
  }),
);

router.get(
  '/businesses/:businessId/analytics',
  authenticate,
  validateObjectIds('businessId'),
  resolveMembership,
  asyncRoute(async (req, res) => {
    if (!req.membership.roles.includes('owner'))
      throw new AppError(403, 'FORBIDDEN', 'Business owner access is required.');
    const tenantId = req.tenantId;
    const [appointments, queues] = await Promise.all([
      Appointment.aggregate([
        { $match: { tenantId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      QueueTicket.aggregate([
        { $match: { tenantId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);
    res.json({
      data: {
        appointments: Object.fromEntries(appointments.map((x) => [x._id, x.count])),
        queueTickets: Object.fromEntries(queues.map((x) => [x._id, x.count])),
      },
    });
  }),
);
export default router;
