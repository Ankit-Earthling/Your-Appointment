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
  ioRef()?.to(`tenant:${tenantId}:branch:${branchId}`).emit('queue.updated', payload);
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
    if (req.user && !business.features.customerAccounts)
      throw new AppError(403, 'FEATURE_DISABLED', 'Customer accounts are disabled.');
    if (!req.user && !business.features.guestBooking)
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
    const counter = await QueueCounter.findOneAndUpdate(
      { tenantId: business._id, queueConfigurationId: config._id, localDate: date },
      {
        $inc: { currentNumber: 1 },
        $setOnInsert: { tenantId: business._id, queueConfigurationId: config._id, localDate: date },
      },
      { upsert: true, returnDocument: 'after' },
    );
    const profile = await customer(business._id, req.user, req.body);
    const ticket = await QueueTicket.create({
      tenantId: business._id,
      branchId: branch._id,
      serviceId: service._id,
      queueConfigurationId: config._id,
      customerUserId: req.user?._id ?? null,
      customerProfileId: profile._id,
      localDate: date,
      sequenceNumber: counter.currentNumber,
      status: 'WAITING',
      statusHistory: [{ status: 'WAITING', at: new Date(), actorUserId: req.user?._id ?? null }],
    });
    const accessToken = await issuePublicToken({
      tenantId: business._id,
      purpose: 'queue_ticket',
      resourceId: ticket._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    emitQueue(business._id, branch._id, {
      ticketId: ticket._id,
      status: 'WAITING',
      sequenceNumber: ticket.sequenceNumber,
    });
    ioRef()?.to(`queue-ticket:${ticket._id}`).emit('ticket.updated', {
      ticketId: ticket._id,
      status: 'WAITING',
      sequenceNumber: ticket.sequenceNumber,
    });
    res.status(201).json({
      data: {
        ticket: { id: ticket._id, sequenceNumber: ticket.sequenceNumber, status: ticket.status },
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
    const t = await QueueTicket.findById(req.params.ticketId).select(
      'tenantId branchId queueConfigurationId sequenceNumber status localDate',
    );
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
        },
      },
    });
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
    if (req.membership.roles.includes('staff') && !req.membership.roles.includes('owner')) {
      const as = await StaffAssignment.find({
        tenantId: req.tenantId,
        membershipId: req.membership._id,
        status: 'active',
      });
      query.branchId = { $in: as.map((a) => a.branchId) };
    }
    const tickets = await QueueTicket.find(query)
      .sort({ sequenceNumber: 1 })
      .limit(200)
      .select('-customerUserId -customerProfileId');
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
  asyncRoute(async (req, res) => {
    const config = await QueueConfiguration.findOne({
      tenantId: req.tenantId,
      branchId: req.params.branchId,
      isOpen: true,
    });
    if (!config) throw new AppError(409, 'QUEUE_CLOSED', 'Queue is closed.');
    const date = localDate(new Date(), (await Branch.findById(req.params.branchId)).timezone);
    const ticket = await QueueTicket.findOneAndUpdate(
      {
        tenantId: req.tenantId,
        branchId: req.params.branchId,
        queueConfigurationId: config._id,
        localDate: date,
        status: 'WAITING',
      },
      {
        $set: { status: 'CALLED' },
        $push: { statusHistory: { status: 'CALLED', at: new Date(), actorUserId: req.user._id } },
      },
      { sort: { sequenceNumber: 1 }, returnDocument: 'after' },
    );
    if (!ticket) throw new AppError(409, 'NO_WAITING_TICKETS', 'There are no waiting tickets.');
    emitQueue(req.tenantId, req.params.branchId, {
      ticketId: ticket._id,
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
    ticket.status = parsed.data.status;
    ticket.statusHistory.push({ status: ticket.status, at: new Date(), actorUserId: req.user._id });
    await ticket.save();
    emitQueue(req.tenantId, ticket.branchId, {
      ticketId: ticket._id,
      status: ticket.status,
      sequenceNumber: ticket.sequenceNumber,
    });
    ioRef()?.to(`queue-ticket:${ticket._id}`).emit('ticket.updated', {
      ticketId: ticket._id,
      status: ticket.status,
      sequenceNumber: ticket.sequenceNumber,
    });
    res.json({ data: { id: ticket._id, status: ticket.status } });
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
