const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  policySettings: {
    discloseCollectorName: { type: Boolean, default: true },
    allowOfflineStalePickupPolicy: { type: Boolean, default: false },
    enforceMfaForAdmins: { type: Boolean, default: true },
    strongStaffPasswordPolicy: { type: Boolean, default: true },
    scanRateLimitMaxPerMinute: { type: Number, default: 30 }
  },
  timezone: { type: String, default: 'Europe/London' },
  notificationConfiguration: {
    defaultChannel: { type: String, enum: ['sms', 'push', 'email', 'whatsapp'], default: 'sms' },
    smsEnabled: { type: Boolean, default: true },
    pushEnabled: { type: Boolean, default: true },
    whatsappEnabled: { type: Boolean, default: false },
    emailEnabled: { type: Boolean, default: true },
    retryMaxAttempts: { type: Number, default: 3 }
  },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ['admin', 'manager', 'viewer', 'guardian'], default: 'viewer' },
  salt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  active: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'inactive', 'revoked'], default: 'active' },
  guardianId: { type: String, default: null }, // Optional link to Guardian document
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, default: null },
  mfaEnforced: { type: Boolean, default: false },
  deviceLockEnforced: { type: Boolean, default: false },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  assignedCampus: { type: String, default: 'Primary campus' },
  authMetadata: {
    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    lastPasswordChange: { type: Date, default: Date.now }
  }
}, { timestamps: true });

const collectorSchema = new mongoose.Schema({
  id: { type: Number },
  name: { type: String, required: true, trim: true },
  relation: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  idCheckGuidance: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  permissionType: {
    type: String,
    enum: ['ongoing', 'time_limited', 'one_time', 'emergency_exception'],
    default: 'ongoing'
  },
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  until: { type: String, default: 'Ongoing' },
  status: { type: String, enum: ['active', 'expired', 'revoked'], default: 'active' },
  active: { type: Boolean, default: true },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  revokedBy: { type: String, default: '' },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  usedAt: { type: Date, default: null }
});

const pickupContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupil: { type: String, default: null },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  name: { type: String, required: true, trim: true },
  relationship: { type: String, default: '' },
  relation: { type: String, default: '' },
  verificationData: { type: mongoose.Schema.Types.Mixed, default: null },
  verificationReference: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  idCheckGuidance: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  permissionType: {
    type: String,
    enum: ['ongoing', 'time_limited', 'one_time', 'emergency_exception'],
    default: 'ongoing'
  },
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  effectiveDates: {
    startDate: { type: String, default: null },
    endDate: { type: String, default: null }
  },
  until: { type: String, default: 'Ongoing' },
  status: { type: String, enum: ['active', 'expired', 'revoked'], default: 'active' },
  active: { type: Boolean, default: true },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  revokedBy: { type: String, default: '' },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  usedAt: { type: Date, default: null },
  collectorId: { type: Number, default: null }
}, { timestamps: true });

