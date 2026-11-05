const crypto = require('crypto');
const {
  Notification,
  SchoolNotificationAlert,
  AuditEntry,
  SchoolSetting,
  Guardian,
  PupilGuardian,
  Pupil
} = require('./models');

// In-memory mock provider state / hooks for testing and real behavior simulation
const providerMockConfigs = {
  push: {
    supported: true,
    simulateFailure: false,
    failureType: 'transient', // 'transient' or 'permanent'
    autoDeliver: true
  },
  sms: {
    supported: true,
    simulateFailure: false,
    failureType: 'transient',
    autoDeliver: true
  },
  whatsapp: {
    supported: true,
    simulateFailure: false,
    failureType: 'transient',
    autoDeliver: true
  },
  email: {
    supported: true,
    simulateFailure: false,
    failureType: 'transient',
    autoDeliver: true
  }
};

function setProviderMockConfig(channel, config) {
  if (providerMockConfigs[channel]) {
    Object.assign(providerMockConfigs[channel], config);
  }
}

function resetProviderMockConfigs() {
  providerMockConfigs.push = { supported: true, simulateFailure: false, failureType: 'transient', autoDeliver: true };
  providerMockConfigs.sms = { supported: true, simulateFailure: false, failureType: 'transient', autoDeliver: true };
  providerMockConfigs.whatsapp = { supported: true, simulateFailure: false, failureType: 'transient', autoDeliver: true };
  providerMockConfigs.email = { supported: true, simulateFailure: false, failureType: 'transient', autoDeliver: true };
}

/**
 * Builds safe, privacy-compliant message body and lock-screen preview.
 * - Always includes: pupil display name, event type, local timestamp, school identity ("Northfield Academy").
 * - Collector name included ONLY when configured and appropriate (discloseCollectorName: true).
 * - NEVER includes sensitive identifiers, full addresses, or unnecessary pupil details.
 */
function buildNotificationMessages({ pupil, eventType, eventTime, campus, gate, collector, discloseCollectorName }) {
  const schoolName = 'Northfield Academy';
  const isArrival = eventType === 'arrival' || eventType === 'manual_arrival';
  const isCorrection = eventType === 'correction';

  const collectorDisplay = discloseCollectorName ? (collector || 'an authorized contact') : 'an authorized contact';

  let message = '';
  let preview = '';

  if (isArrival) {
    message = `${schoolName} Alert: ${pupil.name} has arrived safely at ${campus} (${gate}) at ${eventTime}.`;
    preview = `${schoolName}: ${pupil.name} arrived at ${eventTime}`;
  } else if (isCorrection) {
    message = `${schoolName} Alert: An attendance record correction was logged for ${pupil.name} at ${eventTime}.`;
    preview = `${schoolName}: Attendance update for ${pupil.name} at ${eventTime}`;
  } else {
    // Departure
    message = `${schoolName} Alert: ${pupil.name} departed from ${campus} with ${collectorDisplay} at ${eventTime}.`;
    preview = `${schoolName}: ${pupil.name} departed at ${eventTime}`;
  }

  return { message, preview };
}

/**
 * Calculates exponential bounded backoff retry timestamp.
 * Base delay: 2 minutes * (2 ^ (attemptCount - 1)), max 30 minutes.
 */
function computeNextRetryAt(attemptCount) {
  const maxDelayMs = 30 * 60 * 1000;
  const baseDelayMs = 2 * 60 * 1000;
  const delayMs = Math.min(baseDelayMs * Math.pow(2, Math.max(0, attemptCount - 1)), maxDelayMs);
  return new Date(Date.now() + delayMs);
}

/**
 * Sends a message via provider mock and determines accurate status:
 * 'accepted_by_provider', 'delivered', 'failed', or 'suppressed'.
 * Provider acceptance is NOT labeled as delivery.
 */
