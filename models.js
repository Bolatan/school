const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  identity: { type: String, trim: true, default: '' }, // Identity identifier/descriptor
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ['admin', 'manager', 'viewer', 'guardian'], default: 'viewer' },
  salt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  status: { type: String, enum: ['active', 'disabled', 'revoked'], default: 'active' },
  active: { type: Boolean, default: true },
  guardianId: { type: String, default: null }, // Optional link to Guardian document
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, default: null },
  mfaEnforced: { type: Boolean, default: false },
  deviceLockEnforced: { type: Boolean, default: false },
  authenticationMetadata: {
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: '' },
    failedLoginCount: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null }
  },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  assignedCampus: { type: String, default: 'Primary campus' }
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
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  pupil: { type: String, default: function() { return this.pupilId; } },
  name: { type: String, required: true, trim: true },
  relationship: { type: String, default: function() { return this.relation || ''; } },
  relation: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  verificationData: { type: String, default: '' }, // verification data/reference
  verificationReference: { type: String, default: '' },
  idCheckGuidance: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  permissionType: {
    type: String,
    enum: ['ongoing', 'time_limited', 'one_time', 'emergency_exception'],
    default: 'ongoing'
  },
  effectiveDates: {
    startDate: { type: String, default: null },
    endDate: { type: String, default: null }
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
  usedAt: { type: Date, default: null },
  collectorId: { type: Number, default: null }
}, { timestamps: true });

const pupilSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, uppercase: true, trim: true }, // school ID
  name: { type: String, required: true, trim: true },
  className: { type: String, required: true, trim: true }, // class
  class: { type: String, trim: true, default: function() { return this.className; } },
  campus: { type: String, default: 'Primary campus' },
  status: { type: String, enum: ['active', 'withdrawn', 'transferred', 'archived'], default: 'active' },
  guardian: { type: String, required: true, trim: true },
  guardianPhone: { type: String, default: '+1 555-0100' },
  guardianEmail: { type: String, default: '' },
  preferredChannel: { type: String, enum: ['sms', 'whatsapp', 'push', 'email'], default: 'sms' },
  initials: { type: String, required: true },
  color: { type: String, required: true },
  photo: { type: String, default: '♙' },
  photoReference: { type: String, default: '♙' }, // photo reference
  active: { type: Boolean, default: true },
  collectors: [collectorSchema]
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  eventId: { type: String, required: true, index: true },
  event: { type: String, default: function() { return this.eventId; } }, // event reference
  pupilId: { type: String, required: true, index: true },
  guardianId: { type: String, default: null, index: true },
  guardian: { type: String, default: function() { return this.guardianId || this.guardianName; } }, // guardian reference
  guardianName: { type: String, required: true },
  channel: {
    type: String,
    required: true,
    enum: ['PUSH', 'SMS', 'WHATSAPP', 'EMAIL']
  },
  recipient: { type: String, required: true },
  message: { type: String, default: '' },
  privacySafePreview: { type: String, default: '' },
  status: {
    type: String,
    required: true,
    default: 'accepted_by_provider'
  },
  providerReference: { type: String, default: null },
  timestamps: {
    sentAt: { type: String, default: function() { return this.sentAt || new Date().toISOString(); } },
    lastRetryAt: { type: Date, default: null }
  },
  failureCategory: { type: String, default: null },
  failureReason: { type: String, default: null },
  retryCount: { type: Number, default: 0 },
  lastRetryAt: { type: Date, default: null },
  idempotencyKey: { type: String, default: null, index: true },
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
  pupil: { type: String, default: function() { return this.pupilId; } },
  type: { type: String, required: true, enum: ['arrival', 'departure', 'manual_arrival', 'manual_departure', 'correction', 'authorized_exception'] },
  timestamp: { type: Date, default: Date.now }, // Stored in UTC
  utcTimestamp: { type: String, default: () => new Date().toISOString() }, // Canonical UTC ISO string
  timestamps: {
    utc: { type: String, default: () => new Date().toISOString() },
    serverReceivedAt: { type: Number, default: null },
    deviceCapturedAt: { type: Number, default: null }
  },
  time: { type: String, required: true }, // Rendered in campus timezone
  date: { type: String, required: true }, // Rendered in campus timezone
  createdAt: { type: Number, required: true },
  staff: { type: String, required: true },
  actor: { type: String, default: function() { return this.staff; } },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  source: { type: String, required: true, default: 'Card scan' },
  collector: { type: String, default: null },
  verification: { type: String, default: null },
  verificationMethod: { type: String, default: function() { return this.verification || ''; } },
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
  actor: { type: String, default: function() { return this.userId ? this.userId.toString() : 'system'; } },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  object: { type: String, default: function() { return `${this.objectType}:${this.objectId}`; } },
  objectType: { type: String, required: true },
  objectId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  reason: { type: String, default: '' },
  beforeReferences: { type: mongoose.Schema.Types.Mixed, default: null },
  afterReferences: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  expiresAt: { type: Number, required: true },
  createdAt: { type: Number, required: true }
});