const pupilSchema = new mongoose.Schema({
  schoolId: { type: String, default: 'SCH-001', trim: true },
  photoReference: { type: String, default: null },
  class: { type: String, default: 'Grade 1A', trim: true },
  campus: { type: String, default: 'Primary campus', trim: true },
  status: { type: String, enum: ['active', 'withdrawn', 'transferred', 'archived'], default: 'active' },
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
  event: { type: String, default: null },
  guardian: { type: String, default: null },
  guardianId: { type: String, default: null },
  providerReference: { type: String, default: null },
  failureCategory: { type: String, default: null },
  timestamps: {
    queuedAt: { type: Date, default: Date.now },
    providerAcceptedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    failedAt: { type: Date, default: null }
  },
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
  guardianId: { type: String, default: null },
  name: { type: String, required: true, trim: true },
  relation: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  idCheckGuidance: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  permissionType: {
    type: String,
    enum: ['ongoing', 'time_limited', 'one_time', 'emergency_exception'],
    default: 'ongoing'
  },
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  requestedBy: { type: String, required: true },
  time: { type: String, required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
  decisionReason: { type: String, default: '' },
  decidedBy: { type: String, default: '' },
  decidedAt: { type: Date, default: null }
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
  actor: { type: String, default: '' },
  object: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  beforeReferences: { type: mongoose.Schema.Types.Mixed, default: null },
  afterReferences: { type: mongoose.Schema.Types.Mixed, default: null },
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
const PickupContact = mongoose.model('PickupContact', pickupContactSchema);
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
  pupil: { type: String, default: null },
  guardian: { type: String, default: null },
  authorityMetadata: {
    canAuthorizePickup: { type: Boolean, default: true },
    canReceiveAlerts: { type: Boolean, default: true },
    isEmergencyContact: { type: Boolean, default: true },
    custodyDocumentationRef: { type: String, default: null }
  },
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
  pupil: { type: String, default: null },
  tokenHash: { type: String, default: null },
  tokenReference: { type: String, default: null },
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
  school: { type: String, default: 'SCH-001', trim: true },
  addressReference: { type: String, default: '' },
  timezoneOverride: { type: String, default: null },
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
  managedDeviceIdentifier: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
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
const securityIncidentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  incidentType: {
    type: String,
    required: true,
    enum: ['lost_device', 'compromised_account', 'incorrect_alert', 'unauthorized_pickup', 'suspicious_scan_pattern', 'other']
  },
  severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'high' },
  title: { type: String, required: true },
  description: { type: String, required: true },
  reportedBy: { type: String, required: true }, // staff email / name
  reporterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  targetType: { type: String, default: '' }, // 'device', 'user', 'pupil', 'alert', 'scanner'
  targetId: { type: String, default: '' },
  campus: { type: String, default: 'All campuses' },
  status: { type: String, enum: ['open', 'investigating', 'contained', 'resolved'], default: 'open' },
  actionTaken: { type: String, default: '' },
  escalatedTo: [{ type: String }], // Names or roles of escalation contacts notified
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null },
  resolutionNotes: { type: String, default: '' }
}, { timestamps: true });

const securityAlertSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  alertType: {
    type: String,
    required: true,
    enum: ['unusual_scan_pattern', 'repeated_unknown_scans', 'scan_rate_limited', 'repeated_failed_logins', 'failed_mfa', 'unauthorized_access_attempt', 'lost_device_activity']
  },
  severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'medium' },
  title: { type: String, required: true },
  details: { type: String, required: true },
  ip: { type: String, default: '' },
  identifier: { type: String, default: '' }, // token hash / device / email
  count: { type: Number, default: 1 },
  acknowledged: { type: Boolean, default: false },
  acknowledgedAt: { type: Date, default: null },
  acknowledgedBy: { type: String, default: null }
}, { timestamps: true });

const School = mongoose.model('School', schoolSchema);
const StaffUser = mongoose.model('StaffUser', userSchema);
const EscalationContact = mongoose.model('EscalationContact', escalationContactSchema);
const Card = mongoose.model('Card', cardSchema);
const Guardian = mongoose.model('Guardian', guardianSchema);
const PupilGuardian = mongoose.model('PupilGuardian', pupilGuardianSchema);
const CorrectionRequest = mongoose.model('CorrectionRequest', correctionRequestSchema);
const SchoolSetting = mongoose.model('SchoolSetting', schoolSettingSchema);
const SecurityIncident = mongoose.model('SecurityIncident', securityIncidentSchema);
const SecurityAlert = mongoose.model('SecurityAlert', securityAlertSchema);

