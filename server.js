const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

const { User, Pupil, PickupRequest, AttendanceEvent, AuditEntry, Session } = require('./models');
const {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  passwordHash,
  verifyPassword,
  nowLocal,
  formatTime,
  formatDate,
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
app.use(express.json({ limit: '12mb' }));
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
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
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
  const pupilDocs = await Pupil.find({ active: true }).sort({ name: 1 });
  const pupils = pupilDocs.map(p => {
    const activeCollectors = (p.collectors || [])
      .filter(c => c.active && (c.until === 'Ongoing' || new Date(c.until) >= new Date().setHours(0,0,0,0)))
      .map(c => ({ id: c.id, name: c.name, relation: c.relation, until: c.until }));
    return {
      id: p.id,
      name: p.name,
      className: p.className,
      guardian: p.guardian,
      initials: p.initials,
      color: p.color,
      photo: p.photo,
      collectors: activeCollectors
    };
  });

  const eventDocs = await AttendanceEvent.find().sort({ createdAt: -1 }).limit(150);
  const events = eventDocs.map(e => ({
    id: e.id,
    pupilId: e.pupilId,
    type: e.type,
    time: e.time,
    date: e.date,
    createdAt: e.createdAt,
    staff: e.staff,
    source: e.source,
    collector: e.collector,
    verification: e.verification,
    alert: e.alert,
    reason: e.reason || '',
    manualEntry: Boolean(e.manualEntry),
    correctionLink: e.correctionLink || null
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
    school: { name: "Northfield Academy", campus: "Primary campus", totalPupils: 248 },
    notifications: "demo"
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
    res.json({
      user: user ? {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role
      } : null
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

    const state = await getStateJson();
    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role
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

    await Pupil.create({
      id: pid,
      name,
      className,
      guardian,
      initials,
      color: colors[Math.floor(Date.now() / 1000) % colors.length],
      photo: '♙',
      active: true,
      collectors: []
    });

    await AuditEntry.create({
      userId: req.user._id,
      action: 'create',
      objectType: 'pupil',
      objectId: pid,
      createdAt: new Date()
    });

    const state = await getStateJson();
    res.status(201).json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', requireAuth(['admin', 'manager']), async (req, res) => {
  try {
    const pid = String(req.body.pupilId || '').trim().toUpperCase().slice(0, 30);
    const typ = String(req.body.type || '');
    let source = String(req.body.source || 'Card scan').slice(0, 50);
    const reason = String(req.body.reason || '').trim().slice(0, 200);
    const correctionLink = req.body.correctionLink ? String(req.body.correctionLink) : null;

    let manualEntry = Boolean(
      req.body.manualEntry ||
      reason === 'card_missing' ||
      reason === 'card_unreadable' ||
      source === 'Manual entry' ||
      source === 'Manual ID lookup' ||
      typ === 'authorized_exception' ||
      typ === 'correction'
    );

    if (manualEntry && source !== 'Manual entry' && source !== 'Manual ID lookup' && source !== 'Authorized exception' && source !== 'Non-destructive correction') {
      source = 'Manual entry';
    }

    if (!['arrival', 'departure', 'manual_arrival', 'manual_departure', 'correction', 'authorized_exception'].includes(typ)) {
      return res.status(400).json({ error: 'Choose arrival or departure.' });
    }

    const pupil = await Pupil.findOne({ id: pid, active: true });
    if (!pupil) {
      return res.status(400).json({ error: 'Pupil ID not found.' });
    }

    const todayStr = formatDate(nowLocal());
    const prevEvent = await AttendanceEvent.findOne({ pupilId: pid, date: todayStr }).sort({ createdAt: -1 });

    if (typ === 'arrival' && prevEvent && (prevEvent.type === 'arrival' || prevEvent.type === 'manual_arrival')) {
      return res.status(400).json({ error: `${pupil.name} already has an arrival recorded today.` });
    }
    if ((typ === 'departure' || typ === 'authorized_exception') && (!prevEvent || (prevEvent.type !== 'arrival' && prevEvent.type !== 'manual_arrival'))) {
      return res.status(400).json({ error: `Record and verify ${pupil.name}'s arrival before departure.` });
    }

    let collector = null;
    let verification = null;

    if (typ === 'departure') {
      const collectorId = req.body.collectorId;
      if (collectorId === undefined || collectorId === null) {
        return res.status(400).json({ error: 'Select an approved collector.' });
      }

      const activeCollectors = (pupil.collectors || []).filter(
        c => c.active && (c.until === 'Ongoing' || new Date(c.until) >= new Date().setHours(0,0,0,0))
      );
      const cr = activeCollectors.find(c => c.id === Number(collectorId));
      if (!cr) {
        return res.status(400).json({ error: 'That collector is not approved for this pupil.' });
      }
      collector = cr.name;
      verification = String(req.body.verification || 'Photo matched').slice(0, 60);
    } else if (typ === 'authorized_exception') {
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Only administrators or managers can authorize exceptions.' });
      }
      collector = req.body.collectorName ? String(req.body.collectorName).slice(0, 100) : 'Exception Authorized';
      verification = 'Admin Exception';
    }

    const now = nowLocal();
    const eid = crypto.randomBytes(9).toString('base64url');

    await AttendanceEvent.create({
      id: eid,
      pupilId: pid,
      type: typ,
      time: formatTime(now),
      date: formatDate(now),
      createdAt: now.getTime(),
      staff: req.user.name,
      source,
      collector,
      verification,
      alert: 'Demo only',
      reason,
      manualEntry,
      correctionLink
    });

    await AuditEntry.create({
      userId: req.user._id,
      action: `record_${typ}`,
      objectType: 'event',
      objectId: eid,
      reason: `source=${source}; reason=${reason}`,
      createdAt: now
    });

    const state = await getStateJson();
    res.status(201).json({ ok: true, eventId: eid, alertStatus: 'demo_only', state });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
