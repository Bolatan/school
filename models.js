const mongoose = require('mongoose');

// 1. School: name, policy settings, timezone, notification configuration
const schoolSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, default: 'school-main' },
  name: { type: String, required: true, trim: true },
  policySettings: {
    discloseCollectorName: { type: Boolean, default: true },
    allowOfflineStalePickupPolicy: { type: Boolean, default: false },
    retentionSettings: {
      attendanceRetentionDays: { type: Number, default: 365 },
      auditLogRetentionDays: { type: Number, default: 730 },
      notificationRetentionDays: { type: Number, default: 90 },
      pickupContactRetentionDays: { type: Number, default: 365 },
      offlineQueueTtlHours: { type: Number, default: 24 },
      sessionTimeoutMinutes: { type: Number, default: 480 },
      autoPurgeEnabled: { type: Boolean, default: true }
    },
    operatingSessions: [{
      id: String,
      name: String,
      startTime: String,
      endTime: String,
      defaultMode: String
    }]
  },
  timezone: { type: String, default: 'Europe/London' },
  notificationConfiguration: {
    pushEnabled: { type: Boolean, default: true },
    smsEnabled: { type: Boolean, default: true },
    whatsappEnabled: { type: Boolean, default: false },
    emailEnabled: { type: Boolean, default: true },
    defaultProvider: { type: String, default: 'MockGateway' },
    deliverySlaSeconds: { type: Number, default: 60 }
  },
  active: { type: Boolean, default: true }
}, { timestamps: true });

// 2. Campus: school, name, address/reference, timezone override, gates
const campusSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
  schoolId: { type: String, default: 'school-main' },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  address: { type: String, default: '' },
  reference: { type: String, default: '' },
  timezoneOverride: { type: String, default: null },
  timezone: { type: String, default: 'Europe/London' }, // Effective or base campus timezone
  gates: [{ type: String, trim: true }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

// Collector sub-schema embedded in pupil for backwards compatibility
const collectorSchema = new mongoose.Schema({
  id: { type: Number },
  name: { type: String, required: true },
  relation: { type: String, required: true },
  until: { type: String, default: 'Ongoing' },
  active: { type: Boolean, default: true }
});

// 3. Pupil: school ID, name, photo reference, class, campus, status
const pupilSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, uppercase: true, trim: true }, // school ID (e.g. NF-1042)
  schoolId: { type: String, default: 'school-main' },
  name: { type: String, required: true, trim: true },
  photoReference: { type: String, default: '♙' }, // photo reference or URI
  photo: { type: String, default: '♙' },
  class: { type: String, default: '' }, // class name / ref
  className: { type: String, required: true, trim: true },
  campus: { type: String, default: 'Primary campus' },
  status: { type: String, enum: ['active', 'withdrawn', 'transferred', 'archived'], default: 'active' },
  active: { type: Boolean, default: true },
  guardian: { type: String, required: true, trim: true },
  guardianPhone: { type: String, default: '+1 555-0100' },
  guardianEmail: { type: String, default: '' },
  preferredChannel: { type: String, enum: ['sms', 'whatsapp', 'push', 'email'], default: 'sms' },
  initials: { type: String, required: true },
  color: { type: String, required: true },
  collectors: [collectorSchema]
}, { timestamps: true });

// 4. Guardian: name, verified contacts, account status, preferences
const guardianSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  verifiedContacts: [{
    type: { type: String, enum: ['phone', 'email', 'sms'] },
    value: { type: String, trim: true },
    verifiedAt: { type: Date, default: null }
  }],
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
  accountStatus: { type: String, enum: ['invited', 'active', 'suspended', 'deactivated'], default: 'invited' },
  status: { type: String, enum: ['invited', 'active', 'suspended'], default: 'invited' },
  preferences: {
    preferredChannels: [{ type: String, enum: ['sms', 'whatsapp', 'push', 'email'] }],
    language: { type: String, default: 'en-GB' },
    pauseNonCriticalAlerts: { type: Boolean, default: false }
  },
  preferredChannels: [{ type: String, enum: ['sms', 'whatsapp', 'push', 'email'] }],
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