async function dispatchToProvider(channel, recipient, messagePayload) {
  const config = providerMockConfigs[channel] || { supported: false };
  if (!config.supported) {
    return {
      success: false,
      status: 'failed',
      failureCategory: 'config_error',
      errorReason: `Provider does not support channel ${channel}`
    };
  }

  if (config.simulateFailure) {
    return {
      success: false,
      status: 'failed',
      failureCategory: config.failureType || 'transient',
      errorReason: `Simulated provider transmission failure for ${channel}`
    };
  }

  // Accepted by provider
  const ref = `prov_ref_${crypto.randomBytes(6).toString('hex')}`;
  if (config.autoDeliver) {
    return {
      success: true,
      status: 'delivered',
      providerReference: ref,
      deliveryReported: true
    };
  }

  return {
    success: true,
    status: 'accepted_by_provider',
    providerReference: ref,
    deliveryReported: false
  };
}

/**
 * Dispatches notifications for an attendance event.
 * Follows MVP rule: Push plus SMS fallback.
 * WhatsApp requires opt-in, template, provider, cost, and delivery confirmations.
 * Suppresses non-critical alerts if guardian paused notifications.
 * Maintains school-visible alert if all configured channels fail.
 */
async function dispatchEventNotifications({ event, pupil, discloseCollectorName, user }) {
  const eventTime = event.time;
  const campus = event.campus || 'Primary campus';
  const gate = event.gate || 'Main gate';
  const collector = event.collector;

  const { message, preview } = buildNotificationMessages({
    pupil,
    eventType: event.type,
    eventTime,
    campus,
    gate,
    collector,
    discloseCollectorName
  });

  // Find linked guardians
  const links = await PupilGuardian.find({ pupilId: pupil.id, status: { $ne: 'revoked' } });
  let guardians = [];
  if (links.length > 0) {
    const gIds = links.map(l => l.guardianId);
    guardians = await Guardian.find({ id: { $in: gIds } });
  }

  // Fallback if no Guardian document exists yet (e.g. initial demo pupil without full guardian profile)
  if (guardians.length === 0) {
    guardians = [{
      id: null,
      name: pupil.guardian,
      phone: pupil.guardianPhone || '+1 555-0100',
      email: pupil.guardianEmail || `${pupil.guardian.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      preferredChannels: pupil.preferredChannel ? [pupil.preferredChannel.toLowerCase()] : ['sms'],
      notificationsPaused: false,
      whatsappOptIn: null
    }];
  }

  const notificationsCreated = [];

  for (const guardian of guardians) {
    const isPaused = Boolean(guardian.notificationsPaused && (!guardian.notificationsPausedUntil || new Date(guardian.notificationsPausedUntil) > new Date()));

    if (isPaused) {
      // Guardian paused non-critical notifications
      const nid = crypto.randomBytes(9).toString('base64url');
      const suppressedNotif = await Notification.create({
        id: nid,
        eventId: event.id,
        pupilId: pupil.id,
        guardianId: guardian.id,
        guardianName: guardian.name,
        channel: 'PUSH',
        recipient: guardian.email || guardian.phone || 'guardian',
        message,
        preview,
        status: 'suppressed',
        failureCategory: 'opt_out',
        errorReason: 'Guardian paused non-critical notifications',
        sentAt: eventTime,
        idempotencyKey: `notif_${event.id}_${guardian.id || 'none'}_suppressed`
      });
      notificationsCreated.push(suppressedNotif);
      continue;
    }

    const guardianChannels = (guardian.preferredChannels || []).map(c => c.toLowerCase());
    const wantsWhatsApp = guardianChannels.includes('whatsapp');
    const wantsPush = guardianChannels.includes('push');
    const wantsEmail = guardianChannels.includes('email');
    const wantsSms = guardianChannels.includes('sms');

    // Verify WhatsApp requirements
    let whatsappEligible = false;
    let whatsappDisqualificationReason = '';
    if (wantsWhatsApp) {
      const wOpt = guardian.whatsappOptIn || {};
      if (!wOpt.optedIn) {
        whatsappDisqualificationReason = 'WhatsApp requires verified guardian opt-in';
      } else if (!wOpt.templateConfirmed) {
        whatsappDisqualificationReason = 'WhatsApp requires confirmed template registration';
      } else if (!wOpt.providerConfirmed) {
        whatsappDisqualificationReason = 'WhatsApp requires confirmed provider setup';
      } else if (!wOpt.costAcknowledged) {
        whatsappDisqualificationReason = 'WhatsApp requires cost requirement acknowledgment';
      } else if (!wOpt.deliveryConfirmed) {
        whatsappDisqualificationReason = 'WhatsApp requires delivery SLA confirmation';
      } else {
        whatsappEligible = true;
      }
    }

    let channelsToTry = [];
    if (guardianChannels.length > 0) {
      for (const ch of guardianChannels) {
        if (ch === 'whatsapp') {
          if (whatsappEligible && !channelsToTry.includes('whatsapp')) {
            channelsToTry.push('whatsapp');
          }
        } else if (['push', 'sms', 'email'].includes(ch)) {
          if (!channelsToTry.includes(ch)) {
            channelsToTry.push(ch);
          }
        }
      }
      if (channelsToTry.includes('push') && !channelsToTry.includes('sms')) {
        channelsToTry.push('sms');
      }
    }

    if (channelsToTry.length === 0) {
      channelsToTry = ['push', 'sms'];
    }

    // If WhatsApp was requested but ineligible, log a suppressed notification entry for WhatsApp
    if (wantsWhatsApp && !whatsappEligible) {
      const nid = crypto.randomBytes(9).toString('base64url');
      const waSuppressed = await Notification.create({
        id: nid,
        eventId: event.id,
        pupilId: pupil.id,
        guardianId: guardian.id,
        guardianName: guardian.name,
        channel: 'WHATSAPP',
        recipient: guardian.phone || '+1 555-0100',
        message,
        preview,
        status: 'suppressed',
        failureCategory: 'config_error',
        errorReason: whatsappDisqualificationReason,
        sentAt: eventTime,
        idempotencyKey: `notif_${event.id}_${guardian.id || 'none'}_whatsapp_suppressed`
      });
      notificationsCreated.push(waSuppressed);
    }

    let successRecorded = false;
    const attemptedResults = [];

    for (let i = 0; i < channelsToTry.length; i++) {
      const chan = channelsToTry[i];
      const isFallbackAttempt = i > 0;
      const fallbackFor = isFallbackAttempt ? channelsToTry[0] : null;

      let recipient = guardian.phone || pupil.guardianPhone || '+1 555-0100';
      if (chan === 'email') {
        recipient = guardian.email || pupil.guardianEmail || `${guardian.name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
      } else if (chan === 'push') {
        recipient = guardian.pushToken || `push_dev_${guardian.id || pupil.id}`;
      }

      const idempotencyKey = `notif_${event.id}_${guardian.id || pupil.id}_${chan}`;
      const existingNotif = await Notification.findOne({ idempotencyKey });
      if (existingNotif) {
        notificationsCreated.push(existingNotif);
        if (['accepted_by_provider', 'delivered', 'Sent', 'Delivered'].includes(existingNotif.status)) {
          successRecorded = true;
          break;
        }
        continue;
      }

      const dispatchRes = await dispatchToProvider(chan, recipient, { message, preview });
      const nid = crypto.randomBytes(9).toString('base64url');

      const notifDoc = await Notification.create({
        id: nid,
        eventId: event.id,
        pupilId: pupil.id,
        guardianId: guardian.id,
        guardianName: guardian.name,
        channel: chan.toUpperCase(),
        recipient,
        message,
        preview,
        provider: `provider-${chan}`,
        providerReference: dispatchRes.providerReference || null,
        status: dispatchRes.status,
        deliveryReported: Boolean(dispatchRes.deliveryReported),
        attemptCount: 1,
        maxAttempts: 3,
        lastAttemptAt: new Date(),
        nextRetryAt: dispatchRes.status === 'failed' && dispatchRes.failureCategory === 'transient' ? computeNextRetryAt(1) : null,
        errorReason: dispatchRes.errorReason || null,
        failureCategory: dispatchRes.failureCategory || 'none',
        sentAt: eventTime,
        isFallback: isFallbackAttempt,
        fallbackForChannel: fallbackFor ? fallbackFor.toUpperCase() : null,
        idempotencyKey
      });

      notificationsCreated.push(notifDoc);
      attemptedResults.push(notifDoc);

      if (dispatchRes.success) {
        successRecorded = true;
        break; // Successfully accepted or delivered; fallback not needed
      }
    }

    // Maintain a school-visible alert when ALL configured channels fail
    if (!successRecorded && attemptedResults.length > 0) {
      const failedChans = attemptedResults.map(r => r.channel);
      const alertId = 'SNA-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      await SchoolNotificationAlert.create({
        id: alertId,
        eventId: event.id,
        pupilId: pupil.id,
        pupilName: pupil.name,
        guardianId: guardian.id,
        guardianName: guardian.name,
        failedChannels: failedChans,
        reason: `All notification channels failed for ${pupil.name} (${failedChans.join(', ')}). Immediate staff follow-up required.`,
        status: 'active',
        createdAt: new Date()
      });

      await AuditEntry.create({
        userId: user ? user._id : null,
        action: 'notification_delivery_failure_alert',
        objectType: 'notification_alert',
        objectId: alertId,
        reason: `Event=${event.id}; Pupil=${pupil.id}; Guardian=${guardian.name}; Channels=${failedChans.join(',')}`,
        createdAt: new Date()
      });
    }
  }

  // Pick primary notification for response backward compatibility
  const primaryNotification = notificationsCreated.find(n => !n.isFallback && n.status !== 'suppressed') ||
                             notificationsCreated[0] ||
                             null;

  return {
    primaryNotification: primaryNotification ? {
      id: primaryNotification.id,
      guardian: primaryNotification.guardianName,
      channel: primaryNotification.channel,
      recipient: primaryNotification.recipient,
      message: primaryNotification.message,
      preview: primaryNotification.preview,
      status: primaryNotification.status
    } : null,
    notifications: notificationsCreated
  };
}