const User = mongoose.model('User', userSchema);
const StaffUser = User; // StaffUser alias/domain model for staff account management
const Pupil = mongoose.model('Pupil', pupilSchema);
const PickupRequest = mongoose.model('PickupRequest', pickupRequestSchema);
const PickupContact = mongoose.model('PickupContact', pickupContactSchema);
const AttendanceEvent = mongoose.model('AttendanceEvent', attendanceEventSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const AuditEntry = mongoose.model('AuditEntry', auditEntrySchema);
const Session = mongoose.model('Session', sessionSchema);

const schoolSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  policySettings: {
    allowOfflineStalePickupPolicy: { type: Boolean, default: false },
    discloseCollectorName: { type: Boolean, default: true },
    mfaEnforcedForAdmins: { type: Boolean, default: true },
    deviceLockEnforced: { type: Boolean, default: true },
    operatingSessions: [{ type: String }]
  },
  timezone: { type: String, default: 'Europe/London' },
  notificationConfiguration: {
    smsProvider: { type: String, default: 'Twilio' },
    pushProvider: { type: String, default: 'APNs/FCM' },
    emailProvider: { type: String, default: 'SendGrid' },
    whatsappEnabled: { type: Boolean, default: false },
    quietHoursStart: { type: String, default: '21:00' },
    quietHoursEnd: { type: String, default: '06:00' }
  },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const schoolSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  val: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const guardianSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  verifiedContacts: {
    email: { type: String, lowercase: true, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false }
  },
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
  accountStatus: { type: String, enum: ['invited', 'active', 'suspended'], default: 'invited' },
  preferredChannels: [{ type: String, enum: ['sms', 'whatsapp', 'push', 'email'] }],
  preferences: {
    channels: [{ type: String, enum: ['sms', 'whatsapp', 'push', 'email'] }],
    pausedNonCriticalAlerts: { type: Boolean, default: false }
  },
  pausedNonCriticalAlerts: { type: Boolean, default: false },
  pausedAt: { type: Date, default: null },
  whatsappOptIn: { type: Boolean, default: false },
  whatsappOptInAt: { type: Date, default: null },
  pushToken: { type: String, default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

const pupilGuardianSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  pupil: { type: String, default: function() { return this.pupilId; } },
  guardianId: { type: String, required: true, ref: 'Guardian', index: true },
  guardian: { type: String, default: function() { return this.guardianId; } },
  relationship: { type: String, required: true, default: 'Parent' },
  isLegalGuardian: { type: Boolean, default: true },
  status: { type: String, enum: ['pending_verification', 'active', 'revoked'], default: 'pending_verification' },
  authorityMetadata: {
    canAuthorizePickups: { type: Boolean, default: true },
    canReceiveArrivalAlerts: { type: Boolean, default: true },
    canReceiveDismissalAlerts: { type: Boolean, default: true },
    notes: { type: String, default: '' }
  },
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
  pupil: { type: String, default: function() { return this.pupilId; } },
  cardToken: { type: String, required: true, unique: true, index: true }, // Random, non-meaningful token (no PII)
  tokenHash: { type: String, default: function() { return this.cardToken; } }, // random token hash/reference
  tokenReference: { type: String, default: function() { return this.cardToken; } },
  status: { type: String, enum: ['active', 'revoked', 'replaced'], default: 'active' },
  issuedAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  issuedBy: { type: String, default: 'School Administration' }
}, { timestamps: true });

const campusSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  school: { type: String, default: 'Northfield School' }, // School reference / ID
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  address: { type: String, default: '' },
  addressReference: { type: String, default: '' }, // Address reference / descriptor
  timezone: { type: String, default: 'Europe/London' },
  timezoneOverride: { type: String, default: null }, // Timezone override per campus
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
  id: { type: String, required: true, unique: true, trim: true }, // managed device identifier (e.g. DEV-001)
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['terminal', 'handheld', 'tablet', 'kiosk'], default: 'terminal' },
  assignedStaff: { type: String, default: '' }, // assigned staff
  assignedCampus: { type: String, default: 'Primary campus' }, // assigned campus
  assignedGate: { type: String, default: 'Main gate' },
  deviceLockEnabled: { type: Boolean, default: true },
  deviceLockPin: { type: String, default: '1234' }, // Required lock PIN for strong staff sign-in
  status: { type: String, enum: ['active', 'revoked', 'lost', 'maintenance'], default: 'active' },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  lastSeenAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }
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

const EscalationContact = mongoose.model('EscalationContact', escalationContactSchema);
const Card = mongoose.model('Card', cardSchema);
const Guardian = mongoose.model('Guardian', guardianSchema);
const PupilGuardian = mongoose.model('PupilGuardian', pupilGuardianSchema);
const CorrectionRequest = mongoose.model('CorrectionRequest', correctionRequestSchema);
const School = mongoose.model('School', schoolSchema);
const SchoolSetting = mongoose.model('SchoolSetting', schoolSettingSchema);
const SecurityIncident = mongoose.model('SecurityIncident', securityIncidentSchema);
const SecurityAlert = mongoose.model('SecurityAlert', securityAlertSchema);