// 5. PupilGuardian: pupil, guardian, relationship, status, authority metadata
const pupilGuardianSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupil: { type: mongoose.Schema.Types.ObjectId, ref: 'Pupil' },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  guardian: { type: mongoose.Schema.Types.ObjectId, ref: 'Guardian' },
  guardianId: { type: String, required: true, ref: 'Guardian', index: true },
  relationship: { type: String, required: true, default: 'Parent' },
  status: { type: String, enum: ['pending_verification', 'active', 'revoked'], default: 'pending_verification' },
  authorityMetadata: {
    isLegalGuardian: { type: Boolean, default: true },
    hasCustody: { type: Boolean, default: true },
    emergencyContactPriority: { type: Number, default: 1 },
    canAuthorizePickups: { type: Boolean, default: true },
    legalStatusApprovedBySchool: { type: Boolean, default: true },
    courtOrderReference: { type: String, default: null },
    approvedBySchoolAt: { type: Date, default: Date.now },
    approvedByStaff: { type: String, default: 'School Office' }
  },
  isLegalGuardian: { type: Boolean, default: true },
  legalStatusApprovedBySchool: { type: Boolean, default: true },
  approvedBySchoolAt: { type: Date, default: Date.now },
  approvedByStaff: { type: String, default: 'School Office' }
}, { timestamps: true });

// 6. PickupContact: pupil, name, relationship, verification data/reference, effective dates, status
const pickupContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupil: { type: mongoose.Schema.Types.ObjectId, ref: 'Pupil' },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  name: { type: String, required: true, trim: true },
  relationship: { type: String, required: true, trim: true },
  relation: { type: String, default: '' }, // alias
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  verificationData: {
    method: { type: String, default: 'Photo matched' },
    photoUrl: { type: String, default: '' },
    idDocumentGuidance: { type: String, default: 'Government photo ID check required' },
    referenceNumber: { type: String, default: '' }
  },
  verificationReference: { type: String, default: '' },
  effectiveDates: {
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null }, // null means ongoing
    until: { type: String, default: 'Ongoing' }
  },
  permissionType: { type: String, enum: ['ongoing', 'time_limited', 'one_time', 'emergency_exception'], default: 'ongoing' },
  status: { type: String, enum: ['active', 'expired', 'revoked', 'pending_approval'], default: 'active' },
  active: { type: Boolean, default: true },
  createdBy: { type: String, default: 'School Office' },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' }
}, { timestamps: true });

// 7. Card: pupil, random token hash/reference, issue/revoke timestamps, status
const cardSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupil: { type: mongoose.Schema.Types.ObjectId, ref: 'Pupil' },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  cardToken: { type: String, required: true, unique: true, index: true }, // Random, non-meaningful token (no PII)
  tokenHash: { type: String, default: null, index: true }, // SHA-256 hash reference
  tokenReference: { type: String, default: null },
  status: { type: String, enum: ['active', 'revoked', 'replaced'], default: 'active' },
  issuedAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  issuedBy: { type: String, default: 'School Administration' }
}, { timestamps: true });

// 8. StaffUser: identity, role, assigned campus, status, authentication metadata
const staffUserSchema = new mongoose.Schema({
  identity: {
    email: { type: String, lowercase: true, trim: true },
    name: { type: String, trim: true },
    employeeId: { type: String, default: '' }
  },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ['admin', 'manager', 'viewer', 'guardian', 'teacher', 'gate_staff'], default: 'viewer' },
  assignedCampus: { type: String, default: 'Primary campus' },
  status: { type: String, enum: ['active', 'inactive', 'revoked', 'suspended'], default: 'active' },
  active: { type: Boolean, default: true },
  authenticationMetadata: {
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, default: null },
    mfaEnforced: { type: Boolean, default: false },
    deviceLockEnforced: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
    passwordUpdatedAt: { type: Date, default: Date.now }
  },
  salt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  guardianId: { type: String, default: null },
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, default: null },
  mfaEnforced: { type: Boolean, default: false },
  deviceLockEnforced: { type: Boolean, default: false },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' }
}, { timestamps: true });

staffUserSchema.pre('validate', function(next) {
  if (!this.identity) this.identity = {};
  if (!this.identity.email && this.email) this.identity.email = this.email;
  if (!this.identity.name && this.name) this.identity.name = this.name;
  if (!this.authenticationMetadata) this.authenticationMetadata = {};
  if (this.authenticationMetadata.mfaEnabled === undefined) this.authenticationMetadata.mfaEnabled = Boolean(this.mfaEnabled);
  if (this.authenticationMetadata.mfaSecret === undefined) this.authenticationMetadata.mfaSecret = this.mfaSecret;
  if (this.authenticationMetadata.mfaEnforced === undefined) this.authenticationMetadata.mfaEnforced = Boolean(this.mfaEnforced);
  if (this.authenticationMetadata.deviceLockEnforced === undefined) this.authenticationMetadata.deviceLockEnforced = Boolean(this.deviceLockEnforced);
  if (!this.status) this.status = this.active ? 'active' : 'inactive';
  next();
});

