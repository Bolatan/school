const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ['admin', 'manager', 'viewer'], default: 'viewer' },
  salt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const collectorSchema = new mongoose.Schema({
  id: { type: Number },
  name: { type: String, required: true },
  relation: { type: String, required: true },
  until: { type: String, default: 'Ongoing' },
  active: { type: Boolean, default: true }
});

const pupilSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  className: { type: String, required: true, trim: true },
  guardian: { type: String, required: true, trim: true },
  initials: { type: String, required: true },
  color: { type: String, required: true },
  photo: { type: String, default: '♙' },
  active: { type: Boolean, default: true },
  collectors: [collectorSchema]
}, { timestamps: true });

const pickupRequestSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupilId: { type: String, required: true, ref: 'Pupil' },
  name: { type: String, required: true },
  relation: { type: String, required: true },
  requestedBy: { type: String, required: true },
  time: { type: String, required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' }
}, { timestamps: true });

const attendanceEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupilId: { type: String, required: true, ref: 'Pupil' },
  type: { type: String, required: true, enum: ['arrival', 'departure', 'manual_arrival', 'manual_departure', 'correction', 'authorized_exception'] },
  time: { type: String, required: true },
  date: { type: String, required: true },
  createdAt: { type: Number, required: true },
  staff: { type: String, required: true },
  source: { type: String, required: true, default: 'Card scan' },
  collector: { type: String, default: null },
  verification: { type: String, default: null },
  alert: { type: String, default: 'Demo only' },
  reason: { type: String, default: '' },
  manualEntry: { type: Boolean, default: false },
  correctionLink: { type: String, default: null }
}, { timestamps: true });

const auditEntrySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  objectType: { type: String, required: true },
  objectId: { type: String, required: true },
  reason: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  expiresAt: { type: Number, required: true },
  createdAt: { type: Number, required: true }
});

const User = mongoose.model('User', userSchema);
const Pupil = mongoose.model('Pupil', pupilSchema);
const PickupRequest = mongoose.model('PickupRequest', pickupRequestSchema);
const AttendanceEvent = mongoose.model('AttendanceEvent', attendanceEventSchema);
const AuditEntry = mongoose.model('AuditEntry', auditEntrySchema);
const Session = mongoose.model('Session', sessionSchema);

module.exports = {
  User,
  Pupil,
  PickupRequest,
  AttendanceEvent,
  AuditEntry,
  Session
};
