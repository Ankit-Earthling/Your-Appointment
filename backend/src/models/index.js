import mongoose from 'mongoose';

const { Schema } = mongoose;
const objectId = Schema.Types.ObjectId;
const baseOptions = { timestamps: true, versionKey: false, strict: 'throw' };

const operatingHoursSchema = new Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    opensLocal: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
    closesLocal: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: 100 },
    passwordHash: { type: String, required: true, select: false },
    platformRoles: { type: [String], enum: ['platform_admin'], default: [] },
  },
  baseOptions,
);

const businessSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    businessType: { type: String, trim: true, maxlength: 80, default: '' },
    createdByUserId: { type: objectId, ref: 'User', select: false },
    creationKey: { type: String, select: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    features: {
      appointments: { type: Boolean, default: false },
      walkInQueue: { type: Boolean, default: false },
      staffSelection: { type: Boolean, default: false },
      serviceSelection: { type: Boolean, default: true },
      guestBooking: { type: Boolean, default: true },
      customerAccounts: { type: Boolean, default: true },
      notifications: { type: Boolean, default: false },
      multipleBranches: { type: Boolean, default: false },
    },
  },
  baseOptions,
);
businessSchema.index(
  { createdByUserId: 1, creationKey: 1 },
  { unique: true, partialFilterExpression: { creationKey: { $type: 'string' } } },
);

const membershipSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    userId: { type: objectId, ref: 'User', required: true, index: true },
    roles: { type: [String], enum: ['owner', 'staff'], required: true },
    creationKey: { type: String, select: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  baseOptions,
);
membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
membershipSchema.index(
  { userId: 1, creationKey: 1 },
  { unique: true, partialFilterExpression: { creationKey: { $type: 'string' } } },
);

const branchSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    address: {
      city: { type: String, trim: true, maxlength: 100, default: '' },
      countryCode: { type: String, uppercase: true, trim: true, maxlength: 2, default: '' },
      addressLine: { type: String, trim: true, maxlength: 200, default: '' },
    },
    timezone: { type: String, required: true },
    operatingHours: { type: [operatingHoursSchema], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  baseOptions,
);
branchSchema.index({ tenantId: 1, status: 1 });

const serviceSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    branchIds: { type: [objectId], ref: 'Branch', required: true },
    appointmentEnabled: { type: Boolean, default: false },
    queueEnabled: { type: Boolean, default: false },
    durationMinutes: { type: Number, min: 5, max: 720, default: 30 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  baseOptions,
);
serviceSchema.index({ tenantId: 1, status: 1 });

const staffAssignmentSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    membershipId: { type: objectId, ref: 'Membership', required: true, index: true },
    branchId: { type: objectId, ref: 'Branch', required: true, index: true },
    serviceIds: { type: [objectId], ref: 'Service', default: [] },
    workingHours: { type: [operatingHoursSchema], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  baseOptions,
);
staffAssignmentSchema.index({ tenantId: 1, membershipId: 1, branchId: 1 }, { unique: true });

const customerProfileSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    userId: { type: objectId, ref: 'User', default: null, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, lowercase: true, trim: true, maxlength: 254, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
  },
  baseOptions,
);
customerProfileSchema.index(
  { tenantId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } },
);

const appointmentSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    branchId: { type: objectId, ref: 'Branch', required: true, index: true },
    serviceId: { type: objectId, ref: 'Service', required: true, index: true },
    staffAssignmentId: { type: objectId, ref: 'StaffAssignment', required: true, index: true },
    customerUserId: { type: objectId, ref: 'User', default: null, index: true },
    customerProfileId: { type: objectId, ref: 'CustomerProfile', required: true },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    localDate: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
      default: 'BOOKED',
      index: true,
    },
    statusHistory: {
      type: [
        new Schema(
          {
            status: { type: String, enum: ['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] },
            at: { type: Date, required: true },
            actorUserId: { type: objectId, ref: 'User', default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  baseOptions,
);
appointmentSchema.index({ tenantId: 1, branchId: 1, startAt: 1 });
appointmentSchema.index({ tenantId: 1, staffAssignmentId: 1, startAt: 1, endAt: 1 });
appointmentSchema.index({ customerUserId: 1, startAt: -1 });

const reservationCalendarSchema = new Schema(
  {
    tenantId: { type: objectId, required: true },
    branchId: { type: objectId, ref: 'Branch', required: true },
    staffAssignmentId: { type: objectId, ref: 'StaffAssignment', required: true },
    localDate: { type: String, required: true },
    reservations: {
      type: [
        new Schema(
          {
            appointmentId: { type: objectId, ref: 'Appointment', required: true },
            startAt: { type: Date, required: true },
            endAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  baseOptions,
);
reservationCalendarSchema.index(
  { tenantId: 1, staffAssignmentId: 1, localDate: 1 },
  { unique: true },
);

const queueConfigurationSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    branchId: { type: objectId, ref: 'Branch', required: true, index: true },
    serviceId: { type: objectId, ref: 'Service', required: true, index: true },
    isOpen: { type: Boolean, default: true },
  },
  baseOptions,
);
queueConfigurationSchema.index({ tenantId: 1, branchId: 1, serviceId: 1 }, { unique: true });

const queueCounterSchema = new Schema(
  {
    tenantId: { type: objectId, required: true },
    queueConfigurationId: { type: objectId, ref: 'QueueConfiguration', required: true },
    localDate: { type: String, required: true },
    currentNumber: { type: Number, default: 0, min: 0 },
  },
  baseOptions,
);
queueCounterSchema.index({ tenantId: 1, queueConfigurationId: 1, localDate: 1 }, { unique: true });

const queueTicketSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    branchId: { type: objectId, ref: 'Branch', required: true, index: true },
    serviceId: { type: objectId, ref: 'Service', required: true, index: true },
    queueConfigurationId: { type: objectId, ref: 'QueueConfiguration', required: true },
    customerUserId: { type: objectId, ref: 'User', default: null, index: true },
    customerProfileId: { type: objectId, ref: 'CustomerProfile', required: true },
    localDate: { type: String, required: true, index: true },
    sequenceNumber: { type: Number, required: true },
    status: {
      type: String,
      enum: ['WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'NO_SHOW', 'CANCELLED'],
      default: 'WAITING',
      index: true,
    },
    joinedAt: { type: Date, required: true, default: Date.now },
    statusHistory: {
      type: [
        new Schema(
          {
            status: {
              type: String,
              enum: ['WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'NO_SHOW', 'CANCELLED'],
            },
            at: { type: Date, required: true },
            actorUserId: { type: objectId, ref: 'User', default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  baseOptions,
);
queueTicketSchema.index(
  { tenantId: 1, queueConfigurationId: 1, localDate: 1, sequenceNumber: 1 },
  { unique: true },
);
queueTicketSchema.index({ tenantId: 1, queueConfigurationId: 1, localDate: 1, status: 1 });

const publicAccessTokenSchema = new Schema(
  {
    tenantId: { type: objectId, required: true, index: true },
    purpose: { type: String, enum: ['branch_qr', 'appointment', 'queue_ticket'], required: true },
    resourceId: { type: objectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  baseOptions,
);
publicAccessTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } },
);

const auditEventSchema = new Schema(
  {
    tenantId: { type: objectId, default: null, index: true },
    actorUserId: { type: objectId, ref: 'User', default: null },
    action: { type: String, required: true, maxlength: 100 },
    resourceType: { type: String, required: true, maxlength: 80 },
    resourceId: { type: objectId, default: null },
    occurredAt: { type: Date, required: true, default: Date.now },
    summary: { type: String, maxlength: 240, default: '' },
  },
  { ...baseOptions, timestamps: false },
);
auditEventSchema.index({ tenantId: 1, occurredAt: -1 });

function model(name, schema) {
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

export const User = model('User', userSchema);
export const Business = model('Business', businessSchema);
export const Membership = model('Membership', membershipSchema);
export const Branch = model('Branch', branchSchema);
export const Service = model('Service', serviceSchema);
export const StaffAssignment = model('StaffAssignment', staffAssignmentSchema);
export const CustomerProfile = model('CustomerProfile', customerProfileSchema);
export const Appointment = model('Appointment', appointmentSchema);
export const ReservationCalendar = model('ReservationCalendar', reservationCalendarSchema);
export const QueueConfiguration = model('QueueConfiguration', queueConfigurationSchema);
export const QueueCounter = model('QueueCounter', queueCounterSchema);
export const QueueTicket = model('QueueTicket', queueTicketSchema);
export const PublicAccessToken = model('PublicAccessToken', publicAccessTokenSchema);
export const AuditEvent = model('AuditEvent', auditEventSchema);
