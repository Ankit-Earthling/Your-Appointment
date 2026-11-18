import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { Appointment, CustomerProfile, QueueTicket } from '../models/index.js';

const apply = process.argv.includes('--apply');

try {
  await connectDatabase(env.MONGODB_URI);
  const profiles = await CustomerProfile.find({}).select('_id tenantId consentAt consentSource');
  let backfilled = 0;
  let anonymized = 0;
  let alreadyConsented = 0;

  for (const profile of profiles) {
    if (profile.consentAt) {
      alreadyConsented += 1;
      continue;
    }
    const [queueEvidence, appointmentEvidence] = await Promise.all([
      QueueTicket.findOne({
        tenantId: profile.tenantId,
        customerProfileId: profile._id,
        profileConsentAt: { $ne: null },
      })
        .sort({ profileConsentAt: 1 })
        .select('profileConsentAt'),
      Appointment.findOne({
        tenantId: profile.tenantId,
        customerProfileId: profile._id,
        profileConsentAt: { $ne: null },
      })
        .sort({ profileConsentAt: 1 })
        .select('profileConsentAt'),
    ]);
    const evidence = [
      queueEvidence && { ...queueEvidence.toObject(), source: 'queue_completion' },
      appointmentEvidence && { ...appointmentEvidence.toObject(), source: 'appointment_booking' },
    ]
      .filter(Boolean)
      .sort((a, b) => a.profileConsentAt - b.profileConsentAt)[0];
    if (evidence) {
      backfilled += 1;
      if (apply) {
        await CustomerProfile.updateOne(
          { _id: profile._id, tenantId: profile.tenantId, consentAt: null },
          {
            $set: {
              consentAt: evidence.profileConsentAt,
              consentSource: evidence.source,
              // The legacy queue form did not collect contact details separately.
              email: '',
              phone: '',
              emailVerifiedAt: null,
              phoneVerifiedAt: null,
            },
          },
        );
      }
    } else {
      anonymized += 1;
      if (apply) {
        await CustomerProfile.updateOne(
          { _id: profile._id, tenantId: profile.tenantId, consentAt: null },
          {
            $set: {
              displayName: 'Anonymous customer',
              email: '',
              phone: '',
              emailVerifiedAt: null,
              phoneVerifiedAt: null,
              userId: null,
              consentAt: null,
              consentSource: null,
            },
          },
        );
      }
    }
  }

  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      totalProfiles: profiles.length,
      backfilled,
      anonymized,
      alreadyConsented,
    }),
  );
} catch (error) {
  console.error(
    `Customer consent migration failed (${error.name ?? 'Error'}). Check local database configuration and logs without sharing credentials.`,
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}

if (!apply) console.log('No records changed. Pass --apply to apply the reported changes.');
