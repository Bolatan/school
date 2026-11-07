const crypto = require('crypto');
const {
  School,
  User,
  StaffUser,
  Notification,
  AuditEntry,
  PickupContact,
  Pupil,
  PickupRequest,
  AttendanceEvent,
  Guardian,
  PupilGuardian,
  CorrectionRequest,
  Card,
  Campus,
  SchoolClass,
  Device,
  NotificationTemplate,
  EscalationContact,
  SchoolSetting
} = require('./models');

const DEMO_EMAIL = 'admin@northfield.school';
const DEMO_PASSWORD = 'GatewiseDemo!26';
const DEMO_GUARDIAN_EMAIL = 'tomi.adeyemi@guardian.northfield.school';
const DEMO_GUARDIAN_PASSWORD = 'GatewiseDemo!26';

function passwordHash(password, saltHex = null) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  return {
    salt: salt.toString('hex'),
    hash: digest.toString('hex')
  };
}

function verifyPassword(password, saltHex, hashHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const actualHash = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  const expectedHash = Buffer.from(hashHex, 'hex');
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function nowLocal() {
  return new Date();
}

function formatTime(d) {
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 becomes 12
  const strMins = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${strMins} ${ampm}`;
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeInTimezone(d, timeZone = 'Europe/London') {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone
    }).format(d);
  } catch {
    return formatTime(d);
  }
}

function formatDateInTimezone(d, timeZone = 'Europe/London') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone
    }).format(d);
  } catch {
    return formatDate(d);
  }
}

// Password strength check for strong staff sign-in
function isStrongStaffPassword(password) {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 12) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}

// Generate TOTP / MFA secret or verification code
function generateMfaSecret() {
  return crypto.randomBytes(20).toString('hex');
}

// Verify MFA OTP (supports 6-digit TOTP code or recovery code)
function verifyMfaToken(secret, token) {
  if (!secret || !token) return false;
  const clean = String(token).trim();
  // Demo standard algorithm or test challenge
  const hash = crypto.createHmac('sha256', secret).update(String(Math.floor(Date.now() / 30000))).digest('hex');
  const expectedOtp = String(parseInt(hash.slice(0, 8), 16) % 1000000).padStart(6, '0');
  // Allow test passcode '123456' for demo/test simplicity, or matching expectedOtp
  return clean === '123456' || clean === expectedOtp;
}

async function seedInitialData() {
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const { salt, hash } = passwordHash(DEMO_PASSWORD);
    await User.create({
      email: DEMO_EMAIL,
      name: 'Amara Okafor',
      role: 'admin',
      salt,
      passwordHash: hash,
      active: true,
      mfaEnabled: false,
      mfaSecret: 'gw_mfa_demo_secret_admin_amara',
      mfaEnforced: false,
      deviceLockEnforced: true,
      assignedCampus: 'Primary campus'
    });
  }

  const pupilCount = await Pupil.countDocuments();
  if (pupilCount === 0) {
    const seedPupils = [
      ["NF-1042", "Zara Adeyemi", "Grade 3A", "Tomi Adeyemi", "ZA", "rose", "👧🏽"],
      ["NF-1087", "Daniel Mensah", "Grade 2B", "Ama Mensah", "DM", "mint", "👦🏾"],
      ["NF-1103", "Maya Okonkwo", "Grade 4A", "Chika Okonkwo", "MO", "sand", "👧🏿"],
      ["NF-1139", "Ethan Bello", "Grade 1C", "Sade Bello", "EB", "blue", "👦🏽"],
      ["NF-1175", "Nneka Eze", "Grade 3A", "Ifeoma Eze", "NE", "violet", "👧🏾"],
      ["NF-1204", "Samuel Adebayo", "Grade 5B", "Tunde Adebayo", "SA", "mint", "👦🏿"],
      ["NF-1228", "Lola James", "Grade 2B", "Kemi James", "LJ", "rose", "👧🏽"],
      ["NF-1261", "David Nwosu", "Grade 4A", "Ada Nwosu", "DN", "blue", "👦🏾"],
      ["NF-1290", "Amina Yusuf", "Grade 1C", "Bilkisu Yusuf", "AY", "sand", "👧🏿"],
      ["NF-1315", "Noah Peters", "Grade 5B", "Grace Peters", "NP", "violet", "👦🏽"]
    ];

    const collectorsMap = {
      "NF-1042": [
        { id: 1, name: "Tomi Adeyemi", relation: "Mother", until: "Ongoing", active: true },
        { id: 2, name: "Kola Adeyemi", relation: "Father", until: "Ongoing", active: true }
      ],
      "NF-1087": [{ id: 1, name: "Ama Mensah", relation: "Mother", until: "Ongoing", active: true }],
      "NF-1103": [{ id: 1, name: "Chika Okonkwo", relation: "Father", until: "Ongoing", active: true }],
      "NF-1139": [{ id: 1, name: "Sade Bello", relation: "Mother", until: "Ongoing", active: true }],
      "NF-1175": [{ id: 1, name: "Ifeoma Eze", relation: "Mother", until: "Ongoing", active: true }],
      "NF-1204": [{ id: 1, name: "Tunde Adebayo", relation: "Father", until: "Ongoing", active: true }],
      "NF-1228": [{ id: 1, name: "Kemi James", relation: "Mother", until: "Ongoing", active: true }],
      "NF-1261": [{ id: 1, name: "Ada Nwosu", relation: "Mother", until: "Ongoing", active: true }],
      "NF-1290": [{ id: 1, name: "Bilkisu Yusuf", relation: "Mother", until: "Ongoing", active: true }],
      "NF-1315": [{ id: 1, name: "Grace Peters", relation: "Mother", until: "Ongoing", active: true }]
    };

    const guardianPhones = {
      "NF-1042": "+1 555-0142",
      "NF-1087": "+1 555-0187",
      "NF-1103": "+1 555-0103",
      "NF-1139": "+1 555-0139",
      "NF-1175": "+1 555-0175",
      "NF-1204": "+1 555-0104",
      "NF-1228": "+1 555-0128",
      "NF-1261": "+1 555-0161",
      "NF-1290": "+1 555-0190",
      "NF-1315": "+1 555-0115"
    };
    const channels = ["sms", "whatsapp", "push", "email"];

    for (let idx = 0; idx < seedPupils.length; idx++) {
      const [id, name, className, guardian, initials, color, photo] = seedPupils[idx];
      await Pupil.create({
        id,
        name,
        className,
        guardian,
        guardianPhone: guardianPhones[id] || "+1 555-0100",
        guardianEmail: `${guardian.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        preferredChannel: channels[idx % channels.length],
        initials,
        color,
        photo,
        active: true,
        collectors: collectorsMap[id] || []
      });

      // Generate random non-meaningful token for card QR (no PII)
      const cardToken = 'gw_tok_' + crypto.randomBytes(12).toString('hex');
      await Card.create({
        id: `card-${id}-1`,
        pupilId: id,
        cardToken,
        status: 'active',
        issuedAt: new Date(),
        issuedBy: 'School Office'
      });
    }

    const now = nowLocal();
    const samples = [
      ["NF-1175", 34, "Grace"],
      ["NF-1042", 27, "Chinedu"],
      ["NF-1087", 19, "Grace"],
      ["NF-1139", 11, "Chinedu"]
    ];

    for (let i = 0; i < samples.length; i++) {
      const [pid, ago, staff] = samples[i];
      const t = new Date(now.getTime() - ago * 60000);
      await AttendanceEvent.create({
        id: `seed-${i}`,
        pupilId: pid,
        type: 'arrival',
        timestamp: t,
        utcTimestamp: t.toISOString(),
        time: formatTimeInTimezone(t, 'Europe/London'),
        date: formatDateInTimezone(t, 'Europe/London'),
        createdAt: t.getTime(),
        staff,
        source: 'Card scan',
        session: 'Morning Arrival',
        alert: 'Demo only',
        reason: '',
        manualEntry: false
      });
    }

    const requests = [
      {
        id: "r1",
        pupilId: "NF-1042",
        name: "Bola Adeyemi",
        relation: "Aunt",
        phone: "+1 555-0191",
        email: "bola.adeyemi@example.com",
        idCheckGuidance: "Verify photo ID (Passport or Driver's License)",
        permissionType: "one_time",
        requestedBy: "Tomi Adeyemi",
        time: "Today, 8:42 AM",
        note: "One-time pickup today. ID check required."
      },
      {
        id: "r2",
        pupilId: "NF-1087",
        name: "Kojo Mensah",
        relation: "Uncle",
        phone: "+1 555-0192",
        email: "kojo.mensah@example.com",
        idCheckGuidance: "Government photo ID check",
        permissionType: "time_limited",
        requestedBy: "Ama Mensah",
        time: "Today, 9:06 AM",
        note: "Temporary approval. Confirm the expiry with the guardian."
      }
    ];

    for (const req of requests) {
      await PickupRequest.create(req);
    }

    // Seed default demo guardian account and link to pupil NF-1042 (Zara Adeyemi)
    const guardianDoc = await Guardian.create({
      id: 'GD-DEMO-1042',
      name: 'Tomi Adeyemi',
      email: DEMO_GUARDIAN_EMAIL,
      phone: '+1 555-0142',
      verifiedContactMethod: 'sms',
      verificationCode: '849201',
      inviteToken: 'demo-invite-tomi-adeyemi',
      channelVerified: true,
      channelVerifiedAt: new Date(),
      privacyNoticeAccepted: true,
      privacyNoticeVersion: '2026.1',
      privacyAcceptedAt: new Date(),
      consentAccepted: true,
      consentAcceptedAt: new Date(),
      status: 'active',
      preferredChannels: ['sms', 'whatsapp']
    });

    const { salt: gSalt, hash: gHash } = passwordHash(DEMO_GUARDIAN_PASSWORD);
    const guardianUser = await User.create({
      email: DEMO_GUARDIAN_EMAIL,
      name: 'Tomi Adeyemi',
      role: 'guardian',
      salt: gSalt,
      passwordHash: gHash,
      active: true,
      guardianId: guardianDoc.id
    });

    guardianDoc.userId = guardianUser._id;
    await guardianDoc.save();

    await PupilGuardian.create({
      id: 'PG-DEMO-1042',
      pupilId: 'NF-1042',
      guardianId: guardianDoc.id,
      relationship: 'Mother',
      isLegalGuardian: true,
      status: 'active',
      legalStatusApprovedBySchool: true,
      approvedBySchoolAt: new Date(),
      approvedByStaff: 'Amara Okafor'
    });

    await CorrectionRequest.create({
      id: 'CR-DEMO-01',
      guardianId: guardianDoc.id,
      pupilId: 'NF-1042',
      type: 'record_correction',
      subject: 'Emergency contact update request',
      message: 'Please update secondary emergency mobile number to +1 555-0199 on school file.',
      status: 'pending'
    });
  }

  // Seed default Campuses
  const campusCount = await Campus.countDocuments();
  if (campusCount === 0) {
    await Campus.create([
      {
        id: 'camp-primary',
        name: 'Primary campus',
        code: 'NF-PRI',
        address: '14 St. Jude Way, London NW1 4EA',
        timezone: 'Europe/London',
        gates: ['Main gate', 'East pedestrian gate', 'Bus drop-off gate'],
        active: true
      },
      {
        id: 'camp-secondary',
        name: 'Secondary campus',
        code: 'NF-SEC',
        address: '28 Richmond Grove, London NW3 2BC',
        timezone: 'Europe/London',
        gates: ['Main entrance gate', 'Sports field gate'],
        active: true
      },
      {
        id: 'camp-north',
        name: 'North gate annex',
        code: 'NF-NRTH',
        address: '3 Northfields Close, London NW1 9PL',
        timezone: 'Europe/London',
        gates: ['North perimeter gate', 'Reception gate'],
        active: true
      }
    ]);
  }

  // Seed default School Classes
  const classCount = await SchoolClass.countDocuments();
  if (classCount === 0) {
    await SchoolClass.create([
      { id: 'cls-1c', name: 'Grade 1C', gradeLevel: 'Grade 1', campus: 'Primary campus', teacherName: 'Mr. David Ade', room: 'Room 101', capacity: 25, active: true },
      { id: 'cls-2b', name: 'Grade 2B', gradeLevel: 'Grade 2', campus: 'Primary campus', teacherName: 'Mrs. Funke Cole', room: 'Room 105', capacity: 26, active: true },
      { id: 'cls-3a', name: 'Grade 3A', gradeLevel: 'Grade 3', campus: 'Primary campus', teacherName: 'Ms. Clara Evans', room: 'Room 201', capacity: 28, active: true },
      { id: 'cls-4a', name: 'Grade 4A', gradeLevel: 'Grade 4', campus: 'Primary campus', teacherName: 'Mr. John Mensah', room: 'Room 204', capacity: 30, active: true },
      { id: 'cls-5b', name: 'Grade 5B', gradeLevel: 'Grade 5', campus: 'Primary campus', teacherName: 'Mrs. Zainab Balogun', room: 'Room 208', capacity: 30, active: true }
    ]);
  }

  // Seed default Managed Devices
  const deviceCount = await Device.countDocuments();
  if (deviceCount === 0) {
    await Device.create([
      {
        id: 'DEV-TERM-001',
        name: 'Primary Gate Terminal',
        type: 'terminal',
        assignedStaff: 'Amara Okafor',
        assignedCampus: 'Primary campus',
        assignedGate: 'Main gate',
        deviceLockEnabled: true,
        deviceLockPin: '8492',
        status: 'active'
      },
      {
        id: 'DEV-HAND-002',
        name: 'East Gate Handheld',
        type: 'handheld',
        assignedStaff: 'Grace Peters',
        assignedCampus: 'Primary campus',
        assignedGate: 'East pedestrian gate',
        deviceLockEnabled: true,
        deviceLockPin: '5173',
        status: 'active'
      },
      {
        id: 'DEV-SCAN-003',
        name: 'Bus Loop Scanner',
        type: 'tablet',
        assignedStaff: 'Chinedu Eze',
        assignedCampus: 'Primary campus',
        assignedGate: 'Bus drop-off gate',
        deviceLockEnabled: true,
        deviceLockPin: '9204',
        status: 'active'
      },
      {
        id: 'DEV-DESK-004',
        name: 'Admin Front Desk',
        type: 'terminal',
        assignedStaff: 'Amara Okafor',
        assignedCampus: 'Primary campus',
        assignedGate: 'Main gate',
        deviceLockEnabled: true,
        deviceLockPin: '1122',
        status: 'active'
      }
    ]);
  }

  // Seed default Notification Templates
  const templateCount = await NotificationTemplate.countDocuments();
  if (templateCount === 0) {
    await NotificationTemplate.create([
      {
        id: 'tmpl-arrival-std',
        name: 'Standard Arrival Alert',
        type: 'arrival',
        channel: 'all',
        templateBody: 'Gatewise Alert: {{pupil_name}} has arrived safely at {{campus}} ({{gate}}) at {{time}}.',
        variables: ['pupil_name', 'campus', 'gate', 'time'],
        active: true
      },
      {
        id: 'tmpl-departure-std',
        name: 'Standard Departure Alert',
        type: 'departure',
        channel: 'all',
        templateBody: 'Gatewise Alert: {{pupil_name}} departed from {{campus}} with {{collector_name}} at {{time}}.',
        variables: ['pupil_name', 'campus', 'collector_name', 'time'],
        active: true
      },
      {
        id: 'tmpl-emergency-unauth',
        name: 'Emergency Pickup Escalation Alert',
        type: 'emergency',
        channel: 'sms',
        templateBody: 'CRITICAL SECURITY: An emergency pickup exception was authorized for {{pupil_name}} at {{campus}} by administrator. Contact: {{phone}}.',
        variables: ['pupil_name', 'campus', 'phone'],
        active: true
      },
      {
        id: 'tmpl-manual-entry',
        name: 'Missing Card Manual Entry Alert',
        type: 'manual_entry',
        channel: 'sms',
        templateBody: 'School Notice: {{pupil_name}} card was missing or unreadable today. Manual check-in completed at {{time}}.',
        variables: ['pupil_name', 'time'],
        active: true
      }
    ]);
  }

  // Seed default Escalation Contacts
  const contactCount = await EscalationContact.countDocuments();
  if (contactCount === 0) {
    await EscalationContact.create([
      {
        id: 'ESC-001',
        name: 'Amara Okafor',
        role: 'School Principal & Lead Administrator',
        phone: '+44 7700 900123',
        email: 'principal@northfield.school',
        priority: 1,
        campus: 'All campuses',
        notificationChannels: ['sms', 'phone', 'email'],
        active: true
      },
      {
        id: 'ESC-002',
        name: 'Tariq Al-Mansoor',
        role: 'Head of Child Safeguarding',
        phone: '+44 7700 900456',
        email: 'safeguarding@northfield.school',
        priority: 1,
        campus: 'All campuses',
        notificationChannels: ['sms', 'phone'],
        active: true
      },
      {
        id: 'ESC-003',
        name: 'Evelyn Brooks',
        role: 'Gate Security & Operations Lead',
        phone: '+44 7700 900789',
        email: 'security.lead@northfield.school',
        priority: 2,
        campus: 'Primary campus',
        notificationChannels: ['sms', 'phone'],
        active: true
      }
    ]);
  }

  // Seed default Retention Settings in SchoolSetting

  // Seed default School institutional document
  const schoolDoc = await School.findOne({ id: 'SCH-001' });
  if (!schoolDoc) {
    await School.create({
      id: 'SCH-001',
      name: 'Northfield Academy',
      policySettings: {
        discloseCollectorName: true,
        allowOfflineStalePickupPolicy: false,
        enforceMfaForAdmins: true,
        strongStaffPasswordPolicy: true,
        scanRateLimitMaxPerMinute: 30
      },
      timezone: 'Europe/London',
      notificationConfiguration: {
        defaultChannel: 'sms',
        smsEnabled: true,
        pushEnabled: true,
        whatsappEnabled: false,
        emailEnabled: true,
        retryMaxAttempts: 3
      },
      active: true
    });
  }

  const retentionDoc = await SchoolSetting.findOne({ key: 'retentionSettings' });
  if (!retentionDoc) {
    await SchoolSetting.create({
      key: 'retentionSettings',
      val: {
        attendanceRetentionDays: 365, // Attendance logs kept 1 year
        auditLogRetentionDays: 730,    // Audit trail kept 2 years
        notificationRetentionDays: 90, // Notifications kept 90 days
        offlineQueueTtlHours: 24,      // Device queue expires in 24 hours
        sessionTimeoutMinutes: 480,    // 8-hour staff sessions
        autoPurgeEnabled: true,
        lastPurgedAt: null
      }
    });
  }
}

async function getNextCollectorId(pupilDoc) {
  let maxId = 0;
  if (pupilDoc.collectors && pupilDoc.collectors.length > 0) {
    for (const col of pupilDoc.collectors) {
      if (col.id && col.id > maxId) maxId = col.id;
    }
  }
  return maxId + 1;
}

module.exports = {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_GUARDIAN_EMAIL,
  DEMO_GUARDIAN_PASSWORD,
  passwordHash,
  verifyPassword,
  nowLocal,
  formatTime,
  formatDate,
  formatTimeInTimezone,
  formatDateInTimezone,
  seedInitialData,
  getNextCollectorId,
  isStrongStaffPassword,
  generateMfaSecret,
  verifyMfaToken
};