const DATA_CLASS_RULES = {
  School: {
    description: 'School institutional identity, operational policies, timezone, and notification settings',
    retentionDays: 2555,
    retentionPolicy: 'Permanent institutional setting; retained for duration of school operation plus 7 years audit trail.',
    accessRoles: ['admin'],
    readRoles: ['admin', 'manager', 'viewer'],
    minimizationRules: 'Institutional metadata only; no child or parent PII allowed.'
  },
  Campus: {
    description: 'Campus facility details, gates, address references, and timezone overrides',
    retentionDays: 2555,
    retentionPolicy: 'Retained while campus is operational; archived upon campus closure.',
    accessRoles: ['admin'],
    readRoles: ['admin', 'manager', 'viewer', 'guardian'],
    minimizationRules: 'Physical gate and campus infrastructure references only.'
  },
  Pupil: {
    description: 'Enrolled pupil school record, classroom, photograph reference, and status',
    retentionDays: 2555,
    retentionPolicy: 'Retained for active enrollment period plus statutory educational record retention (7 years post-graduation/withdrawal).',
    accessRoles: ['admin', 'manager'],
    readRoles: ['admin', 'manager', 'viewer', 'guardian'],
    minimizationRules: 'School ID, name, classroom, photo reference, status; full pupil record must NEVER be copied into logs or notification tables.'
  },
  Guardian: {
    description: 'Verified guardian identity, verified contact channels, consent, and preferences',
    retentionDays: 2555,
    retentionPolicy: 'Retained while linked to an enrolled pupil, purged 7 years after last linked pupil departs.',
    accessRoles: ['admin', 'manager'],
    readRoles: ['admin', 'manager', 'guardian'],
    minimizationRules: 'Name, verified phone/email, preferences only; access strictly scoped to linked pupils.'
  },
  PupilGuardian: {
    description: 'Pupil-to-guardian linking, relationship, authority metadata, and verification status',
    retentionDays: 2555,
    retentionPolicy: 'Retained while pupil relationship is active plus statutory custody/educational retention.',
    accessRoles: ['admin'],
    readRoles: ['admin', 'manager', 'guardian'],
    minimizationRules: 'Pupil and guardian identifier references, relationship, legal authority metadata.'
  },
  PickupContact: {
    description: 'Authorized pickup contacts, verification references, effective dates, and permission types',
    retentionDays: 365,
    retentionPolicy: 'Active during validity window; one-time permissions expire upon pupil departure; archived records purged after 1 year.',
    accessRoles: ['admin', 'manager'],
    readRoles: ['admin', 'manager', 'guardian'],
    minimizationRules: 'Name, relationship, verification data/reference, effective date window; one-time permissions expire immediately after departure.'
  },
  Card: {
    description: 'PVC credential random non-meaningful token hash and reference, issue/revoke timestamps, and status',
    retentionDays: 365,
    retentionPolicy: 'Active while card is assigned; revoked/replaced card tokens retained for 1 year for audit and scan reconciliation.',
    accessRoles: ['admin', 'manager'],
    readRoles: ['admin', 'manager'],
    minimizationRules: 'Cryptographically random token hash/reference without encoding pupil name, date of birth, or PII.'
  },
  StaffUser: {
    description: 'Staff operator accounts, roles, assigned campus, status, and authentication metadata',
    retentionDays: 2555,
    retentionPolicy: 'Retained during employment tenure plus 7 years audit trail.',
    accessRoles: ['admin'],
    readRoles: ['admin', 'manager'],
    minimizationRules: 'Staff identity, role, campus scope, authentication metadata with salted hashes; passwords never stored in plaintext.'
  },
  Device: {
    description: 'Managed terminal/scanner device identifier, assigned staff/campus, status, and last seen',
    retentionDays: 730,
    retentionPolicy: 'Retained while hardware is active; decommissioned/lost devices retained 2 years for security audit.',
    accessRoles: ['admin'],
    readRoles: ['admin', 'manager'],
    minimizationRules: 'Hardware identifier, campus/gate assignment, lock status; remote revocation on compromise.'
  },
  AttendanceEvent: {
    description: 'Arrival, departure, manual entry, and correction records with UTC timestamps, actor, and verification',
    retentionDays: 365,
    retentionPolicy: 'Retained for active academic year (default 365 days) before administrative archive/purge.',
    accessRoles: ['admin', 'manager'],
    readRoles: ['admin', 'manager', 'viewer', 'guardian'],
    minimizationRules: 'Pupil identifier reference, event type, UTC timestamps, actor, device, campus, collector, verification method; original events preserved via non-destructive corrections.'
  },
  Notification: {
    description: 'Guardian dispatch records, channel, provider reference, timestamps, and delivery status',
    retentionDays: 90,
    retentionPolicy: 'Retained for 90 days for delivery verification and SLA reporting, then automatically purged.',
    accessRoles: ['admin', 'manager'],
    readRoles: ['admin', 'manager', 'guardian'],
    minimizationRules: 'Minimal entity references (eventId, pupilId, guardianName, recipient, channel, status); NEVER copy entire pupil record or addresses into notification rows.'
  },
  AuditEntry: {
    description: 'Immutable security and administrative audit trail with actor, action, object, timestamp, reason, and before/after references',
    retentionDays: 730,
    retentionPolicy: 'Retained for 2 years (730 days) to comply with educational safety and data privacy compliance regulations.',
    accessRoles: ['admin'],
    readRoles: ['admin'],
    minimizationRules: 'Actor, action, object reference, timestamp, reason, before/after diff references; NEVER copy entire pupil record into audit log entries.'
  }
};

module.exports = {
  School,
  User,
  StaffUser,
  Pupil,
  PickupRequest,
  PickupContact,
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
  EscalationContact,
  SecurityIncident,
  SecurityAlert,
  DATA_CLASS_RULES
};
