import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import {
  Business,
  Branch,
  Membership,
  QueueConfiguration,
  QueueCounter,
  QueueTicket,
  Service,
  StaffAssignment,
  User,
  CustomerProfile,
  Appointment,
  ReservationCalendar,
  PublicAccessToken,
  AuditEvent,
} from '../models/index.js';
import { signSession, SESSION_COOKIE } from '../lib/security.js';
import { setIo } from '../lib/socket.js';

const dbName = `your_appointment_queue_test_${crypto.randomUUID().replaceAll('-', '')}`;
const app = createApp({ frontendOrigin: 'http://localhost:5173' });
let tenant, branch, owner, staffOne, staffTwo, serviceA, serviceB;

function as(user) {
  return { Cookie: `${SESSION_COOKIE}=${signSession(user)}`, Origin: 'http://localhost:5173' };
}

async function join(serviceId, displayName = 'Guest Customer') {
  return request(app)
    .post(`/api/v1/public/branches/${branch._id}/queue-tickets`)
    .send({ serviceId: String(serviceId), displayName })
    .expect(201);
}

function callNext(user, serviceId) {
  return request(app)
    .post(`/api/v1/businesses/${tenant._id}/branches/${branch._id}/queue/call-next`)
    .set(as(user))
    .send({ serviceId: String(serviceId) });
}

