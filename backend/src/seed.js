import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import {
  Business,
  Branch,
  Membership,
  QueueConfiguration,
  Service,
  StaffAssignment,
  User,
  PublicAccessToken,
} from './models/index.js';
import { issuePublicToken } from './lib/public-tokens.js';

if (env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
const required = [
  'DEMO_OWNER_EMAIL',
  'DEMO_OWNER_PASSWORD',
  'DEMO_STAFF_EMAIL',
  'DEMO_STAFF_PASSWORD',
];
for (const key of required)
  if (!process.env[key]) throw new Error(`Set ${key} before running the demo seed.`);
if (process.env.DEMO_OWNER_PASSWORD.length < 12 || process.env.DEMO_STAFF_PASSWORD.length < 12)
  throw new Error('Demo passwords must contain at least 12 characters.');

try {
  await connectDatabase(env.MONGODB_URI);
  const owner = await User.findOneAndUpdate(
    { email: process.env.DEMO_OWNER_EMAIL.toLowerCase() },
    {
      $set: {
        email: process.env.DEMO_OWNER_EMAIL.toLowerCase(),
        displayName: 'Demo Owner',
        passwordHash: await bcrypt.hash(process.env.DEMO_OWNER_PASSWORD, 12),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  const staffUser = await User.findOneAndUpdate(
    { email: process.env.DEMO_STAFF_EMAIL.toLowerCase() },
    {
      $set: {
        email: process.env.DEMO_STAFF_EMAIL.toLowerCase(),
        displayName: 'Demo Staff',
        passwordHash: await bcrypt.hash(process.env.DEMO_STAFF_PASSWORD, 12),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  let business = await Business.findOne({ name: 'Your Appointment Demo' });
  if (!business) {
    const _id = new mongoose.Types.ObjectId();
    business = await Business.create({
      _id,
      tenantId: _id,
      name: 'Your Appointment Demo',
      features: {
        appointments: true,
        walkInQueue: true,
        staffSelection: false,
        serviceSelection: true,
        guestBooking: true,
        customerAccounts: true,
        notifications: false,
        multipleBranches: false,
      },
    });
  }
  await Membership.updateOne(
    { tenantId: business._id, userId: owner._id },
    { $set: { roles: ['owner'], status: 'active' } },
    { upsert: true },
  );
  const branch = await Branch.findOneAndUpdate(
    { tenantId: business._id, name: 'Demo Branch' },
    {
      $set: {
        timezone: 'Asia/Kolkata',
        status: 'active',
        operatingHours: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          opensLocal: '09:00',
          closesLocal: '17:00',
        })),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  const service = await Service.findOneAndUpdate(
    { tenantId: business._id, name: 'Consultation' },
    {
      $set: {
        branchIds: [branch._id],
        appointmentEnabled: true,
        queueEnabled: true,
        durationMinutes: 30,
        status: 'active',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  const membership = await Membership.findOneAndUpdate(
    { tenantId: business._id, userId: staffUser._id },
    { $set: { roles: ['staff'], status: 'active' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  await StaffAssignment.updateOne(
    { tenantId: business._id, membershipId: membership._id, branchId: branch._id },
    { $set: { serviceIds: [service._id], status: 'active', workingHours: branch.operatingHours } },
    { upsert: true },
  );
  await QueueConfiguration.updateOne(
    { tenantId: business._id, branchId: branch._id, serviceId: service._id },
    { $set: { isOpen: true } },
    { upsert: true },
  );
  await PublicAccessToken.updateMany(
    { tenantId: business._id, purpose: 'branch_qr', resourceId: branch._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  const credential = await issuePublicToken({
    tenantId: business._id,
    purpose: 'branch_qr',
    resourceId: branch._id,
  });
  console.log(`Queue QR URL: ${new URL(`/queue/entry/${credential}`, env.FRONTEND_ORIGIN)}`);
  console.log(`Demo business ID: ${business._id}`);
  console.log(`Demo branch ID: ${branch._id}`);
  console.log(`Demo service ID: ${service._id}`);
  console.log(`Owner account: ${owner.email}`);
  console.log(`Staff account: ${staffUser.email}`);
} finally {
  await disconnectDatabase();
}