// 9. Device: managed device identifier, assigned staff/campus, last seen, status
const deviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true }, // managed device identifier (e.g. DEV-001)
  managedDeviceIdentifier: { type: String, default: function() { return this.id; } },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['terminal', 'handheld', 'tablet', 'kiosk'], default: 'terminal' },
  assignedStaff: { type: String, default: '' },
  assignedCampus: { type: String, default: 'Primary campus' },
  assignedGate: { type: String, default: 'Main gate' },
  lastSeen: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'revoked', 'lost', 'maintenance'], default: 'active' },
  deviceLockEnabled: { type: Boolean, default: true },
  deviceLockPin: { type: String, default: '1234' },
  isManaged: { type: Boolean, default: true },
  isEncrypted: { type: Boolean, default: true },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' }
}, { timestamps: true });

// 10. AttendanceEvent: pupil, type, timestamps, actor, device, campus, source, collector, verification method, correction link, reason
// Avoid copying the entire pupil record into attendance logs!
const attendanceEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  pupil: { type: mongoose.Schema.Types.ObjectId, ref: 'Pupil' },
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  type: { type: String, required: true, enum: ['arrival', 'departure', 'manual_arrival', 'manual_departure', 'correction', 'authorized_exception'] },
  timestamps: {
    eventTimestampUtc: { type: Date, default: Date.now },
    deviceCapturedAt: { type: Number, default: null },
    serverReceivedAt: { type: Number, default: null }
  },
  timestamp: { type: Date, default: Date.now }, // Stored in UTC
  utcTimestamp: { type: String, default: () => new Date().toISOString() }, // Canonical UTC ISO string
  time: { type: String, required: true }, // Rendered in campus timezone
  date: { type: String, required: true }, // Rendered in campus timezone
  createdAt: { type: Number, required: true },
  actor: {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    staffName: { type: String, default: '' },
    staffEmail: { type: String, default: '' }
  },
  staff: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  device: { type: String, default: 'Primary Gate Terminal' },
  campus: { type: String, default: 'Primary campus' },
  gate: { type: String, default: 'Main gate' },
  source: { type: String, required: true, default: 'Card scan' }, // scan, search, offline
  collector: { type: String, default: null },
  verificationMethod: { type: String, default: null },
  verification: { type: String, default: null },
  correctionLink: { type: String, default: null },
  reason: { type: String, default: '' },
  correctionReason: { type: String, default: '' },
  session: { type: String, default: 'Morning Arrival' },
  alert: { type: String, default: 'Demo only' },
  manualEntry: { type: Boolean, default: false },
  clientEventId: { type: String, default: null, index: true },
  offlineQueued: { type: Boolean, default: false },
  deviceCapturedAt: { type: Number, default: null },
  serverReceivedAt: { type: Number, default: null },
  syncStatus: { type: String, enum: ['synced', 'pending_sync', 'reconciled_fallback'], default: 'synced' },
  reconciliationAuditReason: { type: String, default: '' }
}, { timestamps: true });

// 11. Notification: event, guardian, channel, provider reference, status, timestamps, failure category
// Avoid copying the entire pupil record into notification tables! Only minimal necessary references!
const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceEvent' },
  eventId: { type: String, required: true },
  guardian: { type: mongoose.Schema.Types.ObjectId, ref: 'Guardian' },
  pupilId: { type: String, required: true }, // minimal pupil ID reference only, no entire pupil record
  guardianName: { type: String, required: true },
  channel: { type: String, required: true, enum: ['SMS', 'WHATSAPP', 'PUSH', 'EMAIL', 'sms', 'whatsapp', 'push', 'email'] },
  providerReference: { type: String, default: null }, // provider reference ID
  status: { type: String, enum: ['queued', 'accepted_by_provider', 'delivered', 'failed', 'suppressed', 'Sent'], default: 'Sent' },
  timestamps: {
    queuedAt: { type: Date, default: Date.now },
    providerAcceptedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    failedAt: { type: Date, default: null }
  },
  failureCategory: { type: String, enum: ['none', 'invalid_recipient', 'network_timeout', 'provider_error', 'channel_rejected', 'rate_limit', 'suppressed'], default: 'none' },
  recipient: { type: String, required: true },
  message: { type: String, default: '' },
  sentAt: { type: String, required: true }
}, { timestamps: true });

// 12. AuditEntry: actor, action, object, timestamp, reason, before/after references as appropriate
// Avoid copying the entire pupil record into audit logs!
const auditEntrySchema = new mongoose.Schema({
  actor: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    role: { type: String, default: '' }
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  object: {
    objectType: { type: String, default: '' },
    objectId: { type: String, default: '' }
  },
  objectType: { type: String, required: true },
  objectId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  reason: { type: String, default: '' },
  beforeReference: { type: mongoose.Schema.Types.Mixed, default: null },
  afterReference: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now }
});