// 12 Core Domain Data Class Governance Rules (Retention, Access Scoping, Minimization)
const DATA_CLASS_RULES = {
  School: {
    name: 'School',
    fields: ['name', 'policySettings', 'timezone', 'notificationConfiguration'],
    retentionDays: null, // Permanent administrative record
    retentionPolicy: 'Permanent institutional configuration retained during school operation.',
    allowedRoles: ['admin'],
    accessScope: 'Institutional configuration restricted to school administrators',
    dataMinimizationNotice: 'Contains institutional metadata and operating settings only; no pupil or guardian PII.'
  },
  Campus: {
    name: 'Campus',
    fields: ['school', 'name', 'address', 'timezoneOverride', 'gates'],
    retentionDays: null, // Permanent operational infrastructure
    retentionPolicy: 'Retained as active infrastructure reference across academic years.',
    allowedRoles: ['admin', 'manager', 'viewer'],
    accessScope: 'Assigned campus operational boundaries for gate operations and staff assignment',
    dataMinimizationNotice: 'Geographic and gate metadata; zero personal data stored.'
  },
  Pupil: {
    name: 'Pupil',
    fields: ['id', 'name', 'photoReference', 'class', 'campus', 'status'],
    retentionDays: 1825, // 5 years post-graduation / withdrawal statutory requirement
    retentionPolicy: 'Retained during active enrollment plus 5 statutory years following withdrawal/graduation.',
    allowedRoles: ['admin', 'manager', 'viewer', 'guardian'],
    accessScope: 'Scoped by class/campus for staff; strictly bounded to linked household pupils for guardians',
    dataMinimizationNotice: 'Core pupil profile: school ID, name, photo reference, class, campus, status. Full record must never be copied into logs or notification tables.'
  },
  Guardian: {
    name: 'Guardian',
    fields: ['name', 'verifiedContacts', 'accountStatus', 'preferences'],
    retentionDays: 1825, // Synchronized with linked pupil enrollment lifecycle
    retentionPolicy: 'Retained while linked pupils are enrolled plus statutory retention period.',
    allowedRoles: ['admin', 'manager', 'guardian'],
    accessScope: 'Self-access for verified guardians; administrative oversight for staff',
    dataMinimizationNotice: 'Contact information verified via proof of channel control; only contact details and delivery preferences stored.'
  },
  PupilGuardian: {
    name: 'PupilGuardian',
    fields: ['pupil', 'guardian', 'relationship', 'status', 'authorityMetadata'],
    retentionDays: 1825,
    retentionPolicy: 'Relationship and legal authority history preserved throughout pupil educational lifecycle.',
    allowedRoles: ['admin', 'manager', 'guardian'],
    accessScope: 'Strict household boundary enforcement; changes require formal school administrator approval',
    dataMinimizationNotice: 'Relational link and authority flags; pupil PII is referenced by identifier only.'
  },
  PickupContact: {
    name: 'PickupContact',
    fields: ['pupil', 'name', 'relationship', 'verificationData', 'effectiveDates', 'status'],
    retentionDays: 365, // Expired permissions pruned after 1 year unless linked to incident
    retentionPolicy: 'Active until expiry; one-time permissions automatically expire immediately upon pickup; record pruned after 365 days.',
    allowedRoles: ['admin', 'manager', 'viewer', 'guardian'],
    accessScope: 'Gate staff access for handover verification; guardian access for linked pupils',
    dataMinimizationNotice: 'Collector identity verification data and validity windows; does not replicate pupil roster data.'
  },
  Card: {
    name: 'Card',
    fields: ['pupil', 'tokenHash', 'issueTimestamps', 'revokeTimestamps', 'status'],
    retentionDays: 730, // 2 years post-revocation
    retentionPolicy: 'Revoked cards retained for 2 years for audit traceability; active cards maintained during pupil tenure.',
    allowedRoles: ['admin', 'manager', 'viewer'],
    accessScope: 'Staff lookup during physical gate scanning; card tokens are non-meaningful random hashes containing zero PII',
    dataMinimizationNotice: 'QR tokens are random opaque lookup keys; no pupil name, DOB, or PII encoded in token or QR image.'
  },
  StaffUser: {
    name: 'StaffUser',
    fields: ['identity', 'role', 'assignedCampus', 'status', 'authenticationMetadata'],
    retentionDays: 1095, // 3 years post-revocation/departure
    retentionPolicy: 'Staff profiles and authentication audit retained 3 years post-account revocation.',
    allowedRoles: ['admin'],
    accessScope: 'User management restricted to admin; assigned campus scoping for operational duties',
    dataMinimizationNotice: 'Identity, role, and credential metadata; salted hashes only, passwords never stored in plain text.'
  },
  Device: {
    name: 'Device',
    fields: ['id', 'assignedStaff', 'assignedCampus', 'lastSeen', 'status'],
    retentionDays: 730, // 2 years
    retentionPolicy: 'Hardware and terminal management logs retained for 2 years.',
    allowedRoles: ['admin', 'manager'],
    accessScope: 'Assigned staff/gate operation; administrator device lock and remote revocation controls',
    dataMinimizationNotice: 'Device hardware identifier and assignment metadata; no persistent pupil cache.'
  },
  AttendanceEvent: {
    name: 'AttendanceEvent',
    fields: ['pupil', 'type', 'timestamps', 'actor', 'device', 'campus', 'source', 'collector', 'verificationMethod', 'correctionLink', 'reason'],
    retentionDays: 365, // Configurable (default 365 days / 1 school year)
    retentionPolicy: 'Retained for 1 academic year (365 days default); non-destructive corrections create linked events.',
    allowedRoles: ['admin', 'manager', 'viewer', 'guardian'],
    accessScope: 'Operational staff view campus events; guardians view only their own linked pupil timeline',
    dataMinimizationNotice: 'Avoid copying entire pupil record; records minimal pupil identifier, event type, actor, campus, and collector name only.'
  },
  Notification: {
    name: 'Notification',
    fields: ['event', 'guardian', 'channel', 'providerReference', 'status', 'timestamps', 'failureCategory'],
    retentionDays: 90, // Message delivery receipts pruned after 90 days
    retentionPolicy: 'Transient delivery records and receipts purged after 90 days.',
    allowedRoles: ['admin', 'manager'],
    accessScope: 'Admin and operational managers monitoring delivery success and failure alerts',
    dataMinimizationNotice: 'Avoid copying entire pupil record; store only event ID, guardian reference, channel, provider reference, timestamps, and privacy-safe preview.'
  },
  AuditEntry: {
    name: 'AuditEntry',
    fields: ['actor', 'action', 'object', 'timestamp', 'reason', 'beforeReferences', 'afterReferences'],
    retentionDays: 730, // 2 years default
    retentionPolicy: 'Security and administrative actions audited for 2 years (730 days) for statutory compliance.',
    allowedRoles: ['admin'],
    accessScope: 'Restricted exclusively to school administrators for security inspection and export',
    dataMinimizationNotice: 'Avoid copying entire pupil record; stores only actor ID, action name, target object reference, timestamp, reason, and change diff summaries.'
  }
};

