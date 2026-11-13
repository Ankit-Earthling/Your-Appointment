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
    expect(response.body.data[0].customerDisplayName).toBe('Guest customer');
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
    const joined = await join(serviceA._id, 'Opt-in guest');
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
  });
});