auditEntrySchema.pre('validate', function(next) {
  if (!this.object) this.object = {};
  if (!this.object.objectType && this.objectType) this.object.objectType = this.objectType;
  if (!this.object.objectId && this.objectId) this.object.objectId = this.objectId;
  if (!this.objectType && this.object.objectType) this.objectType = this.object.objectType;
  if (!this.objectId && this.object.objectId) this.objectId = this.object.objectId;

  if (!this.actor) this.actor = {};
  if (!this.actor.userId && this.userId) this.actor.userId = this.userId;
  if (!this.userId && this.actor.userId) this.userId = this.actor.userId;

  if (!this.timestamp && this.createdAt) this.timestamp = this.createdAt;
  next();
});

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  expiresAt: { type: Number, required: true },
  createdAt: { type: Number, required: true }
});

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

const schoolSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  val: { type: mongoose.Schema.Types.Mixed, required: true }
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

const notificationTemplateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['arrival', 'departure', 'emergency', 'manual_entry', 'general'], required: true },
  channel: { type: String, enum: ['sms', 'whatsapp', 'push', 'email', 'all'], default: 'all' },
  templateBody: { type: String, required: true },
  variables: [{ type: String }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

const escalationContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, default: '', lowercase: true, trim: true },
  priority: { type: Number, default: 1 },
  campus: { type: String, default: 'All campuses' },
  notificationChannels: [{ type: String, enum: ['sms', 'phone', 'email', 'whatsapp'] }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

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
  reportedBy: { type: String, required: true },
  reporterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  targetType: { type: String, default: '' },
  targetId: { type: String, default: '' },
  campus: { type: String, default: 'All campuses' },
  status: { type: String, enum: ['open', 'investigating', 'contained', 'resolved'], default: 'open' },
  actionTaken: { type: String, default: '' },
  escalatedTo: [{ type: String }],
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
  identifier: { type: String, default: '' },
  count: { type: Number, default: 1 },
  acknowledged: { type: Boolean, default: false },
  acknowledgedAt: { type: Date, default: null },
  acknowledgedBy: { type: String, default: null }
}, { timestamps: true });