/**
 * Applies retention and access pruning rules across the domain data classes.
 * @param {Object} customRetention - Optional overrides for retention days
 * @returns {Promise<Object>} Pruning outcome summary
 */
async function applyRetentionRules(customRetention = {}) {
  const now = Date.now();
  const results = {};

  // 1. AttendanceEvent retention
  const attendanceDays = Number(customRetention.attendanceRetentionDays) || DATA_CLASS_RULES.AttendanceEvent.retentionDays || 365;
  const attendanceCutoff = new Date(now - attendanceDays * 24 * 60 * 60 * 1000);
  const attRes = await AttendanceEvent.deleteMany({ timestamp: { $lt: attendanceCutoff } });
  results.AttendanceEvent = { pruned: attRes.deletedCount, cutoff: attendanceCutoff.toISOString(), retentionDays: attendanceDays };

  // 2. AuditEntry retention
  const auditDays = Number(customRetention.auditLogRetentionDays) || DATA_CLASS_RULES.AuditEntry.retentionDays || 730;
  const auditCutoff = new Date(now - auditDays * 24 * 60 * 60 * 1000);
  const auditRes = await AuditEntry.deleteMany({ createdAt: { $lt: auditCutoff } });
  results.AuditEntry = { pruned: auditRes.deletedCount, cutoff: auditCutoff.toISOString(), retentionDays: auditDays };

  // 3. Notification retention (90 days)
  const notifDays = Number(customRetention.notificationRetentionDays) || DATA_CLASS_RULES.Notification.retentionDays || 90;
  const notifCutoff = new Date(now - notifDays * 24 * 60 * 60 * 1000);
  const notifRes = await Notification.deleteMany({ createdAt: { $lt: notifCutoff } });
  results.Notification = { pruned: notifRes.deletedCount, cutoff: notifCutoff.toISOString(), retentionDays: notifDays };

  // 4. PickupContact expired one-time / past-end-date permissions (365 days post-expiry)
  const pickupDays = Number(customRetention.pickupContactRetentionDays) || DATA_CLASS_RULES.PickupContact.retentionDays || 365;
  const pickupCutoff = new Date(now - pickupDays * 24 * 60 * 60 * 1000);
  const pickupRes = await PickupContact.deleteMany({
    status: { $in: ['expired', 'revoked'] },
    updatedAt: { $lt: pickupCutoff }
  });
  results.PickupContact = { pruned: pickupRes.deletedCount, cutoff: pickupCutoff.toISOString(), retentionDays: pickupDays };

  // 5. Card revoked retention (730 days)
  const cardDays = Number(customRetention.cardRetentionDays) || DATA_CLASS_RULES.Card.retentionDays || 730;
  const cardCutoff = new Date(now - cardDays * 24 * 60 * 60 * 1000);
  const cardRes = await Card.deleteMany({
    status: { $in: ['revoked', 'replaced'] },
    revokedAt: { $lt: cardCutoff }
  });
  results.Card = { pruned: cardRes.deletedCount, cutoff: cardCutoff.toISOString(), retentionDays: cardDays };

  return results;
}

module.exports = {
  User,
  StaffUser,
  Pupil,
  PickupRequest,
  PickupContact,
  AttendanceEvent,
  Notification,
  AuditEntry,
  Session,
  School,
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
  DATA_CLASS_RULES,
  applyRetentionRules
};
