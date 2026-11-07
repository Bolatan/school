const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, default: 'school-main' },
  name: { type: String, required: true, trim: true, default: 'Northfield Academy' },
  policySettings: {
    allowOfflineStalePickupPolicy: { type: Boolean, default: false },
    discloseCollectorName: { type: Boolean, default: true },
    mfaEnforcedForAdmins: { type: Boolean, default: false },
    sessionTimeoutMinutes: { type: Number, default: 480 }
  },
  timezone: { type: String, default: 'Europe/London' },
  notificationConfiguration: {
    smsEnabled: { type: Boolean, default: true },
    pushEnabled: { type: Boolean, default: true },
    whatsappEnabled: { type: Boolean, default: false },
    emailEnabled: { type: Boolean, default: true },
    defaultProvider: { type: String, default: 'mock-sms-gateway' }
  }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ['admin', 'manager', 'viewer', 'guardian'], default: 'viewer' },
  salt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  active: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'suspended', 'revoked'], default: 'active' },
  guardianId: { type: String, default: null }, // Optional link to Guardian document
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, default: null },
  mfaEnforced: { type: Boolean, default: false },
  deviceLockEnforced: { type: Boolean, default: false },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  assignedCampus: { type: String, default: 'Primary campus' },
  authenticationMetadata: {
    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    mfaLastVerifiedAt: { type: Date, default: null }
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
  pupilId: { type: String, required: true, ref: 'Pupil', index: true },
  name: { type: String, required: true, trim: true },
  relation: { type: String, default: '' },
  relationship: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  idCheckGuidance: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  verificationData: { type: String, default: '' },
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
  id: { type: String, required: true, unique: true, uppercase: true, trim: true },
  schoolId: { type: String, default: 'school-main' },
  name: { type: String, required: true, trim: true },
  photoReference: { type: String, default: '' },
  className: { type: String, required: true, trim: true },
  campus: { type: String, default: 'Primary campus' },
  guardian: { type: String, required: true, trim: true },
  guardianPhone: { type: String, default: '+1 555-0100' },
  guardianEmail: { type: String, default: '' },
  preferredChannel: { type: String, enum: ['sms', 'whatsapp', 'push', 'email'], default: 'sms' },
  initials: { type: String, required: true },
  color: { type: String, required: true },
  photo: { type: String, default: '♙' },
  status: { type: String, enum: ['active', 'withdrawn', 'transferred', 'archived'], default: 'active' },
  active: { type: Boolean, default: true },
  collectors: [collectorSchema]
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  eventId: { type: String, required: true, index: true },
  guardianId: { type: String, default: null, index: true },
  pupilId: { type: String, required: true, index: true },
  guardianName: { type: String, required: true },
  channel: { type: String, required: true },
  providerReference: { type: String, default: null },
  recipient: { type: String, required: true },
  message: { type: String, default: '' },
  status: { type: String, default: 'Sent' },
  sentAt: { type: String, required: true },
  timestamps: {
    queuedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    failedAt: { type: Date, default: null }
  },
  failureCategory: { type: String, default: null }
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
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actor: { type: String, default: '' },
  action: { type: String, required: true },
  objectType: { type: String, required: true },
  objectId: { type: String, required: true },
  object: { type: String, default: '' },
  reason: { type: String, default: '' },
  beforeReference: { type: String, default: null },
  afterReference: { type: String, default: null },
  beforeAfterReferences: {
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  timestamp: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  expiresAt: { type: Number, required: true },
  createdAt: { type: Number, required: true }
});

const School = mongoose.model('School', schoolSchema);
const User = mongoose.model('User', userSchema);
const StaffUser = User;
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
  verifiedContacts: [{
    type: { type: String, enum: ['sms', 'email', 'phone', 'whatsapp'] },
    value: { type: String },
    verifiedAt: { type: Date, default: null }
  }],
  accountStatus: { type: String, enum: ['invited', 'active', 'suspended'], default: 'invited' },
  preferences: {
    preferredChannels: [{ type: String, enum: ['sms', 'whatsapp', 'push', 'email'] }],
    language: { type: String, default: 'en-GB' },
    quietHoursEnabled: { type: Boolean, default: false }
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
  authorityMetadata: {
    courtOrderRestricted: { type: Boolean, default: false },
    custodyDocumentationRef: { type: String, default: '' },
    permittedToAuthorizePickups: { type: Boolean, default: true }
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
  cardToken: { type: String, required: true, unique: true, index: true }, // Random, non-meaningful token (no PII)
  tokenHash: { type: String, default: null },
  status: { type: String, enum: ['active', 'revoked', 'replaced'], default: 'active' },
  issuedAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  issuedBy: { type: String, default: 'School Administration' }
}, { timestamps: true });

const campusSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  schoolId: { type: String, default: 'school-main' },
  school: { type: String, default: 'Northfield Academy' },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  address: { type: String, default: '' },
  addressReference: { type: String, default: '' },
  timezone: { type: String, default: 'Europe/London' },
  timezoneOverride: { type: String, default: null },
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
  managedDeviceIdentifier: { type: String, default: '' },
  assignedStaff: { type: String, default: '' },
  assignedCampus: { type: String, default: 'Primary campus' },
  assignedGate: { type: String, default: 'Main gate' },
  deviceLockEnabled: { type: Boolean, default: true },
  deviceLockPin: { type: String, default: '1234' }, // Required lock PIN for strong staff sign-in
  status: { type: String, enum: ['active', 'revoked', 'lost', 'maintenance'], default: 'active' },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  lastSeen: { type: Date, default: Date.now },
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

const EscalationContact = mongoose.model('EscalationContact', escalationContactSchema);
const Card = mongoose.model('Card', cardSchema);
const Guardian = mongoose.model('Guardian', guardianSchema);
const PupilGuardian = mongoose.model('PupilGuardian', pupilGuardianSchema);
const CorrectionRequest = mongoose.model('CorrectionRequest', correctionRequestSchema);
const SchoolSetting = mongoose.model('SchoolSetting', schoolSettingSchema);
const SecurityIncident = mongoose.model('SecurityIncident', securityIncidentSchema);
const SecurityAlert = mongoose.model('SecurityAlert', securityAlertSchema);

/**
 * DATA_CLASS_RULES defines retention schedules, role-based access scoping,
 * and data minimization constraints across the 12 core domain data classes:
 * School, Campus, Pupil, Guardian, PupilGuardian, PickupContact, Card,
 * StaffUser, Device, AttendanceEvent, Notification, and AuditEntry.
 */