// Models
const School = mongoose.model('School', schoolSchema);
const Campus = mongoose.model('Campus', campusSchema);
const Pupil = mongoose.model('Pupil', pupilSchema);
const Guardian = mongoose.model('Guardian', guardianSchema);
const PupilGuardian = mongoose.model('PupilGuardian', pupilGuardianSchema);
const PickupContact = mongoose.model('PickupContact', pickupContactSchema);
const Card = mongoose.model('Card', cardSchema);
const User = mongoose.model('User', staffUserSchema);
const StaffUser = User;
const Device = mongoose.model('Device', deviceSchema);
const AttendanceEvent = mongoose.model('AttendanceEvent', attendanceEventSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const AuditEntry = mongoose.model('AuditEntry', auditEntrySchema);

const Session = mongoose.model('Session', sessionSchema);
const PickupRequest = mongoose.model('PickupRequest', pickupRequestSchema);
const SchoolSetting = mongoose.model('SchoolSetting', schoolSettingSchema);
const CorrectionRequest = mongoose.model('CorrectionRequest', correctionRequestSchema);
const SchoolClass = mongoose.model('SchoolClass', schoolClassSchema);
const NotificationTemplate = mongoose.model('NotificationTemplate', notificationTemplateSchema);
const EscalationContact = mongoose.model('EscalationContact', escalationContactSchema);
const SecurityIncident = mongoose.model('SecurityIncident', securityIncidentSchema);
const SecurityAlert = mongoose.model('SecurityAlert', securityAlertSchema);

// Data Class Retention and Access Rules Definition
const DATA_CLASS_RULES = {
  School: {
    classification: 'Administrative Configuration',
    retention: 'Permanent / Maintained active',
    retentionDays: null,
    accessRoles: {
      read: ['admin', 'manager', 'viewer', 'teacher', 'gate_staff'],
      write: ['admin']
    },
    privacyMinimization: 'Contains institutional settings and policy configurations without pupil PII.'
  },
  Campus: {
    classification: 'Campus Infrastructure & Gate Config',
    retention: 'Permanent / Maintained active',
    retentionDays: null,
    accessRoles: {
      read: ['admin', 'manager', 'viewer', 'teacher', 'gate_staff'],
      write: ['admin']
    },
    privacyMinimization: 'Physical address, gate names, and timezones.'
  },
  Pupil: {
    classification: 'Pupil Identity & School Roster',
    retention: 'Active enrollment + 7 years statutory education archive',
    retentionDays: 2555,
    accessRoles: {
      read: ['admin', 'manager', 'viewer', 'teacher', 'gate_staff', 'guardian'],
      write: ['admin', 'manager']
    },
    privacyMinimization: 'Restricted to basic demographic and safety handover contacts. Entire record never duplicated into logs or notifications.'
  },
  Guardian: {
    classification: 'Guardian Contact & Channel Credentials',
    retention: 'Linked pupil enrollment duration',
    retentionDays: 2555,
    accessRoles: {
      read: ['admin', 'manager', 'guardian'],
      write: ['admin', 'manager', 'guardian']
    },
    privacyMinimization: 'Verified channel contacts and channel preferences. Scoped strictly to linked pupils.'
  },
  PupilGuardian: {
    classification: 'Legal Relationship & Authority Metadata',
    retention: 'Statutory pupil safety record retention (7 years post-withdrawal)',
    retentionDays: 2555,
    accessRoles: {
      read: ['admin', 'manager', 'guardian'],
      write: ['admin']
    },
    privacyMinimization: 'Legal status and custody references approved by school authority.'
  },
  PickupContact: {
    classification: 'Authorized Collector & Verification Reference',
    retention: 'Effective authorization window + 365 days audit retention',
    retentionDays: 365,
    accessRoles: {
      read: ['admin', 'manager', 'gate_staff', 'guardian'],
      write: ['admin', 'manager']
    },
    privacyMinimization: 'Collector verification guidance without unnecessary sensitive personal data.'
  },
  Card: {
    classification: 'Random Security Lookup Token',
    retention: 'Active card lifecycle + 180 days post-revocation',
    retentionDays: 180,
    accessRoles: {
      read: ['admin', 'manager', 'gate_staff'],
      write: ['admin']
    },
    privacyMinimization: 'Random non-meaningful tokens. Strictly zero PII encoded in QR tokens.'
  },
  StaffUser: {
    classification: 'Staff Account & Authentication Metadata',
    retention: 'Active employment + 365 days post-revocation',
    retentionDays: 365,
    accessRoles: {
      read: ['admin'],
      write: ['admin']
    },
    privacyMinimization: 'Hashed credentials, MFA secrets, and role boundaries with immediate session revocation.'
  },
  Device: {
    classification: 'Managed Gate Hardware Terminal',
    retention: 'Active terminal lifecycle + 365 days audit log',
    retentionDays: 365,
    accessRoles: {
      read: ['admin', 'manager'],
      write: ['admin']
    },
    privacyMinimization: 'Terminal identifier, encryption status, and lock PINs.'
  },
  AttendanceEvent: {
    classification: 'Arrival & Departure Event History',
    retention: 'Configurable school retention policy (default 365 days)',
    retentionDays: 365,
    accessRoles: {
      read: ['admin', 'manager', 'viewer', 'teacher', 'gate_staff', 'guardian'],
      write: ['admin', 'manager', 'gate_staff']
    },
    privacyMinimization: 'UTC timestamps, actor, device, gate, collector name, verification method. Original events preserved in corrections without destructive overwrite.'
  },
  Notification: {
    classification: 'Alert Dispatch & Delivery Receipts',
    retention: '90 days operational retention',
    retentionDays: 90,
    accessRoles: {
      read: ['admin', 'manager', 'guardian'],
      write: ['admin', 'system']
    },
    privacyMinimization: 'Contains only eventId, channel, recipient contact, provider ref, and minimal privacy-safe message text. Pupil records are not copied.'
  },
  AuditEntry: {
    classification: 'Immutable Security & Governance Audit Trail',
    retention: 'Configurable statutory audit retention (default 730 days)',
    retentionDays: 730,
    accessRoles: {
      read: ['admin'],
      write: ['admin', 'system']
    },
    privacyMinimization: 'Actor, action, object type/id, reason, and selective diff references. Full pupil records are never cloned into audit logs.'
  }
};

module.exports = {
  School,
  Campus,
  Pupil,
  Guardian,
  PupilGuardian,
  PickupContact,
  Card,
  StaffUser,
  User,
  Device,
  AttendanceEvent,
  Notification,
  AuditEntry,
  Session,
  PickupRequest,
  SchoolSetting,
  CorrectionRequest,
  SchoolClass,
  NotificationTemplate,
  EscalationContact,
  SecurityIncident,
  SecurityAlert,
  DATA_CLASS_RULES
};
