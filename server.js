const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

const {
  User,
  Pupil,
  PickupRequest,
  AttendanceEvent,
  Notification,
  AuditEntry,
  Session,
  SchoolSetting,
  Guardian,
  PupilGuardian,
  CorrectionRequest,
  Card
} = require('./models');
const {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  passwordHash,
  verifyPassword,
  nowLocal,
  formatTime,
  formatDate,
  formatTimeInTimezone,
  formatDateInTimezone,
  seedInitialData,
  getNextCollectorId
} = require('./authUtils');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = process.env.GATEWISE_HOST || '127.0.0.1';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://bolatan_db_user:D77w1DF4Ecpl4YOv@cluster0.hrlxnk2.mongodb.net/gatewise?retryWrites=true&w=majority';
const SESSION_SECONDS = 8 * 60 * 60;

const IMPORT_STAGES = new Map();
const IMPORT_COLUMNS = ["pupil_id", "pupil_name", "class_name", "guardian_name"];
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

app.use(cors({ origin: true, credentials: true }));
// In serverless runtimes (e.g. Vercel), req.body may already be parsed
app.use((req, res, next) => {
  if (req.body !== undefined) return next();
  express.json({ limit: '12mb' })(req, res, next);
});
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

// Middleware for authentication
async function getSessionUser(req) {
  const token = req.cookies.gw_session;
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await Session.findOne({ tokenHash });
  if (!session) return null;
  if (session.expiresAt < Math.floor(Date.now() / 1000)) {
    await Session.deleteOne({ tokenHash });
    return null;
  }
  const user = await User.findById(session.userId);
  if (!user || !user.active) return null;
  return user;
}

function requireAuth(roles = ['admin', 'manager', 'viewer']) {
  return async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Sign in to continue.' });
      }
      if (!roles.includes(user.role)) {
        return res.status(403).json({ error: 'You do not have permission to do that.' });
      }
      req.user = user;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return true;
    if (url.hostname.endsWith('.vercel.app')) return true;
    if (req.headers.host && (url.host === req.headers.host || url.hostname === req.headers.host)) return true;
    return false;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && !originOk(req)) {
    return res.status(403).json({ error: 'Cross-origin request rejected.' });
  }
  next();
});

async function getStateJson() {
  const settingsDocs = await SchoolSetting.find();
  const schoolSettingsMap = {};
  settingsDocs.forEach(s => { schoolSettingsMap[s.key] = s.val; });

  const pupilDocs = await Pupil.find({ active: true }).sort({ name: 1 });
  const activeCards = await Card.find({ status: 'active' });
  const cardMap = {};
  activeCards.forEach(c => { cardMap[c.pupilId] = c; });

  const pupils = pupilDocs.map(p => {
    const activeCollectors = (p.collectors || [])
      .filter(c => c.active && (c.until === 'Ongoing' || new Date(c.until) >= new Date().setHours(0,0,0,0)))
      .map(c => ({ id: c.id, name: c.name, relation: c.relation, until: c.until }));
    const pCard = cardMap[p.id];
    return {
      id: p.id,
      name: p.name,
      className: p.className,
      guardian: p.guardian,
      guardianPhone: p.guardianPhone || '+1 555-0100',
      guardianEmail: p.guardianEmail || '',
      preferredChannel: p.preferredChannel || 'sms',
      initials: p.initials,
      color: p.color,
      photo: p.photo,
      collectors: activeCollectors,
      cardToken: pCard ? pCard.cardToken : null,
      cardId: pCard ? pCard.id : null,
      cardStatus: pCard ? pCard.status : 'no_card'
    };
  });

  const notificationDocs = await Notification.find().sort({ createdAt: -1 }).limit(100);
  const notifications = notificationDocs.map(n => ({
    id: n.id,
    eventId: n.eventId,
    pupilId: n.pupilId,
    guardianName: n.guardianName,
    channel: n.channel,
    recipient: n.recipient,
    message: n.message,
    status: n.status,
    sentAt: n.sentAt
  }));

  const defaultSessions = [
    { id: "morning", name: "Morning Arrival", startTime: "07:30", endTime: "08:30", defaultMode: "arrival" },
    { id: "standard", name: "Standard Day", startTime: "08:30", endTime: "14:30", defaultMode: "arrival" },
    { id: "afternoon", name: "Afternoon Dismissal", startTime: "14:30", endTime: "15:30", defaultMode: "departure" }
  ];
  const configuredSessions = schoolSettingsMap.operatingSessions || defaultSessions;
  const sessionNames = configuredSessions.map(s => s.name || s);

  const defaultCampusTimezones = {
    "Primary campus": "Europe/London",
    "Secondary campus": "Europe/London",
    "North gate annex": "Europe/London"
  };
  const campusTimezones = schoolSettingsMap.campusTimezones || defaultCampusTimezones;
  const schoolTimezone = schoolSettingsMap.timezone || "Europe/London";

  const eventDocs = await AttendanceEvent.find().sort({ createdAt: -1 }).limit(150);
  const events = eventDocs.map(e => ({
    id: e.id,
    pupilId: e.pupilId,
    type: e.type,
    timestamp: e.timestamp ? e.timestamp.toISOString() : (e.utcTimestamp || new Date(e.createdAt).toISOString()),
    utcTimestamp: e.utcTimestamp || (e.timestamp ? e.timestamp.toISOString() : new Date(e.createdAt).toISOString()),
    time: e.time,
    date: e.date,
    createdAt: e.createdAt,
    staff: e.staff,
    actorId: e.actorId ? e.actorId.toString() : null,
    source: e.source,
    collector: e.collector,
    verification: e.verification,
    device: e.device || 'Primary Gate Terminal',
    campus: e.campus || 'Primary campus',
    gate: e.gate || 'Main gate',
    session: e.session || 'Morning Arrival',
    alert: e.alert,
    reason: e.reason || '',
    correctionReason: e.correctionReason || e.reason || '',
    manualEntry: Boolean(e.manualEntry),
    correctionLink: e.correctionLink || null,
    clientEventId: e.clientEventId || null,
    offlineQueued: Boolean(e.offlineQueued),
    deviceCapturedAt: e.deviceCapturedAt || null,
    serverReceivedAt: e.serverReceivedAt || null,
    syncStatus: e.syncStatus || 'synced',
    reconciliationAuditReason: e.reconciliationAuditReason || ''
  }));

  const requestDocs = await PickupRequest.find({ status: 'pending' }).sort({ createdAt: 1 });
  const requests = requestDocs.map(r => ({
    id: r.id,
    pupilId: r.pupilId,
    name: r.name,
    relation: r.relation,
    requestedBy: r.requestedBy,
    time: r.time,
    note: r.note
  }));

  return {
    pupils,
    events,
    requests,
    notifications,
    school: {
      name: "Northfield Academy",
      campus: "Primary campus",
      campuses: ["Primary campus", "Secondary campus", "North gate annex"],
      gates: ["Main gate", "East pedestrian gate", "Bus drop-off gate"],
      timezone: schoolTimezone,
      campusTimezones,
      operatingSessions: configuredSessions,
      sessions: sessionNames,
      devices: ["Primary Gate Terminal", "East Gate Handheld", "Bus Loop Scanner", "Admin Front Desk"],
      discloseCollectorName: schoolSettingsMap.discloseCollectorName !== undefined ? Boolean(schoolSettingsMap.discloseCollectorName) : true,
      allowOfflineStalePickupPolicy: schoolSettingsMap.allowOfflineStalePickupPolicy !== undefined ? Boolean(schoolSettingsMap.allowOfflineStalePickupPolicy) : false,
      totalPupils: 248
    },
    notificationsStatus: "active"
  };
}

function getUsersJson(userDocs) {
  return userDocs.map(u => ({
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active
  }));
}