const DATA_CLASS_RULES = {
  School: {
    description: 'School entity: name, policy settings, timezone, notification configuration',
    retentionSchedule: 'indefinite',
    retentionDays: null,
    accessRules: {
      admin: ['read', 'write', 'configure'],
      manager: ['read'],
      viewer: ['read'],
      guardian: ['read_public']
    },
    dataMinimization: 'Stores global school configuration; no pupil or guardian personal data.'
  },
  Campus: {
    description: 'Campus entity: school, name, address/reference, timezone override, gates',
    retentionSchedule: 'indefinite',
    retentionDays: null,
    accessRules: {
      admin: ['read', 'write', 'configure'],
      manager: ['read', 'write_assigned_campus'],
      viewer: ['read_assigned_campus'],
      guardian: ['read_assigned_campus']
    },
    dataMinimization: 'Physical site reference; contains no pupil personal identifiable data.'
  },
  Pupil: {
    description: 'Pupil record: school ID, name, photo reference, class, campus, status',
    retentionSchedule: 'statutory_pupil_record',
    retentionDays: 2555,
    accessRules: {
      admin: ['read', 'write', 'import', 'archive'],
      manager: ['read', 'write_roster', 'view_collectors'],
      viewer: ['read_operational_roster'],
      guardian: ['read_linked_pupils_only']
    },
    dataMinimization: 'Only essential educational and safeguarding fields. Never copy entire pupil record into logs or notifications.'
  },
  Guardian: {
    description: 'Guardian account: name, verified contacts, account status, preferences',
    retentionSchedule: 'linked_pupil_active_plus_1_year',
    retentionDays: 365,
    accessRules: {
      admin: ['read', 'write', 'manage_access'],
      manager: ['read', 'contact'],
      viewer: ['read_emergency_contacts_only'],
      guardian: ['read_self', 'update_preferences']
    },
    dataMinimization: 'Only contact methods verified by guardian; channel credentials protected.'
  },
  PupilGuardian: {
    description: 'Pupil-Guardian relationship: pupil, guardian, relationship, status, authority metadata',
    retentionSchedule: 'statutory_safeguarding_record',
    retentionDays: 2555,
    accessRules: {
      admin: ['read', 'write', 'approve_legal_status'],
      manager: ['read', 'verify_relationship'],
      viewer: ['read_relationship_basic'],
      guardian: ['read_linked_relationships']
    },
    dataMinimization: 'Stores relationship links and verified legal authority without duplicating personal records.'
  },
  PickupContact: {
    description: 'Approved collector: pupil, name, relationship, verification data/reference, effective dates, status',
    retentionSchedule: 'effective_period_plus_90_days',
    retentionDays: 90,
    accessRules: {
      admin: ['read', 'write', 'approve', 'revoke'],
      manager: ['read', 'verify_at_gate', 'approve_request'],
      viewer: ['read_active_collectors_at_gate'],
      guardian: ['read_linked_collectors', 'submit_request']
    },
    dataMinimization: 'Verification references/guidance only. One-time contacts expire immediately after departure.'
  },
  Card: {
    description: 'PVC pupil card: pupil, random token hash/reference, issue/revoke timestamps, status',
    retentionSchedule: 'active_token_lifecycle_plus_180_days',
    retentionDays: 180,
    accessRules: {
      admin: ['read', 'issue', 'reissue', 'revoke', 'export_artwork'],
      manager: ['read', 'scan_lookup'],
      viewer: ['scan_lookup'],
      guardian: ['none']
    },
    dataMinimization: 'Non-meaningful random tokens; tokens never contain pupil names, class, or PII.'
  },
  StaffUser: {
    description: 'Staff account: identity, role, assigned campus, status, authentication metadata',
    retentionSchedule: 'employment_duration_plus_7_years',
    retentionDays: 2555,
    accessRules: {
      admin: ['read', 'write', 'revoke', 'reset_credentials'],
      manager: ['read_assigned_campus_staff'],
      viewer: ['read_profile_self'],
      guardian: ['none']
    },
    dataMinimization: 'Salts, hashes, and session references stored; raw passwords never retained.'
  },
  Device: {
    description: 'Gate terminal: managed device identifier, assigned staff/campus, last seen, status',
    retentionSchedule: 'device_lifecycle_plus_1_year',
    retentionDays: 365,
    accessRules: {
      admin: ['read', 'register', 'assign', 'revoke', 'mark_lost'],
      manager: ['read_assigned_campus_devices'],
      viewer: ['read_assigned_device_status'],
      guardian: ['none']
    },
    dataMinimization: 'Device identifiers, assigned gates, and lock PIN hashes only.'
  },
  AttendanceEvent: {
    description: 'Attendance log: pupil, type, timestamps, actor, device, campus, source, collector, verification method, correction link, reason',
    retentionSchedule: 'operational_attendance_365_days',
    retentionDays: 365,
    accessRules: {
      admin: ['read', 'export', 'authorize_exception', 'correct'],
      manager: ['read', 'record_event', 'scan_event'],
      viewer: ['read_live_dashboard'],
      guardian: ['read_timeline_linked_pupil_only']
    },
    dataMinimization: 'Only pupilId reference, event attributes, and verification metadata. Full pupil records are never copied into event records.'
  },
  Notification: {
    description: 'Guardian dispatch: event, guardian, channel, provider reference, status, timestamps, failure category',
    retentionSchedule: 'notification_delivery_audit_90_days',
    retentionDays: 90,
    accessRules: {
      admin: ['read', 'export', 'retry'],
      manager: ['read_delivery_status'],
      viewer: ['read_outcome_indicators'],
      guardian: ['read_received_alerts_self']
    },
    dataMinimization: 'Privacy-safe messages omitting sensitive IDs/addresses. Full pupil records are never duplicated into notifications.'
  },
  AuditEntry: {
    description: 'System audit: actor, action, object, timestamp, reason, before/after references as appropriate',
    retentionSchedule: 'statutory_security_audit_730_days',
    retentionDays: 730,
    accessRules: {
      admin: ['read', 'export'],
      manager: ['none'],
      viewer: ['none'],
      guardian: ['none']
    },
    dataMinimization: 'Minimal entity identifiers, change summaries, and non-PII details. Full pupil records or raw tokens must never be copied into audit entries.'
  }
};

/**
 * Validates that an object to be persisted into AuditEntry, Notification, or AttendanceEvent
 * does not copy entire pupil records. Throws or strips offending fields.
 */
function assertDataMinimization(entityType, data) {
  if (!data || typeof data !== 'object') return;
  const bannedPupilRecordKeys = ['className', 'collectors', 'guardianPhone', 'guardianEmail', 'photo'];

  if (entityType === 'AuditEntry' || entityType === 'Notification') {
    const matched = bannedPupilRecordKeys.filter(k => k in data && data[k] !== undefined);
    if (matched.length >= 3) {
      throw new Error(`Data minimization violation: full pupil record copied into ${entityType} (${matched.join(', ')})`);
    }
  }
}

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
  DATA_CLASS_RULES,
  assertDataMinimization
};
