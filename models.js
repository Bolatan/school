const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ['admin', 'manager', 'viewer', 'guardian'], default: 'viewer' },
  salt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  active: { type: Boolean, default: true },
  guardianId: { type: String, default: null }, // Optional link to Guardian document
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, default: null },
  mfaEnforced: { type: Boolean, default: false },
  deviceLockEnforced: { type: Boolean, default: false },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  assignedCampus: { type: String, default: 'Primary campus' }
}, { timestamps: true });

const collectorSchema = new mongoose.Schema({
  id: { type: Number },
  name: { type: String, required: true, trim: true },
  relation: { type: String, default: '', trim: true }, // relationship (optional)
  contactDetails: { type: String, default: '', trim: true }, // phone, email if needed
  idCheckGuidance: { type: String, default: '', trim: true }, // photo/ID-check guidance under school policy
  permissionType: {
    type: String,
    enum: ['ongoing', 'time_limited', 'one_time', 'emergency_exception'],
    default: 'ongoing'
  },
  startDate: { type: String, default: null }, // YYYY-MM-DD
  endDate: { type: String, default: null }, // YYYY-MM-DD
  until: { type: String, default: 'Ongoing' }, // Legacy / display until string
  status: { type: String, enum: ['active', 'expired', 'revoked'], default: 'active' },
  active: { type: Boolean, default: true },
  addedBy: { type: String, default: 'School Staff' },
  approvedBy: { type: String, default: 'School Staff' },
  approvedAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, default: null },
  revocationReason: { type: String, default: '' },
  oneTimeUsedAt: { type: Date, default: null }
});

const pupilSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  className: { type: String, required: true, trim: true },
  guardian: { type: String, required: true, trim: true },
  guardianPhone: { type: String, default: '+1 555-0100' },
  guardianEmail: { type: String, default: '' },
  preferredChannel: { type: String, enum: ['sms', 'whatsapp', 'push', 'email'], default: 'sms' },
  initials: { type: String, required: true },
  color: { type: String, required: true },
  photo: { type: String, default: '♙' },
  active: { type: Boolean, default: true },
  collectors: [collectorSchema]
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  eventId: { type: String, required: true },
  pupilId: { type: String, required: true },
  guardianName: { type: String, required: true },
  channel: { type: String, required: true },
  recipient: { type: String, required: true },
  message: { type: String, default: '' },
  status: { type: String, default: 'Sent' },
  sentAt: { type: String, required: true }
}, { timestamps: true });

const pickupRequestSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupilId: { type: String, required: true, ref: 'Pupil' },
  guardianId: { type: String, ref: 'Guardian', default: null },
  name: { type: String, required: true, trim: true },
  relation: { type: String, default: '', trim: true }, // relationship (optional)
  contactDetails: { type: String, default: '', trim: true }, // contact details if needed
  idCheckGuidance: { type: String, default: '', trim: true }, // photo/ID-check guidance if collected
  permissionType: {
    type: String,
    enum: ['ongoing', 'time_limited', 'one_time', 'emergency_exception'],
    default: 'one_time'
  },
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  requestedBy: { type: String, required: true },
  time: { type: String, required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
  reviewedBy: { type: String, default: null },
  reviewNote: { type: String, default: '' },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

const attendanceEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupilId: { type: String, required: true, ref: 'Pupil' },
  type: { type: String, required: true, enum: ['arrival', 'departure', 'manual_arrival', 'manual_departure', 'correction', 'authorized_exception'] },
  timestamp: { type: Date, default: Date.now }, // Stored in UTC
  utcTimestamp: { type: String, default: () => new Date().toISOString() }, // Canonical UTC ISO string
  time: { type: String, required: true }, // Rendered in campus timezone
  date: { type: String, required: true }, // Rendered in campus timezone
  createdAt: { type: Number, required: true },
  staff: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  source: { type: String, required: true, default: 'Card scan' },
  collector: { type: String, default: null },
  verification: { type: String, default: null },
  device: { type: String, default: 'Primary Gate Terminal' },
  campus: { type: String, default: 'Primary campus' },
  gate: { type: String, default: 'Main gate' },
  session: { type: String, default: 'Morning Arrival' },
  alert: { type: String, default: 'Demo only' },
  reason: { type: String, default: '' },
  correctionReason: { type: String, default: '' },
  manualEntry: { type: Boolean, default: false },
  correctionLink: { type: String, default: null },
  clientEventId: { type: String, default: null, index: true },
  offlineQueued: { type: Boolean, default: false },
  deviceCapturedAt: { type: Number, default: null },
  serverReceivedAt: { type: Number, default: null },
  syncStatus: { type: String, enum: ['synced', 'pending_sync', 'reconciled_fallback'], default: 'synced' },
  reconciliationAuditReason: { type: String, default: '' }
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
const Notification = mongoose.model('Notification', notificationSchema);
const AuditEntry = mongoose.model('AuditEntry', auditEntrySchema);
const Session = mongoose.model('Session', sessionSchema);

const schoolSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  val: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const guardianSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  verifiedContactMethod: { type: String, enum: ['sms', 'email'], required: true },
  verificationCode: { type: String, default: null }, // e.g. 6-digit OTP proving channel control
  inviteToken: { type: String, default: null, index: true },
  channelVerified: { type: Boolean, default: false },
  channelVerifiedAt: { type: Date, default: null },
  privacyNoticeAccepted: { type: Boolean, default: false },
  privacyNoticeVersion: { type: String, default: '2026.1' },
  privacyAcceptedAt: { type: Date, default: null },
  consentAccepted: { type: Boolean, default: false },
  consentAcceptedAt: { type: Date, default: null },
  status: { type: String, enum: ['invited', 'active', 'suspended'], default: 'invited' },
  preferredChannels: [{ type: String, enum: ['sms', 'whatsapp', 'push', 'email'] }],
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

const pupilGuardianSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  guardianId: { type: String, required: true, ref: 'Guardian', index: true },
  relationship: { type: String, required: true, default: 'Parent' },
  isLegalGuardian: { type: Boolean, default: true },
  status: { type: String, enum: ['pending_verification', 'active', 'revoked'], default: 'pending_verification' },
  legalStatusApprovedBySchool: { type: Boolean, default: true },
  approvedBySchoolAt: { type: Date, default: Date.now },
  approvedByStaff: { type: String, default: 'School Office' }
}, { timestamps: true });

const correctionRequestSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  guardianId: { type: String, required: true, ref: 'Guardian' },
  pupilId: { type: String, required: true, ref: 'Pupil' },
  type: { type: String, enum: ['record_correction', 'pickup_permission_request', 'legal_status_request', 'contact_school'], default: 'record_correction' },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  proposedChanges: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: { type: String, default: null },
  reviewNote: { type: String, default: '' },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

const cardSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  cardToken: { type: String, required: true, unique: true, index: true }, // Random, non-meaningful token (no PII)
  status: { type: String, enum: ['active', 'revoked', 'replaced'], default: 'active' },
  issuedAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  issuedBy: { type: String, default: 'School Administration' }
}, { timestamps: true });

const campusSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  address: { type: String, default: '' },
  timezone: { type: String, default: 'Europe/London' },
  gates: [{ type: String, trim: true }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

const schoolClassSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  gradeLevel: { type: String, default: '' },
  campus: { type: String, default: 'Primary campus' },
  teacherName: { type: String, default: '' },
  room: { type: String, default: '' },
  capacity: { type: Number, default: 30 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const deviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true }, // e.g. DEV-001
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['terminal', 'handheld', 'tablet', 'kiosk'], default: 'terminal' },
  assignedStaff: { type: String, default: '' },
  assignedCampus: { type: String, default: 'Primary campus' },
  assignedGate: { type: String, default: 'Main gate' },
  deviceLockEnabled: { type: Boolean, default: true },
  deviceLockPin: { type: String, default: '1234' }, // Required lock PIN for strong staff sign-in
  status: { type: String, enum: ['active', 'revoked', 'lost', 'maintenance'], default: 'active' },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true });

const notificationTemplateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['arrival', 'departure', 'emergency', 'manual_entry', 'general'], required: true },
  channel: { type: String, enum: ['sms', 'whatsapp', 'push', 'email', 'all'], default: 'all' },
  templateBody: { type: String, required: true },
  variables: [{ type: String }], // e.g. ['pupil_name', 'campus', 'gate', 'time', 'collector_name']
  active: { type: Boolean, default: true }
}, { timestamps: true });

const escalationContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true }, // e.g. "Head of Safeguarding", "Principal", "Gate Supervisor"
  phone: { type: String, required: true, trim: true },
  email: { type: String, default: '', lowercase: true, trim: true },
  priority: { type: Number, default: 1 }, // 1 = highest / primary
  campus: { type: String, default: 'All campuses' },
  notificationChannels: [{ type: String, enum: ['sms', 'phone', 'email', 'whatsapp'] }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

const Campus = mongoose.model('Campus', campusSchema);
const SchoolClass = mongoose.model('SchoolClass', schoolClassSchema);
const Device = mongoose.model('Device', deviceSchema);
const NotificationTemplate = mongoose.model('NotificationTemplate', notificationTemplateSchema);
const EscalationContact = mongoose.model('EscalationContact', escalationContactSchema);
const Card = mongoose.model('Card', cardSchema);
const Guardian = mongoose.model('Guardian', guardianSchema);
const PupilGuardian = mongoose.model('PupilGuardian', pupilGuardianSchema);
const CorrectionRequest = mongoose.model('CorrectionRequest', correctionRequestSchema);
const SchoolSetting = mongoose.model('SchoolSetting', schoolSettingSchema);

module.exports = {
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
  Card,
  Campus,
  SchoolClass,
  Device,
  NotificationTemplate,
  EscalationContact
};