beforeAll(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${dbName}`);
  await Promise.all(
    [
      Business,
      Branch,
      Membership,
      QueueConfiguration,
      QueueCounter,
      QueueTicket,
      Service,
      StaffAssignment,
      User,
      CustomerProfile,
      Appointment,
      ReservationCalendar,
      PublicAccessToken,
      AuditEvent,
    ].map((model) => model.init()),
  );
});

afterEach(async () => {
  setIo(null);
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  const tenantId = new mongoose.Types.ObjectId();
  tenant = await Business.create({
    _id: tenantId,
    tenantId,
    name: 'Queue Test Business',
    features: { walkInQueue: true, guestBooking: true, customerAccounts: true },
  });
  branch = await Branch.create({
    tenantId,
    name: 'Test Branch',
    timezone: 'Asia/Kolkata',
    status: 'active',
  });
  owner = await User.create({
    email: `owner-${crypto.randomUUID()}@example.test`,
    displayName: 'Owner',
    passwordHash: 'test-hash',
  });
  staffOne = await User.create({
    email: `staff-one-${crypto.randomUUID()}@example.test`,
    displayName: 'Staff One',
    passwordHash: 'test-hash',
  });
  staffTwo = await User.create({
    email: `staff-two-${crypto.randomUUID()}@example.test`,
    displayName: 'Staff Two',
    passwordHash: 'test-hash',
  });
  await Membership.create({
    tenantId,
    userId: owner._id,
    roles: ['owner'],
  });
  const staffOneMembership = await Membership.create({
    tenantId,
    userId: staffOne._id,
    roles: ['staff'],
  });
  const staffTwoMembership = await Membership.create({
    tenantId,
    userId: staffTwo._id,
    roles: ['staff'],
  });
  serviceA = await Service.create({
    tenantId,
    name: 'Room A',
    branchIds: [branch._id],
    queueEnabled: true,
    status: 'active',
  });
  serviceB = await Service.create({
    tenantId,
    name: 'Room B',
    branchIds: [branch._id],
    queueEnabled: true,
    status: 'active',
  });
  await Promise.all(
    [serviceA, serviceB].map((service) =>
      QueueConfiguration.create({
        tenantId,
        branchId: branch._id,
        serviceId: service._id,
        isOpen: true,
      }),
    ),
  );
  await StaffAssignment.create({
    tenantId,
    membershipId: staffOneMembership._id,
    branchId: branch._id,
    serviceIds: [serviceA._id],
    status: 'active',
  });
  await StaffAssignment.create({
    tenantId,
    membershipId: staffTwoMembership._id,
    branchId: branch._id,
    serviceIds: [serviceA._id],
    status: 'active',
  });
});

describe('independent room queue operations', () => {
  it('blocks service removal while queue work is active and retains service history after removal', async () => {
    const joined = await join(serviceA._id, 'Lifecycle Guest');
    const servicePath = `/api/v1/businesses/${tenant._id}/services/${serviceA._id}`;
    await request(app).delete(servicePath).set(as(owner)).expect(409);
    await request(app)
      .patch(servicePath)
      .set(as(staffOne))
      .send({ status: 'inactive' })
      .expect(403);
    await QueueTicket.updateOne(
      { _id: joined.body.data.ticket.id },
      { $set: { status: 'COMPLETED' } },
    );
    const removed = await request(app).delete(servicePath).set(as(owner)).expect(200);
    expect(removed.body.data).toMatchObject({ deleted: false, status: 'inactive' });
    expect((await Service.findById(serviceA._id)).status).toBe('inactive');
    await request(app)
      .post(`/api/v1/public/branches/${branch._id}/queue-tickets`)
      .send({ serviceId: String(serviceA._id), displayName: 'New Guest' })
      .expect(404);
  });

  it('hard removes an unused service without operational references', async () => {
    const unused = await Service.create({
      tenantId: tenant._id,
      name: 'Unused service',
      branchIds: [branch._id],
      appointmentEnabled: true,
      queueEnabled: false,
    });
    const response = await request(app)
      .delete(`/api/v1/businesses/${tenant._id}/services/${unused._id}`)
      .set(as(owner))
      .expect(200);
    expect(response.body.data.deleted).toBe(true);
    expect(await Service.exists({ _id: unused._id, tenantId: tenant._id })).toBeFalsy();
  });

  it('prevents staff deactivation when their queue work is still active', async () => {
    const membership = await Membership.findOne({ tenantId: tenant._id, userId: staffOne._id });
    const assignment = await StaffAssignment.findOne({
      tenantId: tenant._id,
      membershipId: membership._id,
      status: 'active',
    });
    const ticket = await join(serviceA._id, 'Assigned Guest');
    await QueueTicket.updateOne(
      { _id: ticket.body.data.ticket.id },
      { $set: { status: 'SERVING', servingStaffUserId: staffOne._id } },
    );
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/staff-assignments/${assignment._id}`)
      .set(as(owner))
      .send({ status: 'inactive' })
      .expect(409);
    expect((await StaffAssignment.findById(assignment._id)).status).toBe('active');
    await QueueTicket.updateOne(
      { _id: ticket.body.data.ticket.id },
      { $set: { status: 'COMPLETED' } },
    );
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/staff-assignments/${assignment._id}`)
      .set(as(owner))
      .send({ status: 'inactive' })
      .expect(200);
    expect(
      (
        await request(app)
          .get(`/api/v1/businesses/${tenant._id}/branches`)
          .set(as(staffOne))
          .expect(200)
      ).body.data,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .get(`/api/v1/businesses/${tenant._id}/services`)
          .set(as(staffOne))
          .expect(200)
      ).body.data,
    ).toHaveLength(0);
  });

  it('applies branch and date filters to appointment and queue analytics separately', async () => {
    await join(serviceA._id, 'Analytics Guest');
    const all = await request(app)
      .get(
        `/api/v1/businesses/${tenant._id}/analytics?branchId=${branch._id}&from=2020-01-01T00:00:00.000Z&to=2099-01-01T00:00:00.000Z`,
      )
      .set(as(owner))
      .expect(200);
    expect(all.body.data.queueTickets.WAITING).toBe(1);
    const future = await request(app)
      .get(
        `/api/v1/businesses/${tenant._id}/analytics?branchId=${branch._id}&from=2099-01-01T00:00:00.000Z&to=2099-01-02T00:00:00.000Z`,
      )
      .set(as(owner))
      .expect(200);
    expect(future.body.data.queueTickets.WAITING ?? 0).toBe(0);
  });

  it('lists only completed visits for saved same-tenant profiles and supports authorized profile detail updates', async () => {
    const profile = await CustomerProfile.create({
      tenantId: tenant._id,
      displayName: 'Saved Guest',
      email: 'saved@example.test',
      consentAt: new Date(Date.now() - 86400000),
      consentSource: 'queue_completion',
    });
    const completed = await join(serviceA._id, 'Saved Guest');
    const waiting = await join(serviceB._id, 'Saved Guest');
    const cancelled = await join(serviceA._id, 'Saved Guest');
    const noShow = await join(serviceB._id, 'Saved Guest');
    await QueueTicket.updateOne(
      { _id: completed.body.data.ticket.id },
      {
        $set: { customerProfileId: profile._id, profileConsentAt: new Date(), status: 'COMPLETED' },
      },
    );
    await QueueTicket.updateOne(
      { _id: waiting.body.data.ticket.id },
      { $set: { customerProfileId: profile._id, profileConsentAt: new Date() } },
    );
    await QueueTicket.updateOne(
      { _id: cancelled.body.data.ticket.id },
      {
        $set: { customerProfileId: profile._id, profileConsentAt: new Date(), status: 'CANCELLED' },
      },
    );
    await QueueTicket.updateOne(
      { _id: noShow.body.data.ticket.id },
      { $set: { customerProfileId: profile._id, profileConsentAt: new Date(), status: 'NO_SHOW' } },
    );
    const assignment = await StaffAssignment.findOne({
      tenantId: tenant._id,
      serviceIds: serviceA._id,
    });
    await Appointment.create({
      tenantId: tenant._id,
      branchId: branch._id,
      serviceId: serviceA._id,
      staffAssignmentId: assignment._id,
      customerProfileId: profile._id,
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() - 1800000),
      timezone: branch.timezone,
      localDate: new Date().toISOString().slice(0, 10),
      status: 'COMPLETED',
    });
    const list = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/customers`)
      .set(as(owner))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].totalVisits).toBe(2);
    expect(list.body.data[0].createdAt).toBeTruthy();
    expect(list.body.data[0].recentActivity[0].source).toBe('walk-in');
    const detail = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/customers/${profile._id}`)
      .set(as(owner))
      .expect(200);
    expect(detail.body.data.visits).toHaveLength(2);
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/customers/${profile._id}`)
      .set(as(owner))
      .send({ displayName: 'Updated Guest' })
      .expect(200);
    expect((await CustomerProfile.findById(profile._id)).displayName).toBe('Updated Guest');
    const foreign = new mongoose.Types.ObjectId();
    await request(app)
      .get(`/api/v1/businesses/${tenant._id}/customers/${foreign}`)
      .set(as(owner))
      .expect(404);
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/customers/${profile._id}`)
      .set(as(staffOne))
      .send({ displayName: 'No Permission' })
      .expect(403);
  });

  it('starts each room at ticket one and keeps guest contact details private', async () => {
    const roomA = await request(app)
      .post(`/api/v1/public/branches/${branch._id}/queue-tickets`)
      .send({
        serviceId: String(serviceA._id),
        displayName: 'Asha Guest',
        email: 'asha-private@example.test',
        phone: '555-0123',
      })
      .expect(201);
    const roomB = await join(serviceB._id, 'Ravi Guest');
    expect(roomA.body.data.ticket.sequenceNumber).toBe(1);
    expect(roomB.body.data.ticket.sequenceNumber).toBe(1);
    expect(roomA.body.data.service.name).toBe('Room A');
    expect(await CustomerProfile.countDocuments({ tenantId: tenant._id })).toBe(0);
    const status = await request(app)
      .get(`/api/v1/public/queue-tickets/${roomA.body.data.ticket.id}`)
      .set('X-Public-Access-Token', roomA.body.data.accessToken)
      .expect(200);
    expect(status.body.data.ticket.service.name).toBe('Room A');
    expect(JSON.stringify(status.body)).not.toContain('Asha Guest');
    expect(JSON.stringify(status.body)).not.toContain('asha-private@example.test');
    expect(JSON.stringify(status.body)).not.toContain('555-0123');
  });

  it("uses a registered customer's same-tenant profile name without requiring tenant membership", async () => {
    const registeredCustomer = await User.create({
      email: `customer-${crypto.randomUUID()}@example.test`,
      displayName: 'Global Account Name',
      passwordHash: 'test-hash',
    });
    const profile = await CustomerProfile.create({
      tenantId: tenant._id,
      userId: registeredCustomer._id,
      displayName: 'Business Preferred Name',
      email: registeredCustomer.email,
      consentAt: new Date(),
      consentSource: 'queue_completion',
    });
    const response = await request(app)
      .post(`/api/v1/public/branches/${branch._id}/queue-tickets`)
      .set(as(registeredCustomer))
      .send({ serviceId: String(serviceA._id), displayName: 'Typed Name' })
      .expect(201);
    const ticketList = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/queue-tickets?serviceId=${serviceA._id}`)
      .set(as(owner))
      .expect(200);
    expect(ticketList.body.data[0].customerDisplayName).toBe('Business Preferred Name');
    expect(JSON.stringify(ticketList.body)).not.toContain(registeredCustomer.email);
    expect(
      await Membership.exists({ tenantId: tenant._id, userId: registeredCustomer._id }),
    ).toBeFalsy();
    expect(response.body.data.ticket.status).toBe('WAITING');
    expect(
      (await QueueTicket.findById(response.body.data.ticket.id)).customerProfileId.toString(),
    ).toBe(profile._id.toString());
    await QueueTicket.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(response.body.data.ticket.id) },
      { $set: { 'customerSnapshot.displayName': '', customerProfileId: profile._id } },
    );
    const profileFallback = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/queue-tickets?serviceId=${serviceA._id}`)
      .set(as(owner))
      .expect(200);
    expect(profileFallback.body.data[0].customerDisplayName).toBe('Business Preferred Name');
  });

  it('filters operational tickets by branch and service and only calls the selected room', async () => {
    const ticketA = await request(app)
      .post(`/api/v1/public/branches/${branch._id}/queue-tickets`)
      .send({
        serviceId: String(serviceA._id),
        displayName: 'Authorized Guest',
        email: 'private@example.test',
        phone: '555-0100',
      })
      .expect(201);
    const ticketB = await join(serviceB._id);
    const listA = await request(app)
      .get(
        `/api/v1/businesses/${tenant._id}/queue-tickets?branchId=${branch._id}&serviceId=${serviceA._id}`,
      )
      .set(as(owner))
      .expect(200);
    expect(listA.body.data).toHaveLength(1);
    expect(String(listA.body.data[0]._id)).toBe(ticketA.body.data.ticket.id);
    expect(listA.body.data[0].customerDisplayName).toBe('Authorized Guest');
    expect(listA.body.data[0]).not.toHaveProperty('customerSnapshot');
    expect(listA.body.data[0]).not.toHaveProperty('customerProfileId');
    expect(JSON.stringify(listA.body)).not.toContain('private@example.test');
    expect(JSON.stringify(listA.body)).not.toContain('555-0100');
    const staffList = await request(app)
      .get(
        `/api/v1/businesses/${tenant._id}/queue-tickets?branchId=${branch._id}&serviceId=${serviceA._id}`,
      )
      .set(as(staffOne))
      .expect(200);
    expect(staffList.body.data[0].customerDisplayName).toBe('Authorized Guest');
    await callNext(owner, serviceA._id).expect(200);
    expect((await QueueTicket.findById(ticketA.body.data.ticket.id)).status).toBe('CALLED');
    expect((await QueueTicket.findById(ticketB.body.data.ticket.id)).status).toBe('WAITING');
  });

  it('falls back safely for missing names and never resolves another tenant customer profile', async () => {
    const joined = await join(serviceA._id, 'Temporary name');
    const ticketId = joined.body.data.ticket.id;
    const foreignTenant = new mongoose.Types.ObjectId();
    const foreignProfile = await CustomerProfile.create({
      tenantId: foreignTenant,
      displayName: 'Private Foreign Customer',
    });
    await QueueTicket.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(ticketId) },
      {
        $set: {
          'customerSnapshot.displayName': '   ',
          customerProfileId: foreignProfile._id,
        },
      },
    );

    const response = await request(app)
      .get(
        `/api/v1/businesses/${tenant._id}/queue-tickets?branchId=${branch._id}&serviceId=${serviceA._id}`,
      )
      .set(as(owner))
      .expect(200);
    expect(response.body.data[0].customerDisplayName).toBe('Anonymous customer');
    expect(JSON.stringify(response.body)).not.toContain('Private Foreign Customer');
    expect(JSON.stringify(response.body)).not.toContain('Temporary name');
  });

  it('denies a staff member operation on an unassigned service', async () => {
    await join(serviceB._id);
    await callNext(staffOne, serviceB._id).expect(403);
  });

  it('allows multiple staff on one service and prevents concurrent double claims', async () => {
    const ticket = await join(serviceA._id);
    const results = await Promise.all([
      callNext(staffOne, serviceA._id),
      callNext(staffTwo, serviceA._id),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const saved = await QueueTicket.findById(ticket.body.data.ticket.id);
    expect(saved.status).toBe('CALLED');
    expect([String(staffOne._id), String(staffTwo._id)]).toContain(String(saved.calledByUserId));
    const listed = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/staff-assignments`)
      .set(as(owner))
      .expect(200);
    expect(
      listed.body.data.filter((assignment) =>
        assignment.serviceIds.some((id) => String(id) === String(serviceA._id)),
      ),
    ).toHaveLength(2);
  });

  it('records UTC timestamps and actor for call, start, and completion without losing history', async () => {
    const response = await join(serviceA._id);
    const ticketId = response.body.data.ticket.id;
    await callNext(owner, serviceA._id).expect(200);
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/queue-tickets/${ticketId}`)
      .set(as(owner))
      .send({ status: 'SERVING' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/queue-tickets/${ticketId}`)
      .set(as(owner))
      .send({ status: 'COMPLETED' })
      .expect(200);
    const saved = await QueueTicket.findById(ticketId);
    expect(saved.calledAt).toBeInstanceOf(Date);
    expect(saved.serviceStartedAt).toBeInstanceOf(Date);
    expect(saved.completedAt).toBeInstanceOf(Date);
    expect(String(saved.calledByUserId)).toBe(String(owner._id));
    expect(String(saved.servingStaffUserId)).toBe(String(owner._id));
    expect(String(saved.completedByUserId)).toBe(String(owner._id));
    expect(saved.statusHistory.map((entry) => entry.status)).toEqual([
      'WAITING',
      'CALLED',
      'SERVING',
      'COMPLETED',
    ]);
  });

  it('allows ticket-owner queue exit, records its time, and protects other tickets', async () => {
    const first = await join(serviceA._id, 'First guest');
    const second = await join(serviceA._id, 'Second guest');
    await request(app)
      .get(`/api/v1/public/queue-tickets/${second.body.data.ticket.id}`)
      .set('X-Public-Access-Token', first.body.data.accessToken)
      .expect(404);
    await request(app)
      .patch(`/api/v1/public/queue-tickets/${first.body.data.ticket.id}/leave`)
      .set('X-Public-Access-Token', first.body.data.accessToken)
      .expect(200);
    const saved = await QueueTicket.findById(first.body.data.ticket.id);
    expect(saved.status).toBe('CANCELLED');
    expect(saved.cancelledAt).toBeInstanceOf(Date);
    expect(saved.customerProfileId).toBeNull();
  });

  it('exposes owner monitor/activity and emits service-scoped operational updates', async () => {
    const ticket = await join(serviceA._id, 'Monitor guest');
    const emitted = [];
    setIo({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });
    await callNext(owner, serviceA._id).expect(200);
    expect(
      emitted.some(
        (entry) =>
          entry.room.endsWith(`:service:${serviceA._id}`) && entry.event === 'queue.updated',
      ),
    ).toBe(true);
    expect(JSON.stringify(emitted)).not.toContain('Monitor guest');
    const monitor = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/branches/${branch._id}/queue-monitor`)
      .set(as(owner))
      .expect(200);
    expect(monitor.body.data.rooms.map((room) => room.service.name)).toContain('Room A');
    expect(monitor.body.data.rooms.find((room) => room.service.name === 'Room A').state).toBe(
      'CALLED',
    );
    expect(
      monitor.body.data.rooms.find((room) => room.service.name === 'Room A').current.displayName,
    ).toBe('Monitor guest');
    expect(
      monitor.body.data.rooms.find((room) => room.service.name === 'Room A').assignedStaff,
    ).toHaveLength(2);
    const activity = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/queue-activity?branchId=${branch._id}`)
      .set(as(owner))
      .expect(200);
    expect(
      activity.body.data.entries.some(
        (entry) =>
          entry.sequenceNumber === ticket.body.data.ticket.sequenceNumber &&
          entry.action === 'CALLED' &&
          entry.customer === 'Monitor guest',
      ),
    ).toBe(true);
  });

  it('requires completion and explicit consent before creating a guest profile', async () => {
    const joined = await request(app)
      .post(`/api/v1/public/branches/${branch._id}/queue-tickets`)
      .send({
        serviceId: String(serviceA._id),
        displayName: 'Opt-in guest',
        email: 'ticket-only@example.test',
        phone: '555-0198',
      })
      .expect(201);
    const id = joined.body.data.ticket.id;
    await request(app)
      .post(`/api/v1/public/queue-tickets/${id}/profile`)
      .set('X-Public-Access-Token', joined.body.data.accessToken)
      .send({ consent: true })
      .expect(409);
    await callNext(owner, serviceA._id).expect(200);
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/queue-tickets/${id}`)
      .set(as(owner))
      .send({ status: 'SERVING' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/businesses/${tenant._id}/queue-tickets/${id}`)
      .set(as(owner))
      .send({ status: 'COMPLETED' })
      .expect(200);
    await request(app)
      .post(`/api/v1/public/queue-tickets/${id}/profile`)
      .set('X-Public-Access-Token', joined.body.data.accessToken)
      .send({ consent: true })
      .expect(201);
    const saved = await QueueTicket.findById(id);
    expect(saved.customerProfileId).toBeTruthy();
    expect(saved.profileConsentAt).toBeInstanceOf(Date);
    expect(await CustomerProfile.countDocuments({ tenantId: tenant._id })).toBe(1);
    const profile = await CustomerProfile.findById(saved.customerProfileId);
    expect(profile.consentAt).toBeInstanceOf(Date);
    expect(profile.consentSource).toBe('queue_completion');
    expect(profile.email).toBe('');
    expect(profile.phone).toBe('');
    await request(app)
      .post(`/api/v1/public/queue-tickets/${id}/profile`)
      .set('X-Public-Access-Token', joined.body.data.accessToken)
      .send({ consent: true })
      .expect(200);
    expect(await CustomerProfile.countDocuments({ tenantId: tenant._id })).toBe(1);
  });

  it('does not create customer profiles for business owners or staff memberships', async () => {
    expect(await CustomerProfile.countDocuments({ tenantId: tenant._id })).toBe(0);
    expect(await Membership.countDocuments({ tenantId: tenant._id })).toBe(3);
    expect(
      await CustomerProfile.countDocuments({
        userId: { $in: [owner._id, staffOne._id, staffTwo._id] },
      }),
    ).toBe(0);
  });

  it('registration and business creation establish identity and membership without customer profiles', async () => {
    const email = `new-owner-${crypto.randomUUID()}@example.test`;
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ displayName: 'New Owner', email, password: 'local-test-password-123' })
      .expect(201);
    const registeredUser = await User.findById(registration.body.data.user.id);
    expect(await CustomerProfile.exists({ userId: registeredUser._id })).toBeFalsy();
    const creation = await request(app)
      .post('/api/v1/businesses')
      .set(as(registeredUser))
      .send({ name: 'New Owner Business', businessType: 'Local service' })
      .expect(201);
    const businessId = creation.body.data.business.id;
    expect(
      await Membership.exists({ tenantId: businessId, userId: registeredUser._id }),
    ).toBeTruthy();
    expect(
      await CustomerProfile.exists({ tenantId: businessId, userId: registeredUser._id }),
    ).toBeFalsy();
  });

  it('keeps appointment details operational without consent and saves only explicit consent', async () => {
    tenant.features.appointments = true;
    await tenant.save();
    serviceA.appointmentEnabled = true;
    await serviceA.save();
    const allDay = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      opensLocal: '00:00',
      closesLocal: '23:59',
    }));
    branch.operatingHours = allDay;
    await branch.save();
    await StaffAssignment.updateMany({ tenantId: tenant._id }, { $set: { workingHours: allDay } });
    const startAt = new Date(Date.now() + 2 * 86400000);
    startAt.setUTCMinutes(0, 0, 0);
    const book = (offset, consent) =>
      request(app)
        .post(`/api/v1/public/branches/${branch._id}/appointments`)
        .send({
          serviceId: String(serviceA._id),
          startAt: new Date(startAt.getTime() + offset * 86400000).toISOString(),
          displayName: 'Booking Customer',
          email: `booking-${offset}@example.test`,
          ...(consent ? { saveProfileConsent: true } : {}),
        });
    const operationalOnly = await book(0, false).expect(201);
    const firstAppointment = await Appointment.findById(operationalOnly.body.data.appointment.id);
    expect(firstAppointment.customerProfileId).toBeNull();
    expect(firstAppointment.profileConsentAt).toBeNull();
    expect(firstAppointment.customerSnapshot.email).toBe('booking-0@example.test');
    expect(await CustomerProfile.countDocuments({ tenantId: tenant._id })).toBe(0);
    const consented = await book(1, true).expect(201);
    const secondAppointment = await Appointment.findById(consented.body.data.appointment.id);
    expect(secondAppointment.customerProfileId).toBeTruthy();
    expect(secondAppointment.profileConsentAt).toBeInstanceOf(Date);
    expect(
      await CustomerProfile.countDocuments({ tenantId: tenant._id, consentAt: { $ne: null } }),
    ).toBe(1);
    const ownerList = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/appointments`)
      .set(as(owner))
      .expect(200);
    expect(JSON.stringify(ownerList.body)).not.toContain('booking-0@example.test');
    expect(JSON.stringify(ownerList.body)).not.toContain('booking-1@example.test');
    expect(ownerList.body.data.every((appointment) => !('customerSnapshot' in appointment))).toBe(
      true,
    );
  });

  it('keeps linked legacy visits anonymous until reliable consent exists', async () => {
    const profile = await CustomerProfile.create({
      tenantId: tenant._id,
      displayName: 'Legacy Private Name',
      email: 'legacy-private@example.test',
    });
    const joined = await join(serviceA._id, 'Legacy ticket name');
    await QueueTicket.updateOne(
      { _id: joined.body.data.ticket.id },
      { $set: { status: 'COMPLETED', customerProfileId: profile._id } },
    );
    const list = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/customers`)
      .set(as(owner))
      .expect(200);
    expect(list.body.data).toHaveLength(0);
    const detail = await request(app)
      .get(`/api/v1/businesses/${tenant._id}/customers/${profile._id}`)
      .set(as(owner))
      .expect(404);
    expect(JSON.stringify(detail.body)).not.toContain('legacy-private@example.test');
    const queue = await request(app)
      .get(
        `/api/v1/businesses/${tenant._id}/queue-tickets?branchId=${branch._id}&serviceId=${serviceA._id}`,
      )
      .set(as(owner))
      .expect(200);
    expect(queue.body.data[0].customerDisplayName).toBe('Anonymous customer');
    expect(JSON.stringify(queue.body)).not.toContain('Legacy Private Name');
    expect(JSON.stringify(queue.body)).not.toContain('legacy-private@example.test');
  });
});