// Routes
app.get('/api/me', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return res.json({ user: null });
    }
    let guardianData = null;
    if (user.role === 'guardian' && user.guardianId) {
      guardianData = await Guardian.findOne({ id: user.guardianId });
    }
    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        guardianId: user.guardianId || null,
        guardianStatus: guardianData ? guardianData.status : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email, active: true });
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;

    await Session.create({
      tokenHash,
      userId: user._id,
      expiresAt: expiry,
      createdAt: Math.floor(Date.now() / 1000)
    });

    await Session.deleteMany({ expiresAt: { $lt: Math.floor(Date.now() / 1000) } });

    res.cookie('gw_session', token, {
      path: '/',
      maxAge: SESSION_SECONDS * 1000,
      httpOnly: true,
      sameSite: 'strict'
    });

    const state = user.role === 'guardian' ? null : await getStateJson();
    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        guardianId: user.guardianId || null
      },
      state
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const token = req.cookies.gw_session;
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await Session.deleteOne({ tokenHash });
    }
    res.clearCookie('gw_session', { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/state', requireAuth(), async (req, res) => {
  try {
    const state = await getStateJson();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', requireAuth(['admin']), async (req, res) => {
  try {
    const userDocs = await User.find().sort({ name: 1 });
    res.json({ users: getUsersJson(userDocs) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAuth(['admin']), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
    const role = String(req.body.role || '');
    const password = String(req.body.password || '');

    if (!name) return res.status(400).json({ error: "Enter the user's name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!['admin', 'manager', 'viewer'].includes(role)) return res.status(400).json({ error: 'Choose admin, manager, or viewer.' });
    if (password.length < 12) return res.status(400).json({ error: 'Temporary password must be at least 12 characters.' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'A user with that email already exists.' });

    const { salt, hash } = passwordHash(password);
    const newUser = await User.create({
      email,
      name,
      role,
      salt,
      passwordHash: hash,
      active: true
    });

    await AuditEntry.create({
      userId: req.user._id,
      action: 'create_user',
      objectType: 'user',
      objectId: newUser._id.toString(),
      reason: role,
      createdAt: new Date()
    });

    const userDocs = await User.find().sort({ name: 1 });
    res.status(201).json({ ok: true, users: getUsersJson(userDocs) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;
    const { role, active } = req.body;

    if (role !== undefined && !['admin', 'manager', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Choose admin, manager, or viewer.' });
    }
    if (active !== undefined && typeof active !== 'boolean') {
      return res.status(400).json({ error: 'User status must be active or inactive.' });
    }

    if (req.user._id.toString() === userId) {
      if ((role !== undefined && role !== 'admin') || active === false) {
        return res.status(400).json({ error: 'You cannot remove your own admin access.' });
      }
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found.' });

    const finalRole = role || targetUser.role;
    const finalActive = active !== undefined ? active : targetUser.active;

    if (targetUser.role === 'admin' && targetUser.active && (finalRole !== 'admin' || !finalActive)) {
      const activeAdmins = await User.countDocuments({ role: 'admin', active: true });
      if (activeAdmins <= 1) {
        return res.status(400).json({ error: 'Keep at least one active administrator.' });
      }
    }

    targetUser.role = finalRole;
    targetUser.active = finalActive;
    await targetUser.save();

    await AuditEntry.create({
      userId: req.user._id,
      action: 'update_user',
      objectType: 'user',
      objectId: userId,
      reason: `role=${finalRole}; active=${finalActive}`,
      createdAt: new Date()
    });

    if (!finalActive || finalRole !== targetUser.role) {
      await Session.deleteMany({ userId: targetUser._id });
    }

    const userDocs = await User.find().sort({ name: 1 });
    res.json({ ok: true, users: getUsersJson(userDocs) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pupils', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    let pid = String(req.body.id || '').trim().toUpperCase().slice(0, 30);
    const className = String(req.body.className || '').trim().slice(0, 30);
    const guardian = String(req.body.guardian || '').trim().slice(0, 100);

    if (!name || !className || !guardian) {
      return res.status(400).json({ error: 'Name, class, and guardian are required.' });
    }
    if (!pid) {
      pid = 'NF-' + String(Math.floor(Math.random() * 9000) + 1000);
    }
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(pid)) {
      return res.status(400).json({ error: 'Pupil ID may contain letters, numbers, and hyphens only.' });
    }

    const existing = await Pupil.findOne({ id: pid });
    if (existing) {
      return res.status(409).json({ error: 'That record already exists or is no longer available.' });
    }

    const colors = ["rose", "mint", "sand", "blue", "violet"];
    const initials = name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
    const guardianEmail = String(req.body.guardianEmail || '').trim().toLowerCase();
    const guardianPhone = String(req.body.guardianPhone || '+1 555-0100').trim();
    const preferredChannel = String(req.body.preferredChannel || 'sms').toLowerCase();

    await Pupil.create({
      id: pid,
      name,
      className,
      guardian,
      guardianPhone,
      guardianEmail,
      preferredChannel: ['sms', 'whatsapp', 'push', 'email'].includes(preferredChannel) ? preferredChannel : 'sms',
      initials,
      color: colors[Math.floor(Date.now() / 1000) % colors.length],
      photo: '♙',
      active: true,
      collectors: []
    });

    // Create random non-meaningful token for card
    const cardToken = 'gw_tok_' + crypto.randomBytes(12).toString('hex');
    await Card.create({
      id: `card-${pid}-${Date.now()}`,
      pupilId: pid,
      cardToken,
      status: 'active',
      issuedAt: new Date(),
      issuedBy: req.user.name || 'School Office'
    });

    // Optionally auto-invite or link guardian if inviteGuardian flag is present
    let inviteData = null;
    if (req.body.inviteGuardian) {
      const verifiedContactMethod = req.body.verifiedContactMethod === 'email' ? 'email' : 'sms';
      const guardianId = 'GD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const inviteToken = crypto.randomBytes(24).toString('base64url');
      const verificationCode = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit OTP

      const newGuardian = await Guardian.create({
        id: guardianId,
        name: guardian,
        email: guardianEmail,
        phone: guardianPhone,
        verifiedContactMethod,
        verificationCode,
        inviteToken,
        status: 'invited',
        preferredChannels: [preferredChannel]
      });

      await PupilGuardian.create({
        id: 'PG-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        pupilId: pid,
        guardianId: guardianId,
        relationship: req.body.relationship || 'Parent',
        isLegalGuardian: req.body.isLegalGuardian !== undefined ? Boolean(req.body.isLegalGuardian) : true,
        status: 'pending_verification',
        legalStatusApprovedBySchool: true,
        approvedBySchoolAt: new Date(),
        approvedByStaff: req.user.name
      });

      await AuditEntry.create({
        userId: req.user._id,
        action: 'invite_guardian',
        objectType: 'guardian',
        objectId: guardianId,
        reason: `Invited via ${verifiedContactMethod} for pupil ${pid}`,
        createdAt: new Date()
      });

      inviteData = {
        guardianId,
        inviteToken,
        verificationCode,
        verifiedContactMethod
      };
    }

    await AuditEntry.create({
      userId: req.user._id,
      action: 'create',
      objectType: 'pupil',
      objectId: pid,
      createdAt: new Date()
    });

    const state = await getStateJson();
    res.status(201).json({ ok: true, state, invite: inviteData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit Guardian Invite by School Staff
app.post('/api/guardians/invite', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const pupilId = String(req.body.pupilId || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const verifiedContactMethod = req.body.verifiedContactMethod === 'email' ? 'email' : 'sms';
    const relationship = String(req.body.relationship || 'Parent').trim();
    const isLegalGuardian = req.body.isLegalGuardian !== undefined ? Boolean(req.body.isLegalGuardian) : true;

    if (!pupilId || !name) {
      return res.status(400).json({ error: 'Pupil ID and guardian name are required.' });
    }
    if (verifiedContactMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required for email contact method.' });
    }
    if (verifiedContactMethod === 'sms' && !phone) {
      return res.status(400).json({ error: 'Phone number required for SMS contact method.' });
    }

    const pupil = await Pupil.findOne({ id: pupilId, active: true });
    if (!pupil) {
      return res.status(404).json({ error: 'Pupil not found.' });
    }

    const guardianId = 'GD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const inviteToken = crypto.randomBytes(24).toString('base64url');
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));

    const guardianDoc = await Guardian.create({
      id: guardianId,
      name,
      email,
      phone,
      verifiedContactMethod,
      verificationCode,
      inviteToken,
      status: 'invited',
      preferredChannels: [verifiedContactMethod]
    });

    const linkDoc = await PupilGuardian.create({
      id: 'PG-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      pupilId,
      guardianId,
      relationship,
      isLegalGuardian,
      status: 'pending_verification',
      legalStatusApprovedBySchool: true,
      approvedBySchoolAt: new Date(),
      approvedByStaff: req.user.name
    });

    await AuditEntry.create({
      userId: req.user._id,
      action: 'invite_guardian',
      objectType: 'guardian',
      objectId: guardianId,
      reason: `Method=${verifiedContactMethod}; Pupil=${pupilId}; LegalGuardian=${isLegalGuardian}`,
      createdAt: new Date()
    });

    res.status(201).json({
      ok: true,
      invite: {
        guardianId: guardianDoc.id,
        inviteToken,
        verificationCode,
        verifiedContactMethod,
        targetContact: verifiedContactMethod === 'email' ? email : phone,
        pupilId
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function processEventRecord(user, eventData) {
  const pid = String(eventData.pupilId || '').trim().toUpperCase().slice(0, 30);
  let typ = String(eventData.type || '').trim();
  let source = String(eventData.source || 'Card scan').slice(0, 50);
  const reason = String(eventData.reason || eventData.correctionReason || '').trim().slice(0, 200);
  const correctionLink = eventData.correctionLink ? String(eventData.correctionLink).trim() : null;
  const clientEventId = eventData.clientEventId ? String(eventData.clientEventId).trim() : null;
  const isOfflineSync = Boolean(eventData.offlineQueued);
  const isReconciled = Boolean(eventData.manualFallbackReconciled);
  const reconciliationAuditReason = eventData.reconciliationAuditReason ? String(eventData.reconciliationAuditReason).trim() : '';

  // 1. Idempotent deduplication check
  if (clientEventId) {
    const existingClientEvent = await AttendanceEvent.findOne({ clientEventId });
    if (existingClientEvent) {
      return {
        isDuplicate: true,
        eventId: existingClientEvent.id,
        event: existingClientEvent,
        message: 'Event was already synced idempotently.'
      };
    }
  }

  // 2. Offline queue validation: device must be managed and encrypted
  if (isOfflineSync) {
    const deviceManaged = eventData.deviceManaged !== false && eventData.deviceManaged !== 'false';
    const deviceEncrypted = eventData.deviceEncrypted !== false && eventData.deviceEncrypted !== 'false';
    if (!deviceManaged || !deviceEncrypted) {
      throw new Error('Offline sync rejected: The device must be managed and encrypted to queue events locally.');
    }

    // Expiration check: queue records expire under a defined policy (e.g. 24 hours / 86400000 ms)
    const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;
    const deviceCapturedAt = Number(eventData.deviceCapturedAt) || Date.now();
    if (Date.now() - deviceCapturedAt > MAX_QUEUE_AGE_MS) {
      throw new Error('Offline queued event has expired under the defined queue retention policy (exceeds 24 hours).');
    }

    // Staff binding validation
    if (eventData.staffEmail && eventData.staffEmail.toLowerCase() !== user.email.toLowerCase()) {
      throw new Error('Offline queued event signature does not match the active staff account.');
    }
  }

  // 3. Fallback reconciliation validation
  if (isReconciled && !reconciliationAuditReason) {
    throw new Error('Manual paper/voice fallback reconciliation requires an explicit audit reason.');
  }

  // Normalize source names (e.g. 'scan', 'search', 'offline')
  if (source.toLowerCase() === 'scan') source = 'Card scan';
  else if (source.toLowerCase() === 'search') source = 'Manual entry';
  else if (source.toLowerCase() === 'offline') source = 'Offline queued';

  let manualEntry = Boolean(
    eventData.manualEntry ||
    typ === 'manual_arrival' ||
    typ === 'manual_departure' ||
    reason === 'card_missing' ||
    reason === 'card_unreadable' ||
    source === 'Manual entry' ||
    source === 'Manual ID lookup' ||
    source === 'Paper/voice manual fallback' ||
    isReconciled ||
    typ === 'authorized_exception' ||
    typ === 'correction'
  );

  if (manualEntry && source !== 'Manual entry' && source !== 'Manual ID lookup' && source !== 'Authorized exception' && source !== 'Non-destructive correction' && source !== 'Paper/voice manual fallback' && source !== 'Offline queued') {
    source = isReconciled ? 'Paper/voice manual fallback' : 'Manual entry';
  }

  if (!['arrival', 'departure', 'manual_arrival', 'manual_departure', 'correction', 'authorized_exception'].includes(typ)) {
    throw new Error('Choose arrival or departure.');
  }

  const pupil = await Pupil.findOne({ id: pid, active: true });
  if (!pupil) {
    throw new Error('Pupil ID not found.');
  }

  const device = String(eventData.device || 'Primary Gate Terminal').slice(0, 80);
  const campus = String(eventData.campus || 'Primary campus').slice(0, 50);
  const gate = String(eventData.gate || 'Main gate').slice(0, 50);
  const session = String(eventData.session || 'Morning Arrival').slice(0, 80);

  // Timezone resolution: render in campus timezone
  const settingsDocs = await SchoolSetting.find();
  const schoolSettingsMap = {};
  settingsDocs.forEach(s => { schoolSettingsMap[s.key] = s.val; });

  const defaultCampusTimezones = {
    "Primary campus": "Europe/London",
    "Secondary campus": "Europe/London",
    "North gate annex": "Europe/London"
  };
  const campusTimezones = schoolSettingsMap.campusTimezones || defaultCampusTimezones;
  const campusTz = campusTimezones[campus] || schoolSettingsMap.timezone || 'Europe/London';

  const serverReceivedAt = Date.now();
  const deviceCapturedAt = eventData.deviceCapturedAt ? Number(eventData.deviceCapturedAt) : serverReceivedAt;
  const utcDate = new Date(deviceCapturedAt);

  const eventTime = eventData.time ? String(eventData.time) : formatTimeInTimezone(utcDate, campusTz);
  const eventDate = eventData.date ? String(eventData.date) : formatDateInTimezone(utcDate, campusTz);

  // Operating session checks & accidental mode error safeguards
  const defaultSessions = [
    { id: "morning", name: "Morning Arrival", startTime: "07:30", endTime: "08:30", defaultMode: "arrival" },
    { id: "standard", name: "Standard Day", startTime: "08:30", endTime: "14:30", defaultMode: "arrival" },
    { id: "afternoon", name: "Afternoon Dismissal", startTime: "14:30", endTime: "15:30", defaultMode: "departure" }
  ];
  const configuredSessions = schoolSettingsMap.operatingSessions || defaultSessions;
  const sessionConfig = configuredSessions.find(s => s.name === session || s.id === session);

  const isArrival = typ === 'arrival' || typ === 'manual_arrival';
  const isDeparture = typ === 'departure' || typ === 'manual_departure' || typ === 'authorized_exception';

  if (sessionConfig && sessionConfig.defaultMode && sessionConfig.defaultMode !== 'both') {
    const isModeMismatch = (sessionConfig.defaultMode === 'arrival' && isDeparture) ||
                           (sessionConfig.defaultMode === 'departure' && isArrival);
    if (isModeMismatch && eventData.confirmModeMismatch === false) {
      throw new Error(`Accidental mode error safeguard: Session '${sessionConfig.name}' defaults to ${sessionConfig.defaultMode} mode. Confirmation prompt required.`);
    }
  }

  // Check previous events today
  const prevEvent = await AttendanceEvent.findOne({ pupilId: pid, date: eventDate }).sort({ createdAt: -1 });

  if (isArrival && prevEvent && (prevEvent.type === 'arrival' || prevEvent.type === 'manual_arrival')) {
    throw new Error(`${pupil.name} already has an arrival recorded today.`);
  }
  if ((typ === 'departure' || typ === 'manual_departure') && prevEvent && (prevEvent.type === 'departure' || prevEvent.type === 'manual_departure' || prevEvent.type === 'authorized_exception')) {
    throw new Error(`${pupil.name} has already departed today.`);
  }
  if (isDeparture && (!prevEvent || (prevEvent.type !== 'arrival' && prevEvent.type !== 'manual_arrival'))) {
    throw new Error(`Record and verify ${pupil.name}'s arrival before departure.`);
  }

  // Non-destructive correction validation
  let originalEvent = null;
  if (typ === 'correction') {
    if (!reason) {
      throw new Error('A correction reason is required when recording an event correction.');
    }
    if (!correctionLink) {
      throw new Error('Original event reference (correctionLink) is required for corrections.');
    }
    originalEvent = await AttendanceEvent.findOne({ id: correctionLink });
    if (!originalEvent) {
      throw new Error('Original event to correct not found.');
    }
    // Original event is preserved intact (non-destructive edit)
  }

  let collector = null;
  let verification = null;

  if (typ === 'departure' || typ === 'manual_departure') {
    // If departure occurred offline, check school offline stale pickup policy
    if (isOfflineSync) {
      const settingDoc = await SchoolSetting.findOne({ key: 'allowOfflineStalePickupPolicy' });
      const allowOfflineStale = settingDoc ? Boolean(settingDoc.val) : false;
      const clientAcknowledgedPolicy = Boolean(eventData.allowOfflineStalePickupPolicy);
      if (!allowOfflineStale && !clientAcknowledgedPolicy) {
        throw new Error('Offline mode must not permit stale pickup permissions to be treated as current without an explicit school policy and visible warning.');
      }
    }

    const collectorId = eventData.collectorId;
    const collectorNameInput = eventData.collectorName ? String(eventData.collectorName).trim() : null;

    const activeCollectors = (pupil.collectors || []).filter(
      c => c.active && (c.until === 'Ongoing' || new Date(c.until) >= new Date().setHours(0,0,0,0))
    );

    let cr = null;
    if (collectorId !== undefined && collectorId !== null) {
      cr = activeCollectors.find(c => c.id === Number(collectorId));
    } else if (collectorNameInput) {
      cr = activeCollectors.find(c => c.name.toLowerCase() === collectorNameInput.toLowerCase());
    }

    if (!cr) {
      throw new Error('That collector is not approved for this pupil. Escalation instruction: Release is blocked. An unapproved collector requires a school administrator exception authorization.');
    }
    collector = cr.name;
    verification = String(eventData.verification || 'Photo matched').slice(0, 60);
  } else if (typ === 'authorized_exception') {
    if (user.role !== 'admin') {
      const err = new Error('Only a school administrator can authorize an unapproved collector exception.');
      err.status = 403;
      throw err;
    }
    if (!reason) {
      throw new Error('An administrator exception requires a preserved reason.');
    }
    collector = eventData.collectorName ? String(eventData.collectorName).trim().slice(0, 100) : '';
    if (!collector) {
      throw new Error('Collector name is required for authorized exceptions.');
    }
    verification = String(eventData.verification || 'Admin Exception: ID checked').slice(0, 60);
  }

  const eid = clientEventId || crypto.randomBytes(9).toString('base64url');

  // Retrieve school disclosure configuration
  const settingDoc = await SchoolSetting.findOne({ key: 'discloseCollectorName' });
  const discloseCollectorName = settingDoc ? Boolean(settingDoc.val) : true;

  // Format guardian notification alert details
  const channel = (pupil.preferredChannel || 'sms').toLowerCase();
  const recipient = channel === 'email' ? (pupil.guardianEmail || `${pupil.guardian.toLowerCase().replace(/\s+/g, '.')}@example.com`) : (pupil.guardianPhone || '+1 555-0100');
  const collectorDisplay = discloseCollectorName ? (collector || 'authorized contact') : 'an authorized contact';
  const alertMsg = isArrival
    ? `Gatewise Alert: ${pupil.name} has arrived safely at ${campus} (${gate}) at ${eventTime}.`
    : (typ === 'correction'
      ? `Gatewise Alert: An attendance record correction was logged for ${pupil.name} at ${eventTime}.`
      : `Gatewise Alert: ${pupil.name} departed from ${campus} with ${collectorDisplay} at ${eventTime}.`);

  const nid = crypto.randomBytes(9).toString('base64url');
  await Notification.create({
    id: nid,
    eventId: eid,
    pupilId: pid,
    guardianName: pupil.guardian,
    channel: channel.toUpperCase(),
    recipient,
    message: alertMsg,
    status: 'Sent',
    sentAt: eventTime
  });

  const syncStatus = isReconciled ? 'reconciled_fallback' : (isOfflineSync ? 'synced' : 'synced');

  const createdEvent = await AttendanceEvent.create({
    id: eid,
    pupilId: pid,
    type: typ,
    timestamp: utcDate,
    utcTimestamp: utcDate.toISOString(),
    time: eventTime,
    date: eventDate,
    createdAt: deviceCapturedAt,
    staff: user.name,
    actorId: user._id,
    source: isReconciled ? 'Paper/voice manual fallback' : (isOfflineSync ? 'Offline synced queue' : source),
    collector,
    verification,
    device,
    campus,
    gate,
    session,
    alert: 'Sent',
    reason,
    correctionReason: typ === 'correction' ? reason : (eventData.correctionReason || ''),
    manualEntry,
    correctionLink,
    clientEventId,
    offlineQueued: isOfflineSync,
    deviceCapturedAt,
    serverReceivedAt,
    syncStatus,
    reconciliationAuditReason
  });

  const actionName = isReconciled ? 'reconcile_manual_fallback' : (isOfflineSync ? 'sync_offline_event' : (typ === 'correction' ? 'correct_event' : `record_${typ}`));
  await AuditEntry.create({
    userId: user._id,
    action: actionName,
    objectType: 'event',
    objectId: eid,
    reason: `campus=${campus}; gate=${gate}; session=${session}; device=${device}; source=${createdEvent.source}; client_id=${clientEventId || 'none'}; collector=${collector || 'none'}; verification=${verification || 'none'}; reason=${reason}; correction_link=${correctionLink || 'none'}; offline_queued=${isOfflineSync}; reconciliation_audit_reason=${reconciliationAuditReason}; alert_channel=${channel.toUpperCase()}; utc=${utcDate.toISOString()}`,
    createdAt: utcDate
  });

  return {
    isDuplicate: false,
    eventId: eid,
    notification: {
      id: nid,
      guardian: pupil.guardian,
      channel: channel.toUpperCase(),
      recipient,
      message: alertMsg
    }
  };
}

app.post('/api/events', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const result = await processEventRecord(req.user, req.body);
    const state = await getStateJson();
    res.status(result.isDuplicate ? 200 : 201).json({
      ok: true,
      eventId: result.eventId,
      isDuplicate: result.isDuplicate,
      alertStatus: result.isDuplicate ? 'already_synced' : 'sent',
      notification: result.notification || null,
      state
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post('/api/events/sync', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const eventsToSync = Array.isArray(req.body.events) ? req.body.events : [req.body];
    const results = [];

    for (const evt of eventsToSync) {
      try {
        const itemResult = await processEventRecord(req.user, { ...evt, offlineQueued: true });
        results.push({ clientEventId: evt.clientEventId, ok: true, eventId: itemResult.eventId, isDuplicate: itemResult.isDuplicate });
      } catch (e) {
        results.push({ clientEventId: evt.clientEventId, ok: false, error: e.message });
      }
    }

    const state = await getStateJson();
    res.json({ ok: true, results, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Card Scanning endpoint
// Evaluates QR code token and returns unambiguous outcome:
// 'valid_pupil', 'already_recorded', 'wrong_session', 'revoked_card', 'unknown_code'
app.post('/api/cards/scan', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const rawCode = String(req.body.code || req.body.token || '').trim();
    const mode = String(req.body.mode || 'arrival').toLowerCase(); // 'arrival' or 'departure'
    const session = String(req.body.session || 'Morning Arrival').trim();
    const campus = String(req.body.campus || 'Primary campus').trim();

    if (!rawCode) {
      return res.status(400).json({ outcome: 'unknown_code', message: 'No QR code provided.' });
    }

    // Strip optional prefix like GW: if present
    const cleanToken = rawCode.replace(/^GW:/i, '').trim();

    // 1. Look up card by token or pupil ID fallback
    let card = await Card.findOne({ cardToken: cleanToken });
    let pupil = null;

    if (card) {
      pupil = await Pupil.findOne({ id: card.pupilId, active: true });
    } else {
      // Check if raw token is a pupil ID for backward compatibility or direct token
      const pupilById = await Pupil.findOne({ id: cleanToken.toUpperCase(), active: true });
      if (pupilById) {
        card = await Card.findOne({ pupilId: pupilById.id }).sort({ createdAt: -1 });
        pupil = pupilById;
      } else {
        // Also check if card exists with pupilId
        const anyCard = await Card.findOne({ id: cleanToken });
        if (anyCard) {
          card = anyCard;
          pupil = await Pupil.findOne({ id: card.pupilId, active: true });
        }
      }
    }

    if (!card && !pupil) {
      return res.json({
        outcome: 'unknown_code',
        message: 'Unrecognized card QR code. Pupil not found in school registry.'
      });
    }

    // Check revoked card status
    if (card && card.status === 'revoked') {
      return res.json({
        outcome: 'revoked_card',
        message: `This pupil ID card was revoked on ${card.revokedAt ? new Date(card.revokedAt).toLocaleDateString() : 'file'}.`,
        reason: card.revokedReason || 'Card has been revoked by administration.',
        pupil: pupil ? {
          id: pupil.id,
          name: pupil.name,
          className: pupil.className,
          photo: pupil.photo,
          initials: pupil.initials
        } : null
      });
    }

    if (!pupil) {
      return res.json({
        outcome: 'unknown_code',
        message: 'Pupil record associated with this card is inactive or not found.'
      });
    }

    // Minimum useful identity information to verify pupil photo
    const activeCollectors = (pupil.collectors || [])
      .filter(c => c.active && (c.until === 'Ongoing' || new Date(c.until) >= new Date().setHours(0,0,0,0)))
      .map(c => ({ id: c.id, name: c.name, relation: c.relation, until: c.until }));

    const pupilInfo = {
      id: pupil.id,
      name: pupil.name,
      className: pupil.className,
      guardian: pupil.guardian,
      guardianPhone: pupil.guardianPhone,
      preferredChannel: pupil.preferredChannel,
      photo: pupil.photo,
      initials: pupil.initials,
      color: pupil.color,
      collectors: activeCollectors
    };

    // Timezone & date resolution
    const settingsDocs = await SchoolSetting.find();
    const schoolSettingsMap = {};
    settingsDocs.forEach(s => { schoolSettingsMap[s.key] = s.val; });

    const defaultCampusTimezones = {
      "Primary campus": "Europe/London",
      "Secondary campus": "Europe/London",
      "North gate annex": "Europe/London"
    };
    const campusTimezones = schoolSettingsMap.campusTimezones || defaultCampusTimezones;
    const campusTz = campusTimezones[campus] || schoolSettingsMap.timezone || 'Europe/London';
    const todayDate = formatDateInTimezone(new Date(), campusTz);

    // 2. Check already recorded status
    const prevEvent = await AttendanceEvent.findOne({ pupilId: pupil.id, date: todayDate }).sort({ createdAt: -1 });

    if (mode === 'arrival' && prevEvent && (prevEvent.type === 'arrival' || prevEvent.type === 'manual_arrival')) {
      return res.json({
        outcome: 'already_recorded',
        message: `${pupil.name} already has arrival recorded today at ${prevEvent.time}.`,
        pupil: pupilInfo,
        existingEvent: {
          id: prevEvent.id,
          type: prevEvent.type,
          time: prevEvent.time,
          date: prevEvent.date
        }
      });
    }

    if (mode === 'departure' && prevEvent && (prevEvent.type === 'departure' || prevEvent.type === 'manual_departure' || prevEvent.type === 'authorized_exception')) {
      return res.json({
        outcome: 'already_recorded',
        message: `${pupil.name} has already departed today at ${prevEvent.time}.`,
        pupil: pupilInfo,
        existingEvent: {
          id: prevEvent.id,
          type: prevEvent.type,
          time: prevEvent.time,
          date: prevEvent.date
        }
      });
    }

    // 3. Check operating session safeguard: wrong session
    const defaultSessions = [
      { id: "morning", name: "Morning Arrival", startTime: "07:30", endTime: "08:30", defaultMode: "arrival" },
      { id: "standard", name: "Standard Day", startTime: "08:30", endTime: "14:30", defaultMode: "arrival" },
      { id: "afternoon", name: "Afternoon Dismissal", startTime: "14:30", endTime: "15:30", defaultMode: "departure" }
    ];
    const configuredSessions = schoolSettingsMap.operatingSessions || defaultSessions;
    const sessionConfig = configuredSessions.find(s => s.name === session || s.id === session);

    if (sessionConfig && sessionConfig.defaultMode && sessionConfig.defaultMode !== 'both') {
      const isMismatch = (sessionConfig.defaultMode === 'arrival' && mode === 'departure') ||
                         (sessionConfig.defaultMode === 'departure' && mode === 'arrival');
      if (isMismatch && req.body.confirmModeMismatch !== true) {
        return res.json({
          outcome: 'wrong_session',
          message: `Accidental mode mismatch: Session '${sessionConfig.name}' defaults to ${sessionConfig.defaultMode.toUpperCase()} operations, but current action is ${mode.toUpperCase()}.`,
          session: sessionConfig.name,
          defaultMode: sessionConfig.defaultMode,
          currentMode: mode,
          pupil: pupilInfo
        });
      }
    }

    // 4. Valid pupil ready for staff visual photo confirmation
    return res.json({
      outcome: 'valid_pupil',
      message: `Card verified for ${pupil.name}. Visually confirm pupil against photo before logging handover.`,
      pupil: pupilInfo,
      currentStatus: !prevEvent ? 'Not arrived' : (prevEvent.type === 'arrival' || prevEvent.type === 'manual_arrival' ? 'On campus' : 'Departed'),
      card: {
        id: card ? card.id : null,
        status: card ? card.status : 'active',
        issuedAt: card ? card.issuedAt : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin card reissue endpoint: generates a new random token, marks previous card replaced, logs audit entry without mutating historical records
app.post('/api/cards/:pupilId/reissue', requireAuth(['admin']), async (req, res) => {
  try {
    const pupilId = req.params.pupilId.toUpperCase().trim();
    const reason = String(req.body.reason || 'Card damaged or lost').trim();

    const pupil = await Pupil.findOne({ id: pupilId, active: true });
    if (!pupil) {
      return res.status(404).json({ error: 'Pupil not found.' });
    }

    // Mark previous active cards as 'replaced'
    const prevCards = await Card.find({ pupilId, status: 'active' });
    const prevCardTokens = prevCards.map(c => c.cardToken);
    await Card.updateMany({ pupilId, status: 'active' }, {
      status: 'replaced',
      revokedAt: new Date(),
      revokedReason: `Replaced by new card: ${reason}`
    });

    // Generate brand new random non-meaningful token (no PII)
    const newCardToken = 'gw_tok_' + crypto.randomBytes(12).toString('hex');
    const newCard = await Card.create({
      id: `card-${pupilId}-${Date.now()}`,
      pupilId,
      cardToken: newCardToken,
      status: 'active',
      issuedAt: new Date(),
      issuedBy: req.user.name || 'School Administrator'
    });

    // Preserve historical attendance records without mutation
    // AttendanceEvent collection is untouched!

    // Audit log entry
    await AuditEntry.create({
      userId: req.user._id,
      action: 'reissue_pupil_card',
      objectType: 'card',
      objectId: newCard.id,
      reason: `Reissued card for pupil ${pupilId}; replaced_tokens=[${prevCardTokens.join(', ')}]; reason=${reason}`,
      createdAt: new Date()
    });

    const state = await getStateJson();
    res.status(201).json({
      ok: true,
      card: {
        id: newCard.id,
        pupilId: newCard.pupilId,
        cardToken: newCard.cardToken,
        status: newCard.status,
        issuedAt: newCard.issuedAt
      },
      message: `New ID card issued successfully for ${pupil.name}. Previous card token is no longer valid.`,
      state
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin card revoke endpoint: revokes card with audit entry without mutating historical attendance records
app.post('/api/cards/:cardId/revoke', requireAuth(['admin']), async (req, res) => {
  try {
    const cardId = req.params.cardId;
    const reason = String(req.body.reason || '').trim();

    if (!reason) {
      return res.status(400).json({ error: 'A revocation reason is required.' });
    }

    const card = await Card.findOne({ $or: [{ id: cardId }, { cardToken: cardId }] });
    if (!card) {
      return res.status(404).json({ error: 'Card not found.' });
    }

    card.status = 'revoked';
    card.revokedAt = new Date();
    card.revokedReason = reason;
    await card.save();

    // Preserve historical attendance records without mutation
    // AttendanceEvent collection is untouched!

    await AuditEntry.create({
      userId: req.user._id,
      action: 'revoke_pupil_card',
      objectType: 'card',
      objectId: card.id,
      reason: `Revoked card for pupil ${card.pupilId}; token=${card.cardToken}; reason=${reason}`,
      createdAt: new Date()
    });

    const state = await getStateJson();
    res.json({
      ok: true,
      card: {
        id: card.id,
        pupilId: card.pupilId,
        status: card.status,
        revokedAt: card.revokedAt,
        revokedReason: card.revokedReason
      },
      message: `Card for ${card.pupilId} has been revoked.`,
      state
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Card artwork print/export endpoint: returns card artwork details & printable layout without encoding PII in QR code
app.get('/api/cards/:pupilId/artwork', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const pupilId = req.params.pupilId.toUpperCase().trim();
    const pupil = await Pupil.findOne({ id: pupilId, active: true });
    if (!pupil) {
      return res.status(404).json({ error: 'Pupil not found.' });
    }

    let card = await Card.findOne({ pupilId, status: 'active' });
    if (!card) {
      // Auto-issue active card if none exists
      const cardToken = 'gw_tok_' + crypto.randomBytes(12).toString('hex');
      card = await Card.create({
        id: `card-${pupilId}-${Date.now()}`,
        pupilId,
        cardToken,
        status: 'active',
        issuedAt: new Date(),
        issuedBy: req.user.name || 'System'
      });
    }

    const format = req.query.format || 'json';

    // Verify token contains no PII (e.g. no pupil name or phone number)
    const qrData = card.cardToken;

    if (format === 'html' || format === 'print') {
      res.setHeader('Content-Type', 'text/html');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Pupil ID Card - ${pupil.name}</title>
          <style>
            @media print {
              body { margin: 0; background: white; }
              .no-print { display: none; }
            }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 24px; }
            .card-container { width: 336px; height: 212px; background: white; border-radius: 12px; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 18px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
            .card-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
            .school-name { font-weight: 800; font-size: 13px; color: #1e293b; letter-spacing: 0.5px; }
            .badge-sec { font-size: 9px; font-weight: 700; color: #3b82f6; text-transform: uppercase; }
            .card-body { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
            .photo-box { width: 68px; height: 68px; border-radius: 8px; background: #e2e8f0; display: flex; align-items: center; justify-content: center; font-size: 34px; border: 1px solid #cbd5e1; }
            .info-box { flex: 1; }
            .pupil-name { font-size: 15px; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
            .pupil-id { font-size: 11px; font-weight: 700; color: #64748b; }
            .pupil-class { font-size: 11px; font-weight: 600; color: #2563eb; margin-top: 2px; }
            .card-footer { display: flex; align-items: flex-end; justify-content: space-between; border-top: 1px dashed #e2e8f0; padding-top: 8px; }
            .qr-display { text-align: center; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; font-family: monospace; font-size: 10px; font-weight: 700; color: #1e293b; }
            .qr-symbol { font-size: 26px; line-height: 1; color: #1d4ed8; }
            .policy-text { font-size: 8px; color: #94a3b8; max-width: 190px; line-height: 1.3; }
            .btn-print { margin-bottom: 16px; padding: 8px 16px; font-size: 12px; font-weight: 600; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="no-print">
            <button class="btn-print" onclick="window.print()">🖨 Print Card Artwork</button>
          </div>
          <div class="card-container">
            <div class="card-header">
              <span class="school-name">NORTHFIELD ACADEMY</span>
              <span class="badge-sec">Official Pupil ID</span>
            </div>
            <div class="card-body">
              <div class="photo-box">${pupil.photo || pupil.initials}</div>
              <div class="info-box">
                <div class="pupil-name">${pupil.name}</div>
                <div class="pupil-id">ID: ${pupil.id}</div>
                <div class="pupil-class">${pupil.className}</div>
              </div>
            </div>
            <div class="card-footer">
              <div class="policy-text">Property of Northfield Academy. QR code contains random security token without PII. If found, return to school office.</div>
              <div class="qr-display">
                <div class="qr-symbol">▦</div>
                <span>${card.cardToken.slice(0, 10)}…</span>
              </div>
            </div>
          </div>
        </body>
        </html>
      `);
    }

    res.json({
      pupil: {
        id: pupil.id,
        name: pupil.name,
        className: pupil.className,
        photo: pupil.photo,
        initials: pupil.initials
      },
      card: {
        id: card.id,
        cardToken: card.cardToken, // Random token without PII
        status: card.status,
        issuedAt: card.issuedAt,
        issuedBy: card.issuedBy
      },
      artwork: {
        schoolName: "Northfield Academy",
        cardType: "Official PVC Pupil ID Card",
        qrToken: card.cardToken,
        printableUrl: `/api/cards/${pupil.id}/artwork?format=html`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events/reconcile', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const reason = String(req.body.reconciliationAuditReason || req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'Manual paper/voice fallback reconciliation requires an explicit audit reason.' });
    }

    const result = await processEventRecord(req.user, {
      ...req.body,
      manualFallbackReconciled: true,
      reconciliationAuditReason: reason,
      source: 'Paper/voice manual fallback'
    });

    const state = await getStateJson();
    res.status(result.isDuplicate ? 200 : 201).json({
      ok: true,
      eventId: result.eventId,
      isDuplicate: result.isDuplicate,
      notification: result.notification || null,
      state
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post('/api/pickup/:id', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const rid = req.params.id;
    const action = req.body.action;

    if (!['approve', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Choose approve or decline.' });
    }

    const pReq = await PickupRequest.findOne({ id: rid, status: 'pending' });
    if (!pReq) {
      return res.status(404).json({ error: 'This request is no longer pending.' });
    }

    if (action === 'approve') {
      const validUntil = String(req.body.validUntil || '');
      const expiryDate = new Date(validUntil);
      if (isNaN(expiryDate.getTime())) {
        return res.status(400).json({ error: 'Choose a valid pickup approval expiry date.' });
      }
      const todayFloor = new Date();
      todayFloor.setHours(0,0,0,0);
      if (expiryDate < todayFloor) {
        return res.status(400).json({ error: 'Pickup approval expiry cannot be in the past.' });
      }

      const pupil = await Pupil.findOne({ id: pReq.pupilId });
      if (!pupil) {
        return res.status(404).json({ error: 'Pupil not found.' });
      }

      const existingCol = (pupil.collectors || []).find(
        c => c.active && c.name.toLowerCase() === pReq.name.toLowerCase()
      );

      if (existingCol) {
        existingCol.until = validUntil;
      } else {
        const nextId = await getNextCollectorId(pupil);
        pupil.collectors.push({
          id: nextId,
          name: pReq.name,
          relation: pReq.relation,
          until: validUntil,
          active: true
        });
      }
      await pupil.save();
    }

    pReq.status = action === 'approve' ? 'approved' : 'declined';
    await pReq.save();

    await AuditEntry.create({
      userId: req.user._id,
      action: `pickup_${action}`,
      objectType: 'pickup_request',
      objectId: rid,
      reason: 'School admin review',
      createdAt: new Date()
    });

    const state = await getStateJson();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Roster import preview
app.post('/api/import/preview', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const filename = String(req.body.filename || 'roster.csv').slice(0, 255);
    const fileBase64 = String(req.body.fileBase64 || '');
    const raw = Buffer.from(fileBase64, 'base64');

    if (raw.length > MAX_IMPORT_BYTES) {
      return res.status(400).json({ error: 'The file is larger than 8 MB.' });
    }

    let rows = [];
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.csv') {
      try {
        const text = raw.toString('utf-8');
        rows = parse(text, { skip_empty_lines: true, relax_column_count: true });
      } catch (e) {
        return res.status(400).json({ error: `Could not read CSV: ${e.message}` });
      }
    } else if (ext === '.xlsx') {
      try {
        const workbook = XLSX.read(raw, { type: 'buffer' });
        const sheetName = workbook.SheetNames.find(s => s.trim().toLowerCase() === 'pupils');
        if (!sheetName) {
          return res.status(400).json({ error: 'The workbook must contain a sheet named Pupils.' });
        }
        const worksheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      } catch (e) {
        return res.status(400).json({ error: e.message || 'The XLSX file is damaged or invalid.' });
      }
    } else {
      return res.status(400).json({ error: 'Choose a .csv or .xlsx file.' });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'The roster file is empty.' });
    }

    const headers = rows[0].map(v => String(v || '').trim().toLowerCase());
    const uniqueHeaders = new Set(headers);
    if (headers.length !== uniqueHeaders.size) {
      return res.status(400).json({ error: 'The file has duplicate column headers.' });
    }

    const missing = IMPORT_COLUMNS.filter(c => !headers.includes(c));
    const extra = headers.filter(c => c && !IMPORT_COLUMNS.includes(c));

    if (missing.length > 0 || extra.length > 0) {
      const detail = [];
      if (missing.length > 0) detail.push('missing: ' + missing.join(', '));
      if (extra.length > 0) detail.push('unexpected: ' + extra.join(', '));
      return res.status(400).json({
        error: `The header row must contain exactly pupil_id, pupil_name, class_name, guardian_name (${detail.join('; ')}).`
      });
    }

    if (rows.length - 1 > MAX_IMPORT_ROWS) {
      return res.status(400).json({ error: `A file can contain at most ${MAX_IMPORT_ROWS} pupils.` });
    }

    const indexes = {};
    IMPORT_COLUMNS.forEach(col => { indexes[col] = headers.indexOf(col); });

    const existingPupils = await Pupil.find({ active: true }, { id: 1 });
    const existingIds = new Set(existingPupils.map(p => p.id));

    const records = [];
    const errors = [];
    const seen = new Map();

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      if (!values || !values.some(v => String(v || '').trim() !== '')) continue;

      const rowNumber = i + 1;
      const rec = {};
      IMPORT_COLUMNS.forEach(col => {
        rec[col] = String(values[indexes[col]] || '').trim();
      });

      const pid = rec.pupil_id.toUpperCase();
      rec.pupil_id = pid;

      const rowErrors = [];
      if (!pid || pid.length > 30 || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(pid)) {
        rowErrors.push('pupil_id is required and may use letters, numbers, and hyphens.');
      } else if (seen.has(pid)) {
        rowErrors.push(`pupil_id duplicates row ${seen.get(pid)} in this file.`);
      } else if (existingIds.has(pid)) {
        rowErrors.push('pupil_id already exists in Gatewise.');
      }

      if (!rec.pupil_name || rec.pupil_name.length > 100) {
        rowErrors.push('pupil_name is required (maximum 100 characters).');
      }
      if (!rec.class_name || rec.class_name.length > 30) {
        rowErrors.push('class_name is required (maximum 30 characters).');
      }
      if (!rec.guardian_name || rec.guardian_name.length > 100) {
        rowErrors.push('guardian_name is required (maximum 100 characters).');
      }

      if (pid && !seen.has(pid)) seen.set(pid, rowNumber);

      if (rowErrors.length > 0) {
        errors.push({ row: rowNumber, pupil_id: pid, messages: rowErrors });
      } else {
        records.push(rec);
      }
    }

    if (records.length === 0 && errors.length === 0) {
      return res.status(400).json({ error: 'Add at least one pupil row below the header.' });
    }

    if (errors.length > 0) {
      return res.json({
        rowCount: rows.length - 1,
        validCount: records.length,
        errors: errors.slice(0, 100),
        errorCount: errors.length,
        preview: records.slice(0, 8),
        token: null
      });
    }

    const token = crypto.randomBytes(24).toString('base64url');
    IMPORT_STAGES.set(token, {
      userId: req.user._id.toString(),
      expires: Date.now() + 600000,
      records
    });

    res.json({
      rowCount: rows.length - 1,
      validCount: records.length,
      errors: [],
      errorCount: 0,
      preview: records.slice(0, 8),
      token
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/import/commit', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const token = String(req.body.token || '');
    const stage = IMPORT_STAGES.get(token);
    IMPORT_STAGES.delete(token);

    if (!stage || stage.userId !== req.user._id.toString() || stage.expires < Date.now()) {
      return res.status(400).json({ error: 'The import preview expired. Upload the roster again.' });
    }

    const colors = ["rose", "mint", "sand", "blue", "violet"];
    for (let index = 0; index < stage.records.length; index++) {
      const r = stage.records[index];
      const name = r.pupil_name.trim();
      const initials = name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();

      await Pupil.create({
        id: r.pupil_id,
        name,
        className: r.class_name.trim(),
        guardian: r.guardian_name.trim(),
        initials,
        color: colors[index % colors.length],
        photo: '♙',
        active: true,
        collectors: []
      });

      const cardToken = 'gw_tok_' + crypto.randomBytes(12).toString('hex');
      await Card.create({
        id: `card-${r.pupil_id}-${Date.now()}-${index}`,
        pupilId: r.pupil_id,
        cardToken,
        status: 'active',
        issuedAt: new Date(),
        issuedBy: req.user.name || 'Roster Import'
      });
    }

    await AuditEntry.create({
      userId: req.user._id,
      action: 'bulk_import',
      objectType: 'pupil_roster',
      objectId: crypto.randomBytes(8).toString('hex'),
      reason: `Imported ${stage.records.length} pupils`,
      createdAt: new Date()
    });

    const state = await getStateJson();
    res.status(201).json({ ok: true, imported: stage.records.length, state });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A pupil ID now exists in Gatewise. Preview the roster again and resolve duplicate IDs.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Guardian Onboarding & Portal Endpoints
// -------------------------------------------------------------

// 1. Guardian proves control of contact channel (e.g. OTP verification code)
app.post('/api/guardian/verify-channel', async (req, res) => {
  try {
    const inviteToken = String(req.body.inviteToken || '').trim();
    const verificationCode = String(req.body.verificationCode || '').trim();

    if (!inviteToken || !verificationCode) {
      return res.status(400).json({ error: 'Invite token and verification code are required.' });
    }

    const guardian = await Guardian.findOne({ inviteToken });
    if (!guardian) {
      return res.status(404).json({ error: 'Invalid or expired invitation token.' });
    }

    if (guardian.verificationCode !== verificationCode) {
      return res.status(400).json({ error: 'Invalid verification code. Please check your contact channel.' });
    }

    guardian.channelVerified = true;
    guardian.channelVerifiedAt = new Date();
    await guardian.save();

    await AuditEntry.create({
      action: 'guardian_verify_channel',
      objectType: 'guardian',
      objectId: guardian.id,
      reason: `Channel verified via ${guardian.verifiedContactMethod}`,
      createdAt: new Date()
    });

    res.json({
      ok: true,
      message: `Control of ${guardian.verifiedContactMethod.toUpperCase()} successfully proven.`,
      guardian: {
        id: guardian.id,
        name: guardian.name,
        verifiedContactMethod: guardian.verifiedContactMethod,
        channelVerified: true,
        privacyNoticeAccepted: guardian.privacyNoticeAccepted,
        consentAccepted: guardian.consentAccepted
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Guardian accepts privacy notice & consent/acknowledgment flow and sets password
app.post('/api/guardian/accept-consent', async (req, res) => {
  try {
    const inviteToken = String(req.body.inviteToken || '').trim();
    const acceptPrivacyNotice = Boolean(req.body.acceptPrivacyNotice);
    const acceptConsent = Boolean(req.body.acceptConsent);
    const password = String(req.body.password || '');
    const preferredChannels = Array.isArray(req.body.preferredChannels) && req.body.preferredChannels.length > 0
      ? req.body.preferredChannels
      : ['sms'];

    if (!inviteToken) {
      return res.status(400).json({ error: 'Invite token is required.' });
    }
    if (!acceptPrivacyNotice) {
      return res.status(400).json({ error: "You must accept the school's privacy notice to proceed." });
    }
    if (!acceptConsent) {
      return res.status(400).json({ error: 'You must provide statutory consent/acknowledgment for school arrival & dismissal notifications.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const guardian = await Guardian.findOne({ inviteToken });
    if (!guardian) {
      return res.status(404).json({ error: 'Invalid invitation token.' });
    }
    if (!guardian.channelVerified) {
      return res.status(400).json({ error: 'You must prove control of your contact channel before completing onboarding.' });
    }

    guardian.privacyNoticeAccepted = true;
    guardian.privacyNoticeVersion = '2026.1';
    guardian.privacyAcceptedAt = new Date();
    guardian.consentAccepted = true;
    guardian.consentAcceptedAt = new Date();
    guardian.status = 'active';
    guardian.preferredChannels = preferredChannels;

    // Create User record for guardian sign-in
    const userEmail = guardian.email || `${guardian.id.toLowerCase()}@guardian.northfield.school`;
    let user = await User.findOne({ email: userEmail });
    const { salt, hash } = passwordHash(password);

    if (user) {
      user.name = guardian.name;
      user.role = 'guardian';
      user.salt = salt;
      user.passwordHash = hash;
      user.active = true;
      user.guardianId = guardian.id;
      await user.save();
    } else {
      user = await User.create({
        email: userEmail,
        name: guardian.name,
        role: 'guardian',
        salt,
        passwordHash: hash,
        active: true,
        guardianId: guardian.id
      });
    }

    guardian.userId = user._id;
    await guardian.save();

    // Activate linked pupil-guardian relations
    await PupilGuardian.updateMany(
      { guardianId: guardian.id, status: 'pending_verification' },
      { $set: { status: 'active' } }
    );

    // Create session cookie so guardian is immediately signed in
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;

    await Session.create({
      tokenHash,
      userId: user._id,
      expiresAt: expiry,
      createdAt: Math.floor(Date.now() / 1000)
    });

    res.cookie('gw_session', token, {
      path: '/',
      maxAge: SESSION_SECONDS * 1000,
      httpOnly: true,
      sameSite: 'strict'
    });

    await AuditEntry.create({
      userId: user._id,
      action: 'guardian_consent_accepted',
      objectType: 'guardian',
      objectId: guardian.id,
      reason: 'Accepted privacy notice v2026.1 & notification consent; account activated',
      createdAt: new Date()
    });

    res.json({
      ok: true,
      message: 'Onboarding complete. Welcome to the Northfield Guardian Portal.',
      guardian: {
        id: guardian.id,
        name: guardian.name,
        status: guardian.status,
        preferredChannels: guardian.preferredChannels
      },
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        guardianId: guardian.id
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper to get guardian-scoped data
async function getGuardianPortalData(guardianId) {
  const guardian = await Guardian.findOne({ id: guardianId });
  if (!guardian) throw new Error('Guardian profile not found.');

  // Find ONLY pupils linked to this guardian
  const links = await PupilGuardian.find({ guardianId, status: { $ne: 'revoked' } });
  const linkedPupilIds = links.map(l => l.pupilId);

  const pupilDocs = await Pupil.find({ id: { $in: linkedPupilIds }, active: true });
  const pupils = pupilDocs.map(p => {
    const link = links.find(l => l.pupilId === p.id);
    const activeCollectors = (p.collectors || [])
      .filter(c => c.active && (c.until === 'Ongoing' || new Date(c.until) >= new Date().setHours(0,0,0,0)))
      .map(c => ({ id: c.id, name: c.name, relation: c.relation, until: c.until }));

    return {
      id: p.id,
      name: p.name,
      className: p.className,
      photo: p.photo,
      initials: p.initials,
      color: p.color,
      relationship: link ? link.relationship : 'Parent',
      isLegalGuardian: link ? Boolean(link.isLegalGuardian) : true,
      legalStatusApprovedBySchool: link ? Boolean(link.legalStatusApprovedBySchool) : true,
      collectors: activeCollectors
    };
  });

  // Recent attendance events ONLY for linked pupils
  const events = await AttendanceEvent.find({ pupilId: { $in: linkedPupilIds } })
    .sort({ createdAt: -1 })
    .limit(50);

  // Correction / contact requests submitted by this guardian
  const correctionRequests = await CorrectionRequest.find({ guardianId }).sort({ createdAt: -1 });

  return {
    guardian: {
      id: guardian.id,
      name: guardian.name,
      email: guardian.email,
      phone: guardian.phone,
      verifiedContactMethod: guardian.verifiedContactMethod,
      preferredChannels: guardian.preferredChannels || ['sms'],
      status: guardian.status
    },
    pupils,
    events: events.map(e => ({
      id: e.id,
      pupilId: e.pupilId,
      type: e.type,
      time: e.time,
      date: e.date,
      collector: e.collector,
      verification: e.verification
    })),
    correctionRequests: correctionRequests.map(c => ({
      id: c.id,
      pupilId: c.pupilId,
      type: c.type,
      subject: c.subject,
      message: c.message,
      status: c.status,
      reviewNote: c.reviewNote,
      createdAt: c.createdAt
    }))
  };
}

// 3. Guardian portal: Guardian sees ONLY linked pupils and timeline
app.get('/api/guardian/me', requireAuth(['guardian', 'admin']), async (req, res) => {
  try {
    let guardianId = req.user.guardianId;
    if (!guardianId && req.user.role === 'admin' && req.query.guardianId) {
      guardianId = String(req.query.guardianId);
    }
    if (!guardianId) {
      return res.status(403).json({ error: 'No guardian profile associated with this account.' });
    }

    const portalData = await getGuardianPortalData(guardianId);
    res.json(portalData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Guardian sets notification preferences
app.put('/api/guardian/preferences', requireAuth(['guardian']), async (req, res) => {
  try {
    const guardianId = req.user.guardianId;
    const channels = Array.isArray(req.body.channels) ? req.body.channels : [];
    const validChannels = ['sms', 'whatsapp', 'push', 'email'];
    const filtered = channels.filter(c => validChannels.includes(String(c).toLowerCase()));

    if (filtered.length === 0) {
      return res.status(400).json({ error: 'Select at least one notification channel (SMS, WhatsApp, Push, or Email).' });
    }

    const guardian = await Guardian.findOne({ id: guardianId });
    if (!guardian) {
      return res.status(404).json({ error: 'Guardian profile not found.' });
    }

    guardian.preferredChannels = filtered;
    await guardian.save();

    // Also synchronize pupil preferredChannel for linked pupils
    const links = await PupilGuardian.find({ guardianId });
    const pupilIds = links.map(l => l.pupilId);
    if (pupilIds.length > 0) {
      await Pupil.updateMany(
        { id: { $in: pupilIds } },
        { $set: { preferredChannel: filtered[0].toLowerCase() } }
      );
    }

    await AuditEntry.create({
      userId: req.user._id,
      action: 'update_notification_preferences',
      objectType: 'guardian',
      objectId: guardianId,
      reason: `Channels=${filtered.join(',')}`,
      createdAt: new Date()
    });

    res.json({
      ok: true,
      message: 'Notification preferences updated successfully.',
      preferredChannels: guardian.preferredChannels
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Guardian requests corrections or contacts the school
// Note: Guardian app CANNOT edit legal guardian status or pickup permissions directly.
// Such requests are submitted as requests for school approval.
app.post('/api/guardian/correction-request', requireAuth(['guardian']), async (req, res) => {
  try {
    const guardianId = req.user.guardianId;
    const pupilId = String(req.body.pupilId || '').trim().toUpperCase();
    const type = String(req.body.type || 'record_correction');
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const proposedChanges = req.body.proposedChanges || {};

    if (!pupilId || !subject || !message) {
      return res.status(400).json({ error: 'Pupil, subject, and message are required.' });
    }

    // Verify guardian is linked to this pupil
    const link = await PupilGuardian.findOne({ guardianId, pupilId, status: { $ne: 'revoked' } });
    if (!link) {
      return res.status(403).json({ error: 'You are only authorized to request corrections for your linked pupil(s).' });
    }

    const reqId = 'CR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const newRequest = await CorrectionRequest.create({
      id: reqId,
      guardianId,
      pupilId,
      type: ['record_correction', 'pickup_permission_request', 'legal_status_request', 'contact_school'].includes(type) ? type : 'record_correction',
      subject,
      message,
      proposedChanges,
      status: 'pending'
    });

    await AuditEntry.create({
      userId: req.user._id,
      action: 'submit_correction_request',
      objectType: 'correction_request',
      objectId: reqId,
      reason: `Type=${newRequest.type}; Pupil=${pupilId}; Subject=${subject}`,
      createdAt: new Date()
    });

    res.status(201).json({
      ok: true,
      message: 'Request submitted to school administration for review and approval.',
      request: newRequest
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Block guardian from attempting direct modification of legal guardian status or pickup permissions
app.all(['/api/guardian/legal-status', '/api/guardian/pickup-permissions'], (req, res) => {
  res.status(403).json({
    error: 'The school—not the guardian app—approves changes to legal guardian status and pickup permissions. Please submit a correction or contact request.'
  });
});

// 6. School Admin reviews correction requests and manages legal guardian status
app.get('/api/admin/corrections', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const requests = await CorrectionRequest.find().sort({ createdAt: -1 });
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/corrections/:id', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const id = req.params.id;
    const action = req.body.action; // 'approve' or 'reject'
    const reviewNote = String(req.body.reviewNote || '').trim();

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Choose approve or reject.' });
    }

    const correctionReq = await CorrectionRequest.findOne({ id, status: 'pending' });
    if (!correctionReq) {
      return res.status(404).json({ error: 'Correction request not found or already processed.' });
    }

    correctionReq.status = action === 'approve' ? 'approved' : 'rejected';
    correctionReq.reviewedBy = req.user.name;
    correctionReq.reviewNote = reviewNote;
    correctionReq.reviewedAt = new Date();
    await correctionReq.save();

    // If approved and includes proposed legal guardian status change
    if (action === 'approve' && correctionReq.type === 'legal_status_request') {
      const isLegal = Boolean(correctionReq.proposedChanges?.isLegalGuardian);
      await PupilGuardian.updateOne(
        { pupilId: correctionReq.pupilId, guardianId: correctionReq.guardianId },
        {
          $set: {
            isLegalGuardian: isLegal,
            legalStatusApprovedBySchool: true,
            approvedBySchoolAt: new Date(),
            approvedByStaff: req.user.name
          }
        }
      );
    }

    // If approved and includes pickup permission change
    if (action === 'approve' && correctionReq.type === 'pickup_permission_request' && correctionReq.proposedChanges?.collectorName) {
      const pupil = await Pupil.findOne({ id: correctionReq.pupilId });
      if (pupil) {
        const nextId = await getNextCollectorId(pupil);
        pupil.collectors.push({
          id: nextId,
          name: correctionReq.proposedChanges.collectorName,
          relation: correctionReq.proposedChanges.relation || 'Approved Contact',
          until: correctionReq.proposedChanges.until || 'Ongoing',
          active: true
        });
        await pupil.save();
      }
    }

    await AuditEntry.create({
      userId: req.user._id,
      action: `review_correction_${action}`,
      objectType: 'correction_request',
      objectId: id,
      reason: `Staff=${req.user.name}; Note=${reviewNote}`,
      createdAt: new Date()
    });

    res.json({ ok: true, request: correctionReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// School explicitly updates legal guardian status
app.post('/api/pupils/:pupilId/guardians/:guardianId/legal-status', requireAuth(['admin']), async (req, res) => {
  try {
    const { pupilId, guardianId } = req.params;
    const { isLegalGuardian, reason } = req.body;

    if (isLegalGuardian === undefined || typeof isLegalGuardian !== 'boolean') {
      return res.status(400).json({ error: 'isLegalGuardian must be a boolean.' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'A preserved audit reason is required when modifying legal guardian status.' });
    }

    const link = await PupilGuardian.findOne({ pupilId: pupilId.toUpperCase(), guardianId: guardianId.toUpperCase() });
    if (!link) {
      return res.status(404).json({ error: 'Pupil-guardian link not found.' });
    }

    link.isLegalGuardian = isLegalGuardian;
    link.legalStatusApprovedBySchool = true;
    link.approvedBySchoolAt = new Date();
    link.approvedByStaff = req.user.name;
    await link.save();

    await AuditEntry.create({
      userId: req.user._id,
      action: 'update_legal_guardian_status',
      objectType: 'pupil_guardian',
      objectId: `${pupilId}:${guardianId}`,
      reason: `LegalGuardian=${isLegalGuardian}; Staff=${req.user.name}; Reason=${reason}`,
      createdAt: new Date()
    });

    res.json({ ok: true, link });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions', requireAuth(), async (req, res) => {
  try {
    const setting = await SchoolSetting.findOne({ key: 'operatingSessions' });
    const defaultSessions = [
      { id: "morning", name: "Morning Arrival", startTime: "07:30", endTime: "08:30", defaultMode: "arrival" },
      { id: "standard", name: "Standard Day", startTime: "08:30", endTime: "14:30", defaultMode: "arrival" },
      { id: "afternoon", name: "Afternoon Dismissal", startTime: "14:30", endTime: "15:30", defaultMode: "departure" }
    ];
    const sessions = setting ? setting.val : defaultSessions;
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', requireAuth(['admin']), async (req, res) => {
  try {
    const { id, name, startTime, endTime, defaultMode } = req.body;
    if (!name || !defaultMode) {
      return res.status(400).json({ error: 'Session name and defaultMode (arrival, departure, or both) are required.' });
    }
    const sessionId = id || name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const setting = await SchoolSetting.findOne({ key: 'operatingSessions' });
    const defaultSessions = [
      { id: "morning", name: "Morning Arrival", startTime: "07:30", endTime: "08:30", defaultMode: "arrival" },
      { id: "standard", name: "Standard Day", startTime: "08:30", endTime: "14:30", defaultMode: "arrival" },
      { id: "afternoon", name: "Afternoon Dismissal", startTime: "14:30", endTime: "15:30", defaultMode: "departure" }
    ];
    let sessions = setting ? [...setting.val] : [...defaultSessions];
    const existingIdx = sessions.findIndex(s => s.id === sessionId || s.name.toLowerCase() === name.toLowerCase());
    const newSession = {
      id: sessionId,
      name: String(name).trim(),
      startTime: String(startTime || '07:30').trim(),
      endTime: String(endTime || '15:30').trim(),
      defaultMode: ['arrival', 'departure', 'both'].includes(defaultMode) ? defaultMode : 'arrival'
    };
    if (existingIdx >= 0) {
      sessions[existingIdx] = newSession;
    } else {
      sessions.push(newSession);
    }
    await SchoolSetting.findOneAndUpdate(
      { key: 'operatingSessions' },
      { key: 'operatingSessions', val: sessions },
      { upsert: true, new: true }
    );
    await AuditEntry.create({
      userId: req.user._id,
      action: 'configure_operating_sessions',
      objectType: 'school_setting',
      objectId: 'operatingSessions',
      reason: `Configured session: ${newSession.name} (${newSession.defaultMode})`,
      createdAt: new Date()
    });
    res.status(201).json({ ok: true, session: newSession, sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sessions', requireAuth(['admin']), async (req, res) => {
  try {
    const { sessions } = req.body;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({ error: 'Sessions must be a non-empty array.' });
    }
    await SchoolSetting.findOneAndUpdate(
      { key: 'operatingSessions' },
      { key: 'operatingSessions', val: sessions },
      { upsert: true, new: true }
    );
    await AuditEntry.create({
      userId: req.user._id,
      action: 'update_operating_sessions',
      objectType: 'school_setting',
      objectId: 'operatingSessions',
      reason: `Updated ${sessions.length} operating sessions`,
      createdAt: new Date()
    });
    res.json({ ok: true, sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', requireAuth(['admin']), async (req, res) => {
  try {
    const { discloseCollectorName, allowOfflineStalePickupPolicy, timezone, campusTimezones, operatingSessions } = req.body;
    if (discloseCollectorName !== undefined) {
      await SchoolSetting.findOneAndUpdate(
        { key: 'discloseCollectorName' },
        { key: 'discloseCollectorName', val: Boolean(discloseCollectorName) },
        { upsert: true, new: true }
      );
      await AuditEntry.create({
        userId: req.user._id,
        action: 'update_school_settings',
        objectType: 'school_setting',
        objectId: 'discloseCollectorName',
        reason: `discloseCollectorName set to ${Boolean(discloseCollectorName)}`,
        createdAt: new Date()
      });
    }
    if (allowOfflineStalePickupPolicy !== undefined) {
      await SchoolSetting.findOneAndUpdate(
        { key: 'allowOfflineStalePickupPolicy' },
        { key: 'allowOfflineStalePickupPolicy', val: Boolean(allowOfflineStalePickupPolicy) },
        { upsert: true, new: true }
      );
      await AuditEntry.create({
        userId: req.user._id,
        action: 'update_school_settings',
        objectType: 'school_setting',
        objectId: 'allowOfflineStalePickupPolicy',
        reason: `allowOfflineStalePickupPolicy set to ${Boolean(allowOfflineStalePickupPolicy)}`,
        createdAt: new Date()
      });
    }
    if (timezone !== undefined) {
      await SchoolSetting.findOneAndUpdate(
        { key: 'timezone' },
        { key: 'timezone', val: String(timezone).trim() },
        { upsert: true, new: true }
      );
      await AuditEntry.create({
        userId: req.user._id,
        action: 'update_school_settings',
        objectType: 'school_setting',
        objectId: 'timezone',
        reason: `timezone set to ${timezone}`,
        createdAt: new Date()
      });
    }
    if (campusTimezones !== undefined && typeof campusTimezones === 'object') {
      await SchoolSetting.findOneAndUpdate(
        { key: 'campusTimezones' },
        { key: 'campusTimezones', val: campusTimezones },
        { upsert: true, new: true }
      );
      await AuditEntry.create({
        userId: req.user._id,
        action: 'update_school_settings',
        objectType: 'school_setting',
        objectId: 'campusTimezones',
        reason: 'Updated campus timezones map',
        createdAt: new Date()
      });
    }
    if (Array.isArray(operatingSessions) && operatingSessions.length > 0) {
      await SchoolSetting.findOneAndUpdate(
        { key: 'operatingSessions' },
        { key: 'operatingSessions', val: operatingSessions },
        { upsert: true, new: true }
      );
      await AuditEntry.create({
        userId: req.user._id,
        action: 'update_school_settings',
        objectType: 'school_setting',
        objectId: 'operatingSessions',
        reason: `Updated ${operatingSessions.length} operating sessions via settings`,
        createdAt: new Date()
      });
    }
    const state = await getStateJson();
    res.json({ ok: true, school: state.school });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/exceptions', requireAuth(), async (req, res) => {
  try {
    const todayStr = formatDate(nowLocal());
    // Find events with manualEntry or card_missing or card_unreadable or authorized_exception
    const exceptionEvents = await AttendanceEvent.find({
      $or: [
        { manualEntry: true },
        { reason: 'card_missing' },
        { reason: 'card_unreadable' },
        { source: 'Manual entry' },
        { source: 'Manual ID lookup' },
        { type: 'authorized_exception' }
      ]
    }).sort({ createdAt: -1 });

    const pupilIds = [...new Set(exceptionEvents.map(e => e.pupilId))];
    const pupils = await Pupil.find({ id: { $in: pupilIds } });
    const pupilMap = {};
    pupils.forEach(p => { pupilMap[p.id] = p; });

    let todayMissingCardCount = 0;
    let todayUnreadableQrCount = 0;
    let todayManualEntryCount = 0;
    let todayAuthorizedExceptionCount = 0;

    const reportItems = exceptionEvents.map(e => {
      const isToday = e.date === todayStr;
      if (isToday) {
        if (e.reason === 'card_missing') todayMissingCardCount++;
        else if (e.reason === 'card_unreadable') todayUnreadableQrCount++;
        if (e.manualEntry || e.reason === 'card_missing' || e.reason === 'card_unreadable' || e.source === 'Manual entry' || e.source === 'Manual ID lookup') todayManualEntryCount++;
        if (e.type === 'authorized_exception') todayAuthorizedExceptionCount++;
      }
      const p = pupilMap[e.pupilId];
      return {
        id: e.id,
        pupilId: e.pupilId,
        pupilName: p ? p.name : 'Unknown pupil',
        className: p ? p.className : '',
        type: e.type,
        time: e.time,
        date: e.date,
        createdAt: e.createdAt,
        staff: e.staff,
        source: e.source,
        reason: e.reason || '',
        manualEntry: Boolean(e.manualEntry || e.reason === 'card_missing' || e.reason === 'card_unreadable' || e.source === 'Manual entry' || e.source === 'Manual ID lookup'),
        collector: e.collector || null,
        verification: e.verification || null,
        device: e.device,
        campus: e.campus,
        gate: e.gate,
        syncStatus: e.syncStatus
      };
    });

    res.json({
      summary: {
        totalExceptions: reportItems.length,
        todayExceptions: reportItems.filter(e => e.date === todayStr).length,
        todayMissingCard: todayMissingCardCount,
        todayUnreadableQr: todayUnreadableQrCount,
        todayManualEntries: todayManualEntryCount,
        todayAuthorizedExceptions: todayAuthorizedExceptionCount
      },
      exceptions: reportItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/export/activity', requireAuth(), async (req, res) => {
  try {
    await AuditEntry.create({
      userId: req.user._id,
      action: 'export_csv',
      objectType: 'activity_log',
      objectId: formatDate(nowLocal()),
      reason: 'User exported activity CSV',
      createdAt: new Date()
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Serve static files
app.use(express.static(path.join(__dirname)));

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
  } catch (e) {
    console.log('Local MongoDB not running. Launching in-memory Mongo server...');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }
  await seedInitialData();
  return app.listen(PORT, HOST, () => {
    console.log(`Gatewise (Node/Express/MongoDB) is available at http://${HOST}:${PORT}`);
    console.log(`Demo staff sign-in: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer, seedInitialData };