/**
 * Retries transient failures with bounded backoff and idempotency guard.
 */
async function retryNotification(notificationId, user) {
  const notif = await Notification.findOne({ id: notificationId });
  if (!notif) {
    throw new Error('Notification not found.');
  }

  if (['delivered', 'accepted_by_provider'].includes(notif.status)) {
    return { ok: true, message: 'Notification already accepted or delivered.', notification: notif };
  }

  if (notif.attemptCount >= notif.maxAttempts) {
    throw new Error(`Maximum retry attempts (${notif.maxAttempts}) reached for this notification.`);
  }

  notif.attemptCount += 1;
  notif.lastAttemptAt = new Date();

  const channel = notif.channel.toLowerCase();
  const dispatchRes = await dispatchToProvider(channel, notif.recipient, {
    message: notif.message,
    preview: notif.preview
  });

  notif.status = dispatchRes.status;
  notif.providerReference = dispatchRes.providerReference || notif.providerReference;
  notif.deliveryReported = Boolean(dispatchRes.deliveryReported);

  if (dispatchRes.success) {
    notif.errorReason = null;
    notif.failureCategory = 'none';
    notif.nextRetryAt = null;

    // Check if an active school alert for this event/guardian exists and can be resolved
    const activeAlert = await SchoolNotificationAlert.findOne({
      eventId: notif.eventId,
      pupilId: notif.pupilId,
      status: 'active'
    });
    if (activeAlert) {
      activeAlert.status = 'resolved';
      activeAlert.acknowledgedBy = user ? user.name : 'System Retry';
      activeAlert.acknowledgedAt = new Date();
      await activeAlert.save();
    }
  } else {
    notif.errorReason = dispatchRes.errorReason || 'Retry attempt failed';
    notif.failureCategory = dispatchRes.failureCategory || 'transient';
    notif.nextRetryAt = computeNextRetryAt(notif.attemptCount);
  }

  await notif.save();

  await AuditEntry.create({
    userId: user ? user._id : null,
    action: 'retry_notification',
    objectType: 'notification',
    objectId: notif.id,
    reason: `Attempt=${notif.attemptCount}; Status=${notif.status}; Error=${notif.errorReason || 'none'}`,
    createdAt: new Date()
  });

  return { ok: true, notification: notif };
}

module.exports = {
  buildNotificationMessages,
  computeNextRetryAt,
  dispatchToProvider,
  dispatchEventNotifications,
  retryNotification,
  setProviderMockConfig,
  resetProviderMockConfigs,
  providerMockConfigs
};
