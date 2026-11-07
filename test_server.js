const test = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app, seedInitialData } = require('./server');
const {
  School,
  User,
  StaffUser,
  Pupil,
  PickupRequest,
  PickupContact,
  AttendanceEvent,
  Notification,
  AuditEntry,
  Guardian,
  PupilGuardian,
  CorrectionRequest,
  Card,
  Campus,
  Device,
  SecurityIncident,
  SecurityAlert,
  DATA_CLASS_RULES,
  assertDataMinimization
} = require('./models');
const { DEMO_EMAIL, DEMO_PASSWORD, DEMO_GUARDIAN_EMAIL, DEMO_GUARDIAN_PASSWORD } = require('./authUtils');

let mongod;
let request;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  await seedInitialData();
  request = supertest(app);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function login(email = DEMO_EMAIL, password = DEMO_PASSWORD) {
  const res = await request
    .post('/api/login')
    .send({ email, password });
  assert.equal(res.status, 200);
  if (res.body.requiresMfa && res.body.mfaChallengeToken) {
    const mfaRes = await request
      .post('/api/login/mfa-verify')
      .send({
        mfaChallengeToken: res.body.mfaChallengeToken,
        mfaToken: '123456'
      });
    return mfaRes.headers['set-cookie'][0];
  }
  const cookie = res.headers['set-cookie'][0];
  return cookie;
}

test('Authentication: login success and logout', async () => {
  const cookie = await login();
  assert.ok(cookie.includes('gw_session'));

  const meRes = await request
    .get('/api/me')
    .set('Cookie', cookie);
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.email, DEMO_EMAIL);

  const logoutRes = await request
    .post('/api/logout')
    .set('Cookie', cookie);
  assert.equal(logoutRes.status, 200);

  const meAfterLogout = await request
    .get('/api/me')
    .set('Cookie', cookie);
  assert.equal(meAfterLogout.body.user, null);
});

test('Authentication: seeded demo guardian login and portal access', async () => {
  const cookie = await login(DEMO_GUARDIAN_EMAIL, DEMO_GUARDIAN_PASSWORD);
  assert.ok(cookie.includes('gw_session'));

  const meRes = await request
    .get('/api/me')
    .set('Cookie', cookie);
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.email, DEMO_GUARDIAN_EMAIL);
  assert.equal(meRes.body.user.role, 'guardian');
  assert.equal(meRes.body.user.guardianStatus, 'active');

  const portalRes = await request
    .get('/api/guardian/me')
    .set('Cookie', cookie);
  assert.equal(portalRes.status, 200);
  assert.equal(portalRes.body.guardian.name, 'Tomi Adeyemi');
  assert.equal(portalRes.body.pupils.length, 1);
  assert.equal(portalRes.body.pupils[0].id, 'NF-1042');
  assert.equal(portalRes.body.pupils[0].isLegalGuardian, true);
  assert.ok(portalRes.body.correctionRequests.length >= 1);
});

test('Authentication: login failure', async () => {
  const res = await request
    .post('/api/login')
    .send({ email: DEMO_EMAIL, password: 'WrongPassword!' });
  assert.equal(res.status, 401);
  assert.ok(res.body.error);
});

test('State: unauthorized vs authorized', async () => {
  const unauth = await request.get('/api/state');
  assert.equal(unauth.status, 401);

  const cookie = await login();
  const auth = await request.get('/api/state').set('Cookie', cookie);
  assert.equal(auth.status, 200);
  assert.ok(Array.isArray(auth.body.pupils));
  assert.ok(Array.isArray(auth.body.events));
});

test('Pupils and Events: creation, duplicates, and authorized exceptions', async () => {
  const cookie = await login();

  // Create pupil
  const createPupilRes = await request
    .post('/api/pupils')
    .set('Cookie', cookie)
    .send({
      name: 'Node Child',
      id: 'NF-8888',
      className: 'Grade 3A',
      guardian: 'Node Guardian'
    });
  assert.equal(createPupilRes.status, 201);

  // Record arrival
  const arrivalRes = await request
    .post('/api/events')
    .set('Cookie', cookie)
    .send({
      pupilId: 'NF-8888',
      type: 'arrival',
      source: 'Card scan'
    });
  assert.equal(arrivalRes.status, 201);

  // Duplicate arrival check
  const dupArrivalRes = await request
    .post('/api/events')
    .set('Cookie', cookie)
    .send({
      pupilId: 'NF-8888',
      type: 'arrival',
      source: 'Card scan'
    });
  assert.equal(dupArrivalRes.status, 400);

  // Record authorized exception departure without approved collector
  const exceptionRes = await request
    .post('/api/events')
    .set('Cookie', cookie)
    .send({
      pupilId: 'NF-8888',
      type: 'authorized_exception',
      source: 'Authorized exception',
      reason: 'Urgent pickup by grandmother',
      collectorName: 'Grandmother Mary'
    });
  assert.equal(exceptionRes.status, 201);
  assert.equal(exceptionRes.body.ok, true);
});

test('Event correction: non-destructive linked entry', async () => {
  const cookie = await login();

  // Create new pupil for correction test
  await request
    .post('/api/pupils')
    .set('Cookie', cookie)
    .send({
      name: 'Correction Pupil',
      id: 'NF-7000',
      className: 'Grade 2A',
      guardian: 'Correction Guardian'
    });

  // Record manual arrival
  const arrRes = await request
    .post('/api/events')
    .set('Cookie', cookie)
    .send({
      pupilId: 'NF-7000',
      type: 'arrival',
      source: 'Manual entry',
      reason: 'card_missing'
    });
  assert.equal(arrRes.status, 201);
  const origId = arrRes.body.eventId;

  // Record linked correction
  const corrRes = await request
    .post('/api/events')
    .set('Cookie', cookie)
    .send({
      pupilId: 'NF-7000',
      type: 'correction',
      source: 'Non-destructive correction',
      reason: 'Accidental check-in correction',
      correctionLink: origId
    });
  assert.equal(corrRes.status, 201);
  const corrEvent = corrRes.body.state.events.find(e => e.id === corrRes.body.eventId);
  assert.equal(corrEvent.correctionLink, origId);
});

test('Pickup requests: approval and collector addition', async () => {
  const cookie = await login();

  const appRes = await request
    .post('/api/pickup/r1')
    .set('Cookie', cookie)
    .send({
      action: 'approve',
      validUntil: '2030-12-31'
    });
  assert.equal(appRes.status, 200);

  const pupil = appRes.body.state.pupils.find(p => p.id === 'NF-1042');
  const collector = pupil.collectors.find(c => c.name === 'Bola Adeyemi');
  assert.ok(collector);
  assert.equal(collector.until, '2030-12-31');
});

test('Roster import: preview and atomic commit', async () => {
  const cookie = await login();

  const csvContent = "pupil_id,pupil_name,class_name,guardian_name\nNF-9001,Roster Child 1,Grade 1A,Parent 1\nNF-9002,Roster Child 2,Grade 1A,Parent 2\n";
  const b64 = Buffer.from(csvContent).toString('base64');

  const prevRes = await request
    .post('/api/import/preview')
    .set('Cookie', cookie)
    .send({
      filename: 'roster.csv',
      fileBase64: b64
    });
  assert.equal(prevRes.status, 200);
  assert.equal(prevRes.body.validCount, 2);
  const token = prevRes.body.token;

  const commitRes = await request
    .post('/api/import/commit')
    .set('Cookie', cookie)
    .send({ token });
  assert.equal(commitRes.status, 201);
  assert.equal(commitRes.body.imported, 2);
});

test('User management and Audit logging', async () => {
  const cookie = await login();

  const createRes = await request
    .post('/api/users')
    .set('Cookie', cookie)
    .send({
      name: 'Manager Test',
      email: 'manager.test@northfield.school',
      role: 'manager',
      password: 'Password12345!'
    });
  assert.equal(createRes.status, 201);

  const users = createRes.body.users;
  const mgr = users.find(u => u.email === 'manager.test@northfield.school');
  assert.ok(mgr);

  const updateRes = await request
    .post(`/api/users/${mgr.id}`)
    .set('Cookie', cookie)
    .send({
      role: 'viewer',
      active: true
    });
  assert.equal(updateRes.status, 200);

  // Test export CSV audit entry
  const exportRes = await request
    .post('/api/export/activity')
    .set('Cookie', cookie)
    .send({});
  assert.equal(exportRes.status, 200);

  const auditCount = await AuditEntry.countDocuments({ action: 'export_csv' });
  assert.ok(auditCount >= 1);
});

test('API 404 handling and static templates', async () => {
  const cookie = await login();

  const notFoundRes = await request
    .get('/api/nonexistent')
    .set('Cookie', cookie);
  assert.equal(notFoundRes.status, 404);
  assert.equal(notFoundRes.body.error, 'Endpoint not found.');

  const templateRes = await request.get('/pupil-import-template.csv');
  assert.equal(templateRes.status, 200);
  assert.ok(templateRes.text.includes('pupil_id,pupil_name,class_name,guardian_name'));
});

test('Serverless handler (api/index.js)', async () => {
  const handler = require('./api/index');
  const serverlessRequest = supertest(handler);

  const res = await serverlessRequest.get('/api/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);

  // Test serverless handler with pre-parsed req.body and vercel origin
  const loginRes = await serverlessRequest
    .post('/api/login')
    .set('Origin', 'https://school-five-wheat.vercel.app')
    .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.user.email, DEMO_EMAIL);
});

test('Departure & Pickup: Full 6-step workflow in MongoDB', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Create a pupil with approved collectors
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Amari Davis',
      id: 'NF-6001',
      className: 'Grade 3A',
      guardian: 'Kendra Davis'
    });

  // Verify pupil lookup by ID
  const pupilDoc = await Pupil.findOne({ id: 'NF-6001' });
  assert.ok(pupilDoc);
  pupilDoc.collectors.push(
    { id: 1, name: 'Kendra Davis', relation: 'Mother', until: 'Ongoing', active: true },
    { id: 2, name: 'Marcus Davis', relation: 'Father', until: 'Ongoing', active: true }
  );
  await pupilDoc.save();

  // Arrival must be recorded before departure
  const arrRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-6001',
      type: 'arrival',
      source: 'Card scan',
      campus: 'Primary campus',
      gate: 'Main gate',
      device: 'Primary Gate Terminal'
    });
  assert.equal(arrRes.status, 201);

  // 2. Fetch state and check active approved pickup contacts are present
  const stateRes = await request.get('/api/state').set('Cookie', adminCookie);
  assert.equal(stateRes.status, 200);
  const foundPupil = stateRes.body.pupils.find(p => p.id === 'NF-6001');
  assert.equal(foundPupil.collectors.length, 2);

  // 3 & 4. Staff selects approved collector and verification method -> confirms release
  const depRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-6001',
      type: 'departure',
      collectorId: 2,
      verification: 'Approved ID document checked',
      device: 'East Gate Handheld',
      campus: 'Secondary campus',
      gate: 'East pedestrian gate'
    });
  assert.equal(depRes.status, 201);
  assert.ok(depRes.body.ok);

  // Check event record in MongoDB
  const savedEvent = await AttendanceEvent.findOne({ id: depRes.body.eventId });
  assert.ok(savedEvent);
  assert.equal(savedEvent.collector, 'Marcus Davis');
  assert.equal(savedEvent.verification, 'Approved ID document checked');
  assert.equal(savedEvent.device, 'East Gate Handheld');
  assert.equal(savedEvent.campus, 'Secondary campus');
  assert.equal(savedEvent.gate, 'East pedestrian gate');
  assert.equal(savedEvent.staff, 'Amara Okafor');

  // Check audit entry for departure event in MongoDB
  const auditEntry = await AuditEntry.findOne({ action: 'record_departure', objectId: depRes.body.eventId });
  assert.ok(auditEntry);
  assert.ok(auditEntry.reason.includes('device=East Gate Handheld'));
  assert.ok(auditEntry.reason.includes('collector=Marcus Davis'));

  // 5. Guardian alert with collector display name disclosure enabled
  assert.ok(depRes.body.notification.message.includes('Marcus Davis'));

  // Now test with disclosure disabled
  await request
    .post('/api/settings')
    .set('Cookie', adminCookie)
    .send({ discloseCollectorName: false });

  // Setup second pupil
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Brianna Cole',
      id: 'NF-6002',
      className: 'Grade 4A',
      guardian: 'Sarah Cole'
    });
  const pupil2 = await Pupil.findOne({ id: 'NF-6002' });
  pupil2.collectors.push({ id: 1, name: 'Sarah Cole', relation: 'Mother', until: 'Ongoing', active: true });
  await pupil2.save();

  await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({ pupilId: 'NF-6002', type: 'arrival' });

  const depResNoDisclosure = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-6002',
      type: 'departure',
      collectorId: 1,
      verification: 'Photo matched'
    });
  assert.equal(depResNoDisclosure.status, 201);
  assert.ok(depResNoDisclosure.body.notification.message.includes('an authorized contact'));
  assert.ok(!depResNoDisclosure.body.notification.message.includes('Sarah Cole'));

  // Reset disclosure setting
  await request
    .post('/api/settings')
    .set('Cookie', adminCookie)
    .send({ discloseCollectorName: true });

  // 6. Collector not approved: Block / Escalation instruction & Admin Exception
  // Setup third pupil
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Leo Vance',
      id: 'NF-6003',
      className: 'Grade 1C',
      guardian: 'Elena Vance'
    });
  await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({ pupilId: 'NF-6003', type: 'arrival' });

  // Attempt departure with invalid collector ID (unapproved)
  const blockRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-6003',
      type: 'departure',
      collectorId: 999
    });
  assert.equal(blockRes.status, 400);
  assert.ok(blockRes.body.error.includes('Release is blocked'));

  // Manager attempt to authorize exception -> must be blocked (admin only)
  await request
    .post('/api/users')
    .set('Cookie', adminCookie)
    .send({
      name: 'Staff Manager',
      email: 'manager.gate@northfield.school',
      role: 'manager',
      password: 'Password12345!'
    });
  const managerCookie = await login('manager.gate@northfield.school', 'Password12345!');

  const managerExceptionRes = await request
    .post('/api/events')
    .set('Cookie', managerCookie)
    .send({
      pupilId: 'NF-6003',
      type: 'authorized_exception',
      collectorName: 'Grandpa Frank',
      reason: 'Emergency pickup'
    });
  assert.equal(managerExceptionRes.status, 403);
  assert.ok(managerExceptionRes.body.error.includes('Only a school administrator'));

  // Administrator authorizes exception with reason
  const adminExceptionRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-6003',
      type: 'authorized_exception',
      collectorName: 'Grandpa Frank',
      reason: 'Parent called school office with verified emergency code',
      verification: 'Admin Exception: ID checked',
      device: 'Admin Front Desk'
    });
  assert.equal(adminExceptionRes.status, 201);
  assert.ok(adminExceptionRes.body.ok);

  // Check preserved audit entry in MongoDB for the exception
  const exceptionAudit = await AuditEntry.findOne({ action: 'record_authorized_exception', objectId: adminExceptionRes.body.eventId });
  assert.ok(exceptionAudit);
  assert.ok(exceptionAudit.reason.includes('Parent called school office with verified emergency code'));
  assert.ok(exceptionAudit.reason.includes('collector=Grandpa Frank'));
});

test('Offline or delayed sync: device encryption/managed validation, idempotency, queue expiry, and stale pickup policy', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // Setup pupil
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Offline Pupil',
      id: 'NF-5001',
      className: 'Grade 5A',
      guardian: 'Offline Guardian'
    });
  const pupil = await Pupil.findOne({ id: 'NF-5001' });
  pupil.collectors.push({ id: 1, name: 'Offline Guardian', relation: 'Mother', until: 'Ongoing', active: true });
  await pupil.save();

  // 1. Device not managed or unencrypted -> sync rejected
  const unmanagedRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5001',
      type: 'arrival',
      clientEventId: 'client-offline-001',
      offlineQueued: true,
      deviceManaged: false,
      deviceEncrypted: true
    });
  assert.equal(unmanagedRes.status, 400);
  assert.ok(unmanagedRes.body.error.includes('managed and encrypted'));

  const unencryptedRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5001',
      type: 'arrival',
      clientEventId: 'client-offline-002',
      offlineQueued: true,
      deviceManaged: true,
      deviceEncrypted: false
    });
  assert.equal(unencryptedRes.status, 400);
  assert.ok(unencryptedRes.body.error.includes('managed and encrypted'));

  // 2. Queue expiry: event captured > 24 hours ago rejected
  const expiredRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5001',
      type: 'arrival',
      clientEventId: 'client-offline-expired',
      offlineQueued: true,
      deviceManaged: true,
      deviceEncrypted: true,
      deviceCapturedAt: Date.now() - (25 * 60 * 60 * 1000)
    });
  assert.equal(expiredRes.status, 400);
  assert.ok(expiredRes.body.error.includes('expired under the defined queue retention policy'));

  // 3. Valid offline queued arrival sync
  const validArrivalRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5001',
      type: 'arrival',
      clientEventId: 'client-offline-valid-arr',
      offlineQueued: true,
      deviceManaged: true,
      deviceEncrypted: true,
      deviceCapturedAt: Date.now() - 60000,
      staffEmail: DEMO_EMAIL
    });
  assert.equal(validArrivalRes.status, 201);
  assert.ok(validArrivalRes.body.ok);

  // 4. Idempotent sync deduplication: resending same clientEventId returns duplicate status without re-recording
  const duplicateSyncRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5001',
      type: 'arrival',
      clientEventId: 'client-offline-valid-arr',
      offlineQueued: true,
      deviceManaged: true,
      deviceEncrypted: true
    });
  assert.equal(duplicateSyncRes.status, 200);
  assert.equal(duplicateSyncRes.body.isDuplicate, true);
  assert.equal(duplicateSyncRes.body.alertStatus, 'already_synced');

  // Verify only 1 event exists for NF-5001
  const eventsForPupil = await AttendanceEvent.find({ pupilId: 'NF-5001', type: 'arrival' });
  assert.equal(eventsForPupil.length, 1);
  assert.equal(eventsForPupil[0].clientEventId, 'client-offline-valid-arr');

  // 5. Offline departure with stale pickup permissions: blocked without policy
  // Default allowOfflineStalePickupPolicy is false
  const blockedDepartureRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5001',
      type: 'departure',
      collectorId: 1,
      clientEventId: 'client-offline-dep-stale',
      offlineQueued: true,
      deviceManaged: true,
      deviceEncrypted: true,
      allowOfflineStalePickupPolicy: false
    });
  assert.equal(blockedDepartureRes.status, 400);
  assert.ok(blockedDepartureRes.body.error.includes('stale pickup permissions'));

  // Enable school offline stale pickup policy
  await request
    .post('/api/settings')
    .set('Cookie', adminCookie)
    .send({ allowOfflineStalePickupPolicy: true });

  const allowedDepartureRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5001',
      type: 'departure',
      collectorId: 1,
      clientEventId: 'client-offline-dep-stale',
      offlineQueued: true,
      deviceManaged: true,
      deviceEncrypted: true,
      allowOfflineStalePickupPolicy: true
    });
  assert.equal(allowedDepartureRes.status, 201);
  assert.ok(allowedDepartureRes.body.ok);

  // 6. Manual paper/voice fallback reconciliation with required audit reason
  // Create another pupil
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Paper Fallback Child',
      id: 'NF-5002',
      className: 'Grade 1A',
      guardian: 'Paper Guardian'
    });

  // Reconcile arrival without reason -> error
  const noReasonReconcile = await request
    .post('/api/events/reconcile')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5002',
      type: 'arrival',
      reconciliationAuditReason: ''
    });
  assert.equal(noReasonReconcile.status, 400);
  assert.ok(noReasonReconcile.body.error.includes('audit reason'));

  // Reconcile arrival with preserved reason -> success
  const validReconcile = await request
    .post('/api/events/reconcile')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-5002',
      type: 'arrival',
      reconciliationAuditReason: 'Internet outage drill - paper log sheet #12 verified by gate supervisor'
    });
  assert.equal(validReconcile.status, 201);
  assert.ok(validReconcile.body.ok);

  const reconciledEvent = await AttendanceEvent.findOne({ id: validReconcile.body.eventId });
  assert.ok(reconciledEvent);
  assert.equal(reconciledEvent.source, 'Paper/voice manual fallback');
  assert.equal(reconciledEvent.reconciliationAuditReason, 'Internet outage drill - paper log sheet #12 verified by gate supervisor');
});

test('Guardian onboarding: invitation, channel verification, consent acceptance, pupil scoping, preferences, and school authority over permissions', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. School creates pupil record and invites guardian using a verified contact method (SMS or Email)
  const createPupilRes = await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Maya Lin',
      id: 'NF-4001',
      className: 'Grade 2B',
      guardian: 'David Lin',
      guardianPhone: '+1 555-0401',
      guardianEmail: 'david.lin@example.com',
      preferredChannel: 'sms',
      inviteGuardian: true,
      verifiedContactMethod: 'sms',
      relationship: 'Father',
      isLegalGuardian: true
    });
  assert.equal(createPupilRes.status, 201);
  assert.ok(createPupilRes.body.invite);
  const invite = createPupilRes.body.invite;
  assert.equal(invite.verifiedContactMethod, 'sms');
  assert.ok(invite.inviteToken);
  assert.ok(invite.verificationCode);

  // Check audit entry for guardian invitation
  const inviteAudit = await AuditEntry.findOne({ action: 'invite_guardian', objectId: invite.guardianId });
  assert.ok(inviteAudit);

  // Also create a second pupil NOT linked to this guardian to verify access boundary scoping
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Unlinked Child',
      id: 'NF-4002',
      className: 'Grade 5A',
      guardian: 'Other Parent'
    });

  // 2. Guardian proves control of the contact channel (valid vs invalid OTP code)
  // Invalid code fails
  const badVerifyRes = await request
    .post('/api/guardian/verify-channel')
    .send({
      inviteToken: invite.inviteToken,
      verificationCode: '000000'
    });
  assert.equal(badVerifyRes.status, 400);
  assert.ok(badVerifyRes.body.error.includes('Invalid verification code'));

  // Valid code succeeds
  const goodVerifyRes = await request
    .post('/api/guardian/verify-channel')
    .send({
      inviteToken: invite.inviteToken,
      verificationCode: invite.verificationCode
    });
  assert.equal(goodVerifyRes.status, 200);
  assert.equal(goodVerifyRes.body.ok, true);
  assert.equal(goodVerifyRes.body.guardian.channelVerified, true);

  // Check audit entry for channel verification
  const channelAudit = await AuditEntry.findOne({ action: 'guardian_verify_channel', objectId: invite.guardianId });
  assert.ok(channelAudit);

  // 3. Guardian accepts the school's privacy notice and applicable consent/acknowledgment flow
  // Missing privacy notice or consent fails
  const missingConsentRes = await request
    .post('/api/guardian/accept-consent')
    .send({
      inviteToken: invite.inviteToken,
      acceptPrivacyNotice: false,
      acceptConsent: true,
      password: 'GuardianPassword123!'
    });
  assert.equal(missingConsentRes.status, 400);
  assert.ok(missingConsentRes.body.error.includes('privacy notice'));

  const missingStatutoryRes = await request
    .post('/api/guardian/accept-consent')
    .send({
      inviteToken: invite.inviteToken,
      acceptPrivacyNotice: true,
      acceptConsent: false,
      password: 'GuardianPassword123!'
    });
  assert.equal(missingStatutoryRes.status, 400);
  assert.ok(missingStatutoryRes.body.error.includes('consent'));

  // Valid acceptance completes onboarding and signs in guardian
  const consentRes = await request
    .post('/api/guardian/accept-consent')
    .send({
      inviteToken: invite.inviteToken,
      acceptPrivacyNotice: true,
      acceptConsent: true,
      password: 'GuardianPassword123!',
      preferredChannels: ['sms', 'whatsapp']
    });
  assert.equal(consentRes.status, 200);
  assert.equal(consentRes.body.ok, true);
  assert.equal(consentRes.body.guardian.status, 'active');
  assert.ok(consentRes.headers['set-cookie']);
  const guardianCookie = consentRes.headers['set-cookie'][0];

  // Check audit entry for consent acceptance
  const consentAudit = await AuditEntry.findOne({ action: 'guardian_consent_accepted', objectId: invite.guardianId });
  assert.ok(consentAudit);

  // 4. Guardian sees ONLY linked pupil(s)
  const portalRes = await request
    .get('/api/guardian/me')
    .set('Cookie', guardianCookie);
  assert.equal(portalRes.status, 200);
  assert.equal(portalRes.body.pupils.length, 1);
  assert.equal(portalRes.body.pupils[0].id, 'NF-4001');
  assert.equal(portalRes.body.pupils[0].name, 'Maya Lin');
  // Confirm unlinked pupil (NF-4002) is NOT returned
  const unlinkedPupil = portalRes.body.pupils.find(p => p.id === 'NF-4002');
  assert.equal(unlinkedPupil, undefined);

  // 5. Guardian can set notification preferences
  const prefRes = await request
    .put('/api/guardian/preferences')
    .set('Cookie', guardianCookie)
    .send({
      channels: ['whatsapp', 'email']
    });
  assert.equal(prefRes.status, 200);
  assert.deepEqual(prefRes.body.preferredChannels, ['whatsapp', 'email']);

  const updatedGuardianDoc = await Guardian.findOne({ id: invite.guardianId });
  assert.deepEqual(updatedGuardianDoc.preferredChannels, ['whatsapp', 'email']);

  // 6. Guardian requests corrections or contacts the school
  const unlinkedCorrectionRes = await request
    .post('/api/guardian/correction-request')
    .set('Cookie', guardianCookie)
    .send({
      pupilId: 'NF-4002', // Not linked to this guardian
      type: 'record_correction',
      subject: 'Correction for unlinked pupil',
      message: 'This should be blocked'
    });
  assert.equal(unlinkedCorrectionRes.status, 403);

  const validCorrectionRes = await request
    .post('/api/guardian/correction-request')
    .set('Cookie', guardianCookie)
    .send({
      pupilId: 'NF-4001',
      type: 'record_correction',
      subject: 'Correct spelling of middle name',
      message: 'Please change middle name to Mei on school file.'
    });
  assert.equal(validCorrectionRes.status, 201);
  assert.equal(validCorrectionRes.body.ok, true);
  const corrReqId = validCorrectionRes.body.request.id;

  // 7. Direct modification of legal guardian status and pickup permissions by guardian app is strictly prohibited
  const directLegalAttempt = await request
    .post('/api/guardian/legal-status')
    .set('Cookie', guardianCookie)
    .send({ isLegalGuardian: false });
  assert.equal(directLegalAttempt.status, 403);
  assert.ok(directLegalAttempt.body.error.includes('school—not the guardian app—approves'));

  const directPickupAttempt = await request
    .post('/api/guardian/pickup-permissions')
    .set('Cookie', guardianCookie)
    .send({ collectorName: 'Hacker Collector' });
  assert.equal(directPickupAttempt.status, 403);
  assert.ok(directPickupAttempt.body.error.includes('school—not the guardian app—approves'));

  // 8. The school—not the guardian app—approves changes to legal guardian status and pickup permissions
  // School admin views pending corrections
  const adminCorrectionsRes = await request
    .get('/api/admin/corrections')
    .set('Cookie', adminCookie);
  assert.equal(adminCorrectionsRes.status, 200);
  const foundRequest = adminCorrectionsRes.body.requests.find(r => r.id === corrReqId);
  assert.ok(foundRequest);

  // School admin approves correction request
  const approveCorrRes = await request
    .post(`/api/admin/corrections/${corrReqId}`)
    .set('Cookie', adminCookie)
    .send({
      action: 'approve',
      reviewNote: 'Verified parent identity via telephone callback; updated file.'
    });
  assert.equal(approveCorrRes.status, 200);
  assert.equal(approveCorrRes.body.request.status, 'approved');

  // School admin manages / updates legal guardian status with required audit reason
  const missingReasonLegalRes = await request
    .post(`/api/pupils/NF-4001/guardians/${invite.guardianId}/legal-status`)
    .set('Cookie', adminCookie)
    .send({
      isLegalGuardian: false,
      reason: ''
    });
  assert.equal(missingReasonLegalRes.status, 400);

  const schoolUpdateLegalRes = await request
    .post(`/api/pupils/NF-4001/guardians/${invite.guardianId}/legal-status`)
    .set('Cookie', adminCookie)
    .send({
      isLegalGuardian: false,
      reason: 'Court custody determination decree ref #2026-CT-889'
    });
  assert.equal(schoolUpdateLegalRes.status, 200);
  assert.equal(schoolUpdateLegalRes.body.link.isLegalGuardian, false);

  const legalAudit = await AuditEntry.findOne({ action: 'update_legal_guardian_status', objectId: `NF-4001:${invite.guardianId}` });
  assert.ok(legalAudit);
  assert.ok(legalAudit.reason.includes('Court custody determination decree'));
});

test('Missing card & unreadable QR: manual entry marking, reason recording, and departure collector verification', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Create test pupil
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Elena Rostova',
      id: 'NF-3301',
      className: 'Grade 2B',
      guardian: 'Olga Rostova'
    });
  const pupil = await Pupil.findOne({ id: 'NF-3301' });
  pupil.collectors.push(
    { id: 1, name: 'Olga Rostova', relation: 'Mother', until: 'Ongoing', active: true },
    { id: 2, name: 'Dmitri Rostov', relation: 'Father', until: 'Ongoing', active: true }
  );
  await pupil.save();

  // 2. Record arrival with reason 'card_missing'
  const missingCardArrivalRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-3301',
      type: 'arrival',
      source: 'Manual entry',
      reason: 'card_missing',
      campus: 'Primary campus',
      gate: 'Main gate'
    });
  assert.equal(missingCardArrivalRes.status, 201);
  assert.ok(missingCardArrivalRes.body.ok);

  const arrEvent = await AttendanceEvent.findOne({ id: missingCardArrivalRes.body.eventId });
  assert.ok(arrEvent);
  assert.equal(arrEvent.manualEntry, true);
  assert.equal(arrEvent.reason, 'card_missing');
  assert.equal(arrEvent.source, 'Manual entry');

  // Verify audit log has reason=card_missing and manual entry
  const arrAudit = await AuditEntry.findOne({ action: 'record_arrival', objectId: missingCardArrivalRes.body.eventId });
  assert.ok(arrAudit);
  assert.ok(arrAudit.reason.includes('reason=card_missing'));
  assert.ok(arrAudit.reason.includes('source=Manual entry'));

  // 3. Departure still requires collector verification even on manual entry
  // Attempt manual departure without collector -> must fail
  const depNoCollectorRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-3301',
      type: 'departure',
      source: 'Manual entry',
      reason: 'card_unreadable'
    });
  assert.equal(depNoCollectorRes.status, 400);
  assert.ok(depNoCollectorRes.body.error.includes('collector'));

  // Attempt manual departure with unapproved collector -> must fail
  const depUnapprovedCollectorRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-3301',
      type: 'departure',
      source: 'Manual entry',
      reason: 'card_unreadable',
      collectorId: 9999
    });
  assert.equal(depUnapprovedCollectorRes.status, 400);
  assert.ok(depUnapprovedCollectorRes.body.error.includes('Release is blocked'));

  // Successful departure with approved collector and reason 'card_unreadable'
  const depValidCollectorRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-3301',
      type: 'departure',
      source: 'Manual entry',
      reason: 'card_unreadable',
      collectorId: 2,
      verification: 'Photo matched'
    });
  assert.equal(depValidCollectorRes.status, 201);

  const depEvent = await AttendanceEvent.findOne({ id: depValidCollectorRes.body.eventId });
  assert.ok(depEvent);
  assert.equal(depEvent.manualEntry, true);
  assert.equal(depEvent.reason, 'card_unreadable');
  assert.equal(depEvent.collector, 'Dmitri Rostov');
  assert.equal(depEvent.verification, 'Photo matched');

  // 4. Verify Exception Reporting endpoint (/api/reports/exceptions)
  const reportRes = await request
    .get('/api/reports/exceptions')
    .set('Cookie', adminCookie);
  assert.equal(reportRes.status, 200);
  assert.ok(reportRes.body.summary);
  assert.ok(reportRes.body.summary.todayMissingCard >= 1);
  assert.ok(reportRes.body.summary.todayUnreadableQr >= 1);
  assert.ok(reportRes.body.summary.todayManualEntries >= 2);

  const pupilExceptions = reportRes.body.exceptions.filter(e => e.pupilId === 'NF-3301');
  assert.equal(pupilExceptions.length, 2);
  const arrReport = pupilExceptions.find(e => e.type === 'arrival');
  const depReport = pupilExceptions.find(e => e.type === 'departure');
  assert.equal(arrReport.reason, 'card_missing');
  assert.equal(arrReport.manualEntry, true);
  assert.equal(depReport.reason, 'card_unreadable');
  assert.equal(depReport.collector, 'Dmitri Rostov');
  assert.equal(depReport.manualEntry, true);
});

test('Attendance events: all 6 event types, UTC timestamps, campus timezone rendering, server/device capture times, non-destructive corrections, and session safeguards', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Create a pupil for testing attendance events
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Zara Test-Child',
      id: 'NF-7701',
      className: 'Grade 3B',
      guardian: 'Parent Zara'
    });
  const pupil = await Pupil.findOne({ id: 'NF-7701' });
  pupil.collectors.push(
    { id: 1, name: 'Parent Zara', relation: 'Mother', until: 'Ongoing', active: true }
  );
  await pupil.save();

  // 2. Configure campus timezone override: Secondary campus -> America/New_York
  await request
    .post('/api/settings')
    .set('Cookie', adminCookie)
    .send({
      timezone: 'Europe/London',
      campusTimezones: {
        'Primary campus': 'Europe/London',
        'Secondary campus': 'America/New_York'
      }
    });

  // Test manual_arrival event type with UTC timestamp and campus timezone rendering
  // Capture at 2026-03-31 12:00:00 UTC
  const testCaptureTime = new Date('2026-03-31T12:00:00.000Z').getTime();
  const manualArrRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'manual_arrival',
      source: 'search',
      reason: 'card_missing',
      campus: 'Secondary campus',
      gate: 'East pedestrian gate',
      device: 'East Gate Handheld',
      deviceCapturedAt: testCaptureTime
    });
  assert.equal(manualArrRes.status, 201);
  assert.ok(manualArrRes.body.ok);

  const arrEvent = await AttendanceEvent.findOne({ id: manualArrRes.body.eventId });
  assert.ok(arrEvent);
  assert.equal(arrEvent.type, 'manual_arrival');
  assert.equal(arrEvent.source, 'Manual entry');
  assert.equal(arrEvent.manualEntry, true);
  assert.equal(arrEvent.device, 'East Gate Handheld');
  assert.equal(arrEvent.campus, 'Secondary campus');
  assert.equal(arrEvent.gate, 'East pedestrian gate');
  assert.equal(arrEvent.staff, 'Amara Okafor');
  assert.ok(arrEvent.actorId);
  // Timestamp stored in UTC
  assert.equal(arrEvent.timestamp.toISOString(), '2026-03-31T12:00:00.000Z');
  assert.equal(arrEvent.utcTimestamp, '2026-03-31T12:00:00.000Z');
  // Device capture time and server receipt time retained
  assert.equal(arrEvent.deviceCapturedAt, testCaptureTime);
  assert.ok(arrEvent.serverReceivedAt);
  // Rendered in America/New_York (EDT is UTC-4 -> 8:00 AM)
  assert.equal(arrEvent.time, '8:00 AM');
  assert.equal(arrEvent.date, '2026-03-31');

  // Duplicate arrival check for manual_arrival
  const dupArrRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'manual_arrival',
      source: 'search',
      date: '2026-03-31'
    });
  assert.equal(dupArrRes.status, 400);
  assert.ok(dupArrRes.body.error.includes('already has an arrival recorded today'));

  // 3. Non-destructive correction: preserves original event and creates linked correction
  const origEventId = arrEvent.id;
  const origEventBefore = await AttendanceEvent.findOne({ id: origEventId });

  // Missing reason for correction -> fails
  const noReasonCorrRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'correction',
      correctionLink: origEventId,
      reason: ''
    });
  assert.equal(noReasonCorrRes.status, 400);
  assert.ok(noReasonCorrRes.body.error.includes('correction reason is required'));

  // Missing correctionLink -> fails
  const noLinkCorrRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'correction',
      reason: 'Accidental check-in'
    });
  assert.equal(noLinkCorrRes.status, 400);
  assert.ok(noLinkCorrRes.body.error.includes('correctionLink'));

  // Valid linked non-destructive correction
  const validCorrRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'correction',
      source: 'Non-destructive correction',
      correctionLink: origEventId,
      reason: 'Staff scanned wrong class roster entry; verified correction',
      campus: 'Secondary campus'
    });
  assert.equal(validCorrRes.status, 201);
  const corrEvent = await AttendanceEvent.findOne({ id: validCorrRes.body.eventId });
  assert.ok(corrEvent);
  assert.equal(corrEvent.type, 'correction');
  assert.equal(corrEvent.correctionLink, origEventId);
  assert.equal(corrEvent.correctionReason, 'Staff scanned wrong class roster entry; verified correction');
  assert.equal(corrEvent.reason, 'Staff scanned wrong class roster entry; verified correction');

  // Verify original event is preserved untouched (non-destructive)
  const origEventAfter = await AttendanceEvent.findOne({ id: origEventId });
  assert.ok(origEventAfter);
  assert.equal(origEventAfter.type, 'manual_arrival');
  assert.equal(origEventAfter.id, origEventBefore.id);
  assert.equal(origEventAfter.createdAt, origEventBefore.createdAt);

  // 4. Test manual_departure event type (requires collector verification)
  // Missing collector on manual_departure -> fails
  const noColManualDepRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'manual_departure',
      source: 'search',
      reason: 'card_unreadable',
      date: '2026-03-31'
    });
  assert.equal(noColManualDepRes.status, 400);
  assert.ok(noColManualDepRes.body.error.includes('collector'));

  // Valid manual_departure with collector and verification
  const validManualDepRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'manual_departure',
      source: 'search',
      reason: 'card_unreadable',
      collectorId: 1,
      verification: 'Photo matched',
      date: '2026-03-31',
      campus: 'Primary campus'
    });
  assert.equal(validManualDepRes.status, 201);
  const manualDepEvent = await AttendanceEvent.findOne({ id: validManualDepRes.body.eventId });
  assert.ok(manualDepEvent);
  assert.equal(manualDepEvent.type, 'manual_departure');
  assert.equal(manualDepEvent.collector, 'Parent Zara');
  assert.equal(manualDepEvent.verification, 'Photo matched');
  assert.equal(manualDepEvent.manualEntry, true);

  // Duplicate departure check
  const dupDepRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7701',
      type: 'manual_departure',
      collectorId: 1,
      date: '2026-03-31'
    });
  assert.equal(dupDepRes.status, 400);
  assert.ok(dupDepRes.body.error.includes('already departed today'));

  // 5. Configurable operating sessions CRUD and accidental mode error safeguards
  // Create a new session with arrival default mode
  const newSessionRes = await request
    .post('/api/sessions')
    .set('Cookie', adminCookie)
    .send({
      name: 'Early Bird Arrival',
      startTime: '06:45',
      endTime: '07:30',
      defaultMode: 'arrival'
    });
  assert.equal(newSessionRes.status, 201);
  assert.equal(newSessionRes.body.session.name, 'Early Bird Arrival');
  assert.equal(newSessionRes.body.session.defaultMode, 'arrival');

  // Fetch sessions
  const getSessionsRes = await request
    .get('/api/sessions')
    .set('Cookie', adminCookie);
  assert.equal(getSessionsRes.status, 200);
  assert.ok(getSessionsRes.body.sessions.some(s => s.name === 'Early Bird Arrival'));

  // Setup new pupil for session mode error safeguard check
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Safeguard Child',
      id: 'NF-7702',
      className: 'Grade 1A',
      guardian: 'Parent Safe'
    });
  const pupilSafe = await Pupil.findOne({ id: 'NF-7702' });
  pupilSafe.collectors.push({ id: 1, name: 'Parent Safe', relation: 'Mother', until: 'Ongoing', active: true });
  await pupilSafe.save();

  // First record arrival
  await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7702',
      type: 'arrival',
      session: 'Early Bird Arrival'
    });

  // Now attempt departure during 'Early Bird Arrival' session with confirmModeMismatch=false
  // (Safeguard detects session is configured for arrival, but operation is departure)
  const modeMismatchRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7702',
      type: 'departure',
      session: 'Early Bird Arrival',
      collectorId: 1,
      confirmModeMismatch: false
    });
  assert.equal(modeMismatchRes.status, 400);
  assert.ok(modeMismatchRes.body.error.includes('Accidental mode error safeguard'));
  assert.ok(modeMismatchRes.body.error.includes('Confirmation prompt required'));

  // Proceed with explicit confirmation of mode mismatch -> succeeds
  const confirmedMismatchRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-7702',
      type: 'departure',
      session: 'Early Bird Arrival',
      collectorId: 1,
      confirmModeMismatch: true
    });
  assert.equal(confirmedMismatchRes.status, 201);
  assert.ok(confirmedMismatchRes.body.ok);

  const safeDepEvent = await AttendanceEvent.findOne({ id: confirmedMismatchRes.body.eventId });
  assert.equal(safeDepEvent.session, 'Early Bird Arrival');
  assert.equal(safeDepEvent.type, 'departure');
});

test('Card scanning: outcomes, photo pre-verification, duplicate tap prevention, admin reissue, revoke, and artwork export', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Create a test pupil
  const createRes = await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'Kofi Mensah',
      id: 'NF-9901',
      className: 'Grade 3A',
      guardian: 'Kwame Mensah'
    });
  assert.equal(createRes.status, 201);

  // Retrieve active card generated for Kofi
  const activeCard = await Card.findOne({ pupilId: 'NF-9901', status: 'active' });
  assert.ok(activeCard);
  assert.ok(activeCard.cardToken.startsWith('gw_tok_'));

  // A. Scan outcome: unknown_code
  const unknownScanRes = await request
    .post('/api/cards/scan')
    .set('Cookie', adminCookie)
    .send({
      code: 'unrecognized_random_qr_code_token_12345',
      mode: 'arrival'
    });
  assert.equal(unknownScanRes.status, 200);
  assert.equal(unknownScanRes.body.outcome, 'unknown_code');

  // B. Scan outcome: valid_pupil (returns photo and minimum useful identity info before confirmation)
  const validScanRes = await request
    .post('/api/cards/scan')
    .set('Cookie', adminCookie)
    .send({
      code: activeCard.cardToken,
      mode: 'arrival'
    });
  assert.equal(validScanRes.status, 200);
  assert.equal(validScanRes.body.outcome, 'valid_pupil');
  assert.equal(validScanRes.body.pupil.id, 'NF-9901');
  assert.equal(validScanRes.body.pupil.name, 'Kofi Mensah');
  assert.equal(validScanRes.body.pupil.className, 'Grade 3A');
  assert.ok(validScanRes.body.pupil.photo);
  assert.ok(validScanRes.body.pupil.initials);

  // C. Scan outcome: wrong_session (mode mismatch without confirmation)
  const wrongSessionScanRes = await request
    .post('/api/cards/scan')
    .set('Cookie', adminCookie)
    .send({
      code: activeCard.cardToken,
      mode: 'departure',
      session: 'Morning Arrival', // configured for arrival
      confirmModeMismatch: false
    });
  assert.equal(wrongSessionScanRes.status, 200);
  assert.equal(wrongSessionScanRes.body.outcome, 'wrong_session');
  assert.equal(wrongSessionScanRes.body.session, 'Morning Arrival');
  assert.equal(wrongSessionScanRes.body.defaultMode, 'arrival');
  assert.equal(wrongSessionScanRes.body.currentMode, 'departure');

  // Record arrival event with clientEventId for duplicate tap prevention testing
  const tapEventId = 'tap-prevent-001';
  const firstTapRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-9901',
      type: 'arrival',
      source: 'Card scan',
      clientEventId: tapEventId
    });
  assert.equal(firstTapRes.status, 201);
  assert.ok(firstTapRes.body.ok);

  // Repeated tap / retry with same clientEventId does NOT create duplicate event
  const repeatedTapRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-9901',
      type: 'arrival',
      source: 'Card scan',
      clientEventId: tapEventId
    });
  assert.equal(repeatedTapRes.status, 200);
  assert.equal(repeatedTapRes.body.isDuplicate, true);

  const totalEventsForPupil = await AttendanceEvent.find({ pupilId: 'NF-9901', type: 'arrival' });
  assert.equal(totalEventsForPupil.length, 1);

  // D. Scan outcome: already_recorded (scanning again for arrival returns already_recorded)
  const alreadyRecordedScanRes = await request
    .post('/api/cards/scan')
    .set('Cookie', adminCookie)
    .send({
      code: activeCard.cardToken,
      mode: 'arrival'
    });
  assert.equal(alreadyRecordedScanRes.status, 200);
  assert.equal(alreadyRecordedScanRes.body.outcome, 'already_recorded');
  assert.equal(alreadyRecordedScanRes.body.pupil.id, 'NF-9901');
  assert.ok(alreadyRecordedScanRes.body.message.includes('already has arrival recorded today'));

  // E. Admin card reissue: issues new random token, marks previous card replaced, preserves attendance history
  const historyBeforeReissue = await AttendanceEvent.find({ pupilId: 'NF-9901' });
  assert.equal(historyBeforeReissue.length, 1);

  const reissueRes = await request
    .post('/api/cards/NF-9901/reissue')
    .set('Cookie', adminCookie)
    .send({ reason: 'Pupil lost original PVC card' });
  assert.equal(reissueRes.status, 201);
  assert.ok(reissueRes.body.ok);
  assert.notEqual(reissueRes.body.card.cardToken, activeCard.cardToken);

  // Verify previous card is marked 'replaced'
  const oldCard = await Card.findById(activeCard._id);
  assert.equal(oldCard.status, 'replaced');
  assert.ok(oldCard.revokedReason.includes('Pupil lost original PVC card'));

  // Verify historical attendance record was not mutated
  const historyAfterReissue = await AttendanceEvent.find({ pupilId: 'NF-9901' });
  assert.equal(historyAfterReissue.length, 1);
  assert.equal(historyAfterReissue[0].id, historyBeforeReissue[0].id);

  // Verify audit log for card reissue
  const reissueAudit = await AuditEntry.findOne({ action: 'reissue_pupil_card', objectId: reissueRes.body.card.id });
  assert.ok(reissueAudit);
  assert.ok(reissueAudit.reason.includes('Pupil lost original PVC card'));

  // F. Admin card revoke: revokes card, audit logged, historical attendance preserved
  const newCardToken = reissueRes.body.card.cardToken;
  const revokeRes = await request
    .post(`/api/cards/${reissueRes.body.card.id}/revoke`)
    .set('Cookie', adminCookie)
    .send({ reason: 'Suspicious card duplicate reported' });
  assert.equal(revokeRes.status, 200);
  assert.equal(revokeRes.body.card.status, 'revoked');

  // Verify scanning revoked card yields outcome 'revoked_card'
  const revokedScanRes = await request
    .post('/api/cards/scan')
    .set('Cookie', adminCookie)
    .send({
      code: newCardToken,
      mode: 'arrival'
    });
  assert.equal(revokedScanRes.status, 200);
  assert.equal(revokedScanRes.body.outcome, 'revoked_card');
  assert.ok(revokedScanRes.body.reason.includes('Suspicious card duplicate reported'));

  // Verify attendance records are still preserved untouched
  const historyAfterRevoke = await AttendanceEvent.find({ pupilId: 'NF-9901' });
  assert.equal(historyAfterRevoke.length, 1);

  // G. Card artwork export: printable artwork contains no PII in QR token
  // Reissue an active card first
  const freshCardRes = await request
    .post('/api/cards/NF-9901/reissue')
    .set('Cookie', adminCookie)
    .send({ reason: 'New card for artwork print' });
  assert.equal(freshCardRes.status, 201);

  const artworkJsonRes = await request
    .get('/api/cards/NF-9901/artwork')
    .set('Cookie', adminCookie);
  assert.equal(artworkJsonRes.status, 200);
  assert.equal(artworkJsonRes.body.pupil.name, 'Kofi Mensah');
  assert.ok(artworkJsonRes.body.artwork.qrToken.startsWith('gw_tok_'));
  // Ensure token does NOT contain pupil name or PII
  assert.ok(!artworkJsonRes.body.artwork.qrToken.includes('Kofi'));
  assert.ok(!artworkJsonRes.body.artwork.qrToken.includes('Mensah'));

  const artworkHtmlRes = await request
    .get('/api/cards/NF-9901/artwork?format=html')
    .set('Cookie', adminCookie);
  assert.equal(artworkHtmlRes.status, 200);
  assert.ok(artworkHtmlRes.text.includes('NORTHFIELD ACADEMY'));
  assert.ok(artworkHtmlRes.text.includes('Kofi Mensah'));
  assert.ok(artworkHtmlRes.text.includes('Property of Northfield Academy'));
});

test('Administration: Campuses, Sessions, Classes, Devices, Templates, Retention, Escalation Contacts, MFA, Revocation, and Audit Exports', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Manage Campuses: Create and Update
  const createCampusRes = await request
    .post('/api/admin/campuses')
    .set('Cookie', adminCookie)
    .send({
      name: 'South Campus Annex',
      code: 'NF-SOU',
      address: '99 Southfields Road, London SW18',
      timezone: 'Europe/London',
      gates: ['South Gate 1', 'Visitor Turnstile']
    });
  assert.equal(createCampusRes.status, 201);
  assert.equal(createCampusRes.body.campus.name, 'South Campus Annex');

  const updateCampusRes = await request
    .put(`/api/admin/campuses/${createCampusRes.body.campus.id}`)
    .set('Cookie', adminCookie)
    .send({
      address: '100 Southfields Road, London SW18 (Updated)',
      gates: ['South Gate 1', 'Visitor Turnstile', 'Service Bay Gate']
    });
  assert.equal(updateCampusRes.status, 200);
  assert.equal(updateCampusRes.body.campus.gates.length, 3);

  // 2. Manage School Classes: Create and Update
  const createClassRes = await request
    .post('/api/admin/classes')
    .set('Cookie', adminCookie)
    .send({
      name: 'Grade 6A',
      gradeLevel: 'Grade 6',
      campus: 'South Campus Annex',
      teacherName: 'Dr. Elizabeth Clark',
      room: 'Science Lab 3',
      capacity: 32
    });
  assert.equal(createClassRes.status, 201);
  assert.equal(createClassRes.body.schoolClass.name, 'Grade 6A');

  const updateClassRes = await request
    .put(`/api/admin/classes/${createClassRes.body.schoolClass.id}`)
    .set('Cookie', adminCookie)
    .send({
      teacherName: 'Dr. Elizabeth Clark & Co-Teacher',
      capacity: 34
    });
  assert.equal(updateClassRes.status, 200);
  assert.equal(updateClassRes.body.schoolClass.capacity, 34);

  // 3. Manage Devices & Device Lock: Register and Prompt Revocation of Lost Device
  const createDeviceRes = await request
    .post('/api/admin/devices')
    .set('Cookie', adminCookie)
    .send({
      name: 'South Gate Tablet',
      type: 'tablet',
      assignedCampus: 'South Campus Annex',
      assignedGate: 'South Gate 1',
      assignedStaff: 'Gate Officer Mark',
      deviceLockEnabled: true,
      deviceLockPin: '7788'
    });
  assert.equal(createDeviceRes.status, 201);
  assert.equal(createDeviceRes.body.device.name, 'South Gate Tablet');

  // Verify strong staff sign-in device lock requirement
  const pinFailLoginRes = await request
    .post('/api/login')
    .send({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      device: 'South Gate Tablet',
      devicePin: 'wrong-pin'
    });
  assert.equal(pinFailLoginRes.status, 401);
  assert.ok(pinFailLoginRes.body.error.includes('device lock PIN'));

  // Revoke lost device promptly
  const revokeDeviceRes = await request
    .post(`/api/admin/devices/${createDeviceRes.body.device.id}/revoke`)
    .set('Cookie', adminCookie)
    .send({
      reason: 'Tablet went missing during dismissal transition',
      status: 'lost'
    });
  assert.equal(revokeDeviceRes.status, 200);
  assert.equal(revokeDeviceRes.body.device.status, 'lost');

  // Attempt sign-in on lost device is blocked promptly
  const blockedDeviceLogin = await request
    .post('/api/login')
    .send({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      device: 'South Gate Tablet',
      devicePin: '7788'
    });
  assert.equal(blockedDeviceLogin.status, 403);
  assert.ok(blockedDeviceLogin.body.error.includes('marked as lost'));

  // 4. Notification Templates: Create and Update
  const createTmplRes = await request
    .post('/api/admin/templates')
    .set('Cookie', adminCookie)
    .send({
      name: 'Custom Dismissal Delayed Alert',
      type: 'general',
      channel: 'sms',
      templateBody: 'Gatewise Alert: Weather advisory at {{campus}}. Dismissal delayed until {{time}}.',
      variables: ['campus', 'time']
    });
  assert.equal(createTmplRes.status, 201);
  assert.equal(createTmplRes.body.template.name, 'Custom Dismissal Delayed Alert');

  const updateTmplRes = await request
    .put(`/api/admin/templates/${createTmplRes.body.template.id}`)
    .set('Cookie', adminCookie)
    .send({
      templateBody: 'Gatewise Notice: Dismissal resumed safely at {{campus}} at {{time}}.'
    });
  assert.equal(updateTmplRes.status, 200);
  assert.ok(updateTmplRes.body.template.templateBody.includes('Dismissal resumed'));

  // 5. Escalation Contacts: Create and Update
  const createEscRes = await request
    .post('/api/admin/escalation-contacts')
    .set('Cookie', adminCookie)
    .send({
      name: 'Inspector James Sterling',
      role: 'School Safety Liaison Officer',
      phone: '+44 7700 900999',
      email: 'j.sterling@police.service.uk',
      priority: 1,
      campus: 'All campuses',
      notificationChannels: ['phone', 'sms']
    });
  assert.equal(createEscRes.status, 201);
  assert.equal(createEscRes.body.contact.name, 'Inspector James Sterling');

  // 6. Data Retention Settings & Purge execution
  const retentionRes = await request
    .post('/api/admin/retention')
    .set('Cookie', adminCookie)
    .send({
      attendanceRetentionDays: 180,
      auditLogRetentionDays: 365,
      offlineQueueTtlHours: 12,
      sessionTimeoutMinutes: 240,
      autoPurgeEnabled: true
    });
  assert.equal(retentionRes.status, 200);
  assert.equal(retentionRes.body.retentionSettings.attendanceRetentionDays, 180);
  assert.equal(retentionRes.body.retentionSettings.offlineQueueTtlHours, 12);

  const purgeRes = await request
    .post('/api/admin/retention/purge')
    .set('Cookie', adminCookie)
    .send({});
  assert.equal(purgeRes.status, 200);
  assert.ok(purgeRes.body.purged);

  // 7. Staff Account Creation with Strong Password Requirement & Prompt Revocation
  // Weak password rejected
  const weakPasswordRes = await request
    .post('/api/users')
    .set('Cookie', adminCookie)
    .send({
      name: 'Weak Pass Staff',
      email: 'weak.staff@northfield.school',
      role: 'manager',
      password: 'password12345' // Missing uppercase & special char
    });
  assert.equal(weakPasswordRes.status, 400);
  assert.ok(weakPasswordRes.body.error.includes('Strong staff sign-in requires'));

  // Strong password accepted
  const strongStaffRes = await request
    .post('/api/users')
    .set('Cookie', adminCookie)
    .send({
      name: 'Marcus Security',
      email: 'marcus.security@northfield.school',
      role: 'manager',
      password: 'GatewiseStrong!99',
      assignedCampus: 'South Campus Annex'
    });
  assert.equal(strongStaffRes.status, 201);
  const marcusUser = strongStaffRes.body.users.find(u => u.email === 'marcus.security@northfield.school');
  assert.ok(marcusUser);

  // Sign in with new staff member and establish active session
  const marcusCookie = await login('marcus.security@northfield.school', 'GatewiseStrong!99');
  assert.ok(marcusCookie);

  // Administrator revokes staff account promptly
  const revokeUserRes = await request
    .post(`/api/users/${marcusUser.id}/revoke`)
    .set('Cookie', adminCookie)
    .send({ reason: 'Security staff contract terminated' });
  assert.equal(revokeUserRes.status, 200);
  assert.ok(revokeUserRes.body.message.includes('revoked promptly'));

  // Verify Marcus's existing session is immediately terminated (revoked promptly)
  const revokedAccessAttempt = await request
    .get('/api/state')
    .set('Cookie', marcusCookie);
  assert.equal(revokedAccessAttempt.status, 401);

  // 8. Multi-Factor Authentication (MFA) for Administrators
  // Setup MFA for admin
  const mfaSetupRes = await request
    .post('/api/admin/mfa/setup')
    .set('Cookie', adminCookie)
    .send({});
  assert.equal(mfaSetupRes.status, 200);
  assert.ok(mfaSetupRes.body.mfaSecret);

  // Enable MFA with verification token
  const mfaEnableRes = await request
    .post('/api/admin/mfa/enable')
    .set('Cookie', adminCookie)
    .send({ mfaToken: '123456' });
  assert.equal(mfaEnableRes.status, 200);
  assert.ok(mfaEnableRes.body.ok);

  // Now, logging in as admin requires MFA challenge
  const mfaChallengeLoginRes = await request
    .post('/api/login')
    .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  assert.equal(mfaChallengeLoginRes.status, 200);
  assert.equal(mfaChallengeLoginRes.body.requiresMfa, true);
  assert.ok(mfaChallengeLoginRes.body.mfaChallengeToken);

  // Invalid MFA token fails
  const badMfaVerifyRes = await request
    .post('/api/login/mfa-verify')
    .send({
      mfaChallengeToken: mfaChallengeLoginRes.body.mfaChallengeToken,
      mfaToken: '000000'
    });
  assert.equal(badMfaVerifyRes.status, 401);
  assert.ok(badMfaVerifyRes.body.error.includes('Invalid multi-factor'));

  // Valid MFA token succeeds
  const goodMfaVerifyRes = await request
    .post('/api/login/mfa-verify')
    .send({
      mfaChallengeToken: mfaChallengeLoginRes.body.mfaChallengeToken,
      mfaToken: '123456'
    });
  assert.equal(goodMfaVerifyRes.status, 200);
  assert.ok(goodMfaVerifyRes.headers['set-cookie']);
  const newAdminCookie = goodMfaVerifyRes.headers['set-cookie'][0];

  // 9. Administrative Data Exports and Audit Trail
  const exportRes = await request
    .post('/api/admin/export/attendance?format=csv')
    .set('Cookie', newAdminCookie)
    .send({ reason: 'Annual local educational authority audit submission' });
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.headers['content-type'], 'text/csv; charset=utf-8');
  assert.ok(exportRes.text.includes('id,pupilId,type,time'));

  // Verify sensitive action audit log entry was created for data export
  const exportAudit = await AuditEntry.findOne({ action: 'export_administrative_data' }).sort({ createdAt: -1 });
  assert.ok(exportAudit);
  assert.ok(exportAudit.reason.includes('Annual local educational authority audit submission'));

  // Fetch admin audit records endpoint
  const auditListRes = await request
    .get('/api/admin/audit?limit=20')
    .set('Cookie', newAdminCookie);
  assert.equal(auditListRes.status, 200);
  assert.ok(Array.isArray(auditListRes.body.entries));
  assert.ok(auditListRes.body.entries.length >= 1);
  const hasExportEntry = auditListRes.body.entries.some(e => e.action === 'export_administrative_data');
  assert.ok(hasExportEntry);
});

test('Non-Functional Requirements: Availability, Performance, Security, Privacy, Accessibility, Reliability, Compatibility, and Localization', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. AVAILABILITY: Pilot service objective, post-pilot 99.5% target, and degraded mode procedures
  const sysStatusRes = await request.get('/api/system/status');
  assert.equal(sysStatusRes.status, 200);
  assert.ok(sysStatusRes.body.ok);
  assert.equal(sysStatusRes.body.availability.targetUptimePercent, 99.5);
  assert.ok(sysStatusRes.body.availability.pilotServiceObjective.includes('99.0%'));
  assert.ok(sysStatusRes.body.availability.postPilotTarget.includes('99.5% monthly availability'));
  assert.ok(Array.isArray(sysStatusRes.body.availability.degradedModeProcedures));
  assert.ok(sysStatusRes.body.availability.degradedModeProcedures.length >= 3);
  assert.equal(sysStatusRes.body.availability.degradedModeActive, false);

  // Activate degraded mode during simulated third-party outage
  const activateDegradedRes = await request
    .post('/api/system/degraded-mode')
    .set('Cookie', adminCookie)
    .send({
      degradedModeActive: true,
      reason: 'Upstream SMS provider connectivity degradation',
      providerOutages: ['Telecomm carrier SMS latency']
    });
  assert.equal(activateDegradedRes.status, 200);
  assert.equal(activateDegradedRes.body.degradedMode.degradedModeActive, true);

  // Confirm degraded status is reflected in system status
  const degradedStatusRes = await request.get('/api/system/status');
  assert.equal(degradedStatusRes.status, 200);
  assert.equal(degradedStatusRes.body.availability.status, 'degraded');
  assert.equal(degradedStatusRes.body.availability.degradedModeActive, true);
  assert.equal(degradedStatusRes.body.availability.degradedReason, 'Upstream SMS provider connectivity degradation');

  // Audit entry was created for activating degraded mode
  const degradedAudit = await AuditEntry.findOne({ action: 'activate_degraded_mode' });
  assert.ok(degradedAudit);
  assert.ok(degradedAudit.reason.includes('Upstream SMS provider connectivity degradation'));

  // Restore degraded mode to normal
  const restoreDegradedRes = await request
    .post('/api/system/degraded-mode')
    .set('Cookie', adminCookie)
    .send({ degradedModeActive: false });
  assert.equal(restoreDegradedRes.status, 200);
  assert.equal(restoreDegradedRes.body.degradedMode.degradedModeActive, false);

  // 2. PERFORMANCE: Scan lookup and event confirmation completing within 3 seconds at 95th percentile
  assert.equal(sysStatusRes.body.performance.scanLookupP95TargetMs, 3000);
  assert.equal(sysStatusRes.body.performance.eventConfirmationP95TargetMs, 3000);
  assert.equal(sysStatusRes.body.performance.p95ThresholdSeconds, 3);
  assert.ok(sysStatusRes.body.performance.lastMeasuredP95Ms < 3000);

  // Measure online scan lookup execution time
  const startScan = Date.now();
  const scanTestRes = await request
    .post('/api/cards/scan')
    .set('Cookie', adminCookie)
    .send({ code: 'NF-1042', mode: 'arrival', session: 'Morning Arrival' });
  const scanDuration = Date.now() - startScan;
  assert.equal(scanTestRes.status, 200);
  assert.ok(scanDuration < 3000, `Scan duration was ${scanDuration}ms, must be < 3000ms`);

  // Measure online event confirmation execution time using a fresh test pupil
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      name: 'NFR Performance Pupil',
      id: 'NF-9999',
      className: 'Grade 6B',
      guardian: 'NFR Guardian'
    });

  const startEvent = Date.now();
  const clientEvtId = `perf-event-${Date.now()}`;
  const eventTestRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-9999',
      type: 'arrival',
      session: 'Morning Arrival',
      source: 'scan',
      clientEventId: clientEvtId
    });
  const eventDuration = Date.now() - startEvent;
  assert.ok(eventTestRes.status === 200 || eventTestRes.status === 201);
  assert.ok(eventDuration < 3000, `Event confirmation duration was ${eventDuration}ms, must be < 3000ms`);

  // 3. SECURITY: Encryption in transit, managed secrets, short-lived sessions, and sanitized logging
  assert.ok(sysStatusRes.body.security.trafficEncryption.includes('TLS'));
  assert.ok(sysStatusRes.body.security.dataAtRestEncryption.includes('AES-256'));
  assert.ok(sysStatusRes.body.security.shortLivedSessions.timeoutMinutes > 0);
  assert.equal(sysStatusRes.body.security.auditLogging.excludesUnnecessaryPupilData, true);

  // Verify security headers are returned on API requests
  assert.ok(sysStatusRes.headers['content-security-policy']);
  assert.equal(sysStatusRes.headers['x-frame-options'], 'DENY');
  assert.equal(sysStatusRes.headers['x-content-type-options'], 'nosniff');

  // Verify AuditEntry security logging minimizes PII (does not include raw pupil medical or PII payloads)
  const recentEventAudit = await AuditEntry.findOne({ action: 'record_arrival', objectId: clientEvtId });
  if (recentEventAudit) {
    assert.ok(recentEventAudit.reason.includes('campus='));
    // Unnecessary personal information like home address or medical info should not appear
    assert.equal(recentEventAudit.reason.includes('medical'), false);
    assert.equal(recentEventAudit.reason.includes('home_address'), false);
  }

  // 4. PRIVACY: Data minimization, role access matrix, documented data recipients/processors
  assert.equal(sysStatusRes.body.privacy.roleCampusScoped, true);
  const processorsRes = await request
    .get('/api/compliance/processors')
    .set('Cookie', adminCookie);
  assert.equal(processorsRes.status, 200);
  assert.ok(Array.isArray(processorsRes.body.dataProcessors));
  assert.ok(processorsRes.body.dataProcessors.length >= 3);
  const hasMongoProcessor = processorsRes.body.dataProcessors.some(p => p.recipient.includes('MongoDB'));
  assert.ok(hasMongoProcessor);
  assert.ok(processorsRes.body.dataMinimizationNotice.includes('minimum data necessary'));

  // Role privacy isolation: viewer cannot toggle degraded mode or access administrative configurations
  const viewerCookie = await login('oliver.twist@northfield.school', 'GatewiseDemo!26').catch(() => null);
  // If demo viewer doesn't exist, create one to verify least privilege
  let effectiveViewerCookie = viewerCookie;
  if (!effectiveViewerCookie) {
    await request
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({
        name: 'Viewer Tester',
        email: 'viewer.tester@northfield.school',
        role: 'viewer',
        password: 'GatewiseStrong!88',
        assignedCampus: 'Primary campus'
      });
    effectiveViewerCookie = await login('viewer.tester@northfield.school', 'GatewiseStrong!88');
  }

  const forbiddenAttempt = await request
    .post('/api/system/degraded-mode')
    .set('Cookie', effectiveViewerCookie)
    .send({ degradedModeActive: true });
  assert.equal(forbiddenAttempt.status, 403);

  // 5. RELIABILITY: Idempotent writes, durable queues, and daily reconciliation report
  // Submit duplicate event with same clientEventId
  const dupEventRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-9999',
      type: 'arrival',
      session: 'Morning Arrival',
      source: 'scan',
      clientEventId: clientEvtId
    });
  assert.equal(dupEventRes.status, 200);
  assert.equal(dupEventRes.body.isDuplicate, true);

  // Daily reconciliation endpoint
  const reconcileReportRes = await request
    .get('/api/reports/reconciliation')
    .set('Cookie', adminCookie);
  assert.equal(reconcileReportRes.status, 200);
  assert.ok(reconcileReportRes.body.ok);
  assert.ok(reconcileReportRes.body.summary);
  assert.ok(Array.isArray(reconcileReportRes.body.pupilTimeline));
  assert.ok(Array.isArray(reconcileReportRes.body.missingArrivalPatterns));
  assert.ok(Array.isArray(reconcileReportRes.body.missingDeparturePatterns));
  assert.ok(Array.isArray(reconcileReportRes.body.duplicateScanAttempts));
  assert.ok(Array.isArray(reconcileReportRes.body.unresolvedExceptions));

  // 6. COMPATIBILITY: Defined minimum Android & iOS versions
  assert.ok(sysStatusRes.body.compatibility.minimumAndroidVersion.includes('Android 8.0'));
  assert.ok(sysStatusRes.body.compatibility.minimumIosVersion.includes('iOS 15.0'));
  assert.ok(Array.isArray(sysStatusRes.body.compatibility.validatedDevices));
  assert.ok(sysStatusRes.body.compatibility.validatedDevices.length >= 3);

  // 7. LOCALIZATION: UTC timestamps stored, campus local timezone displayed
  assert.equal(sysStatusRes.body.localization.storageStandard.includes('UTC'), true);
  assert.ok(sysStatusRes.body.localization.defaultTimezone);
  assert.ok(Array.isArray(sysStatusRes.body.localization.supportedLocales));
  assert.ok(sysStatusRes.body.localization.supportedLocales.includes('en-GB'));
  assert.ok(sysStatusRes.body.localization.phoneFormat.includes('E.164'));

  // Verify attendance record has canonical UTC timestamp and localized date/time
  const lastRecordedEvent = await AttendanceEvent.findOne({ clientEventId: clientEvtId });
  assert.ok(lastRecordedEvent);
  assert.ok(lastRecordedEvent.utcTimestamp.endsWith('Z'));
  assert.ok(lastRecordedEvent.time);
  assert.ok(lastRecordedEvent.date);
});

test('Security and Safeguarding: Rate-limiting, unusual pattern alerting, privileged audit, PII protection, and incident process', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Unknown & Repeated Scans: Pattern Alerting & Audit Logging
  for (let i = 0; i < 5; i++) {
    const unknownRes = await request
      .post('/api/cards/scan')
      .set('Cookie', adminCookie)
      .send({ code: `UNKNOWN_CODE_${i}_${Date.now()}` });
    assert.equal(unknownRes.body.outcome, 'unknown_code');
  }

  // Verify SecurityAlert was created for repeated unknown scans
  const scanAlert = await SecurityAlert.findOne({ alertType: 'repeated_unknown_scans' }).sort({ createdAt: -1 });
  assert.ok(scanAlert, 'Security alert should be generated for repeated unknown card scans');
  assert.ok(scanAlert.title.includes('Unusual scan pattern'));

  // 2. Repeated Failed Login Attempts: Audit Logging & Security Alert
  const badLoginTarget = `attacker_${Date.now()}@example.com`;
  for (let i = 0; i < 5; i++) {
    const badLoginRes = await request
      .post('/api/login')
      .send({ email: badLoginTarget, password: 'WrongPassword!123' });
    assert.equal(badLoginRes.status, 401);
  }

  // Verify failed logins logged in AuditEntry and SecurityAlert created
  const failedAudit = await AuditEntry.findOne({ action: 'failed_login_attempt', objectId: badLoginTarget });
  assert.ok(failedAudit, 'Failed login should be logged in AuditEntry');

  const failedLoginAlert = await SecurityAlert.findOne({ alertType: 'repeated_failed_logins', identifier: badLoginTarget });
  assert.ok(failedLoginAlert, 'Security alert should be created for repeated failed logins');
  assert.equal(failedLoginAlert.count, 5);

  // 3. Server-side RBAC Enforcement & Security Alerting
  const viewerUser = await User.findOne({ role: 'viewer', active: true });
  let effectiveViewerCookie;
  if (viewerUser) {
    const { hash, salt } = require('./authUtils').passwordHash('GatewiseStrong!99');
    viewerUser.passwordHash = hash;
    viewerUser.salt = salt;
    await viewerUser.save();
    effectiveViewerCookie = await login(viewerUser.email, 'GatewiseStrong!99');
  } else {
    await request
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({
        email: 'viewer.guard@northfield.school',
        name: 'Viewer Guard',
        role: 'viewer',
        password: 'GatewiseStrong!99',
        assignedCampus: 'Primary campus'
      });
    effectiveViewerCookie = await login('viewer.guard@northfield.school', 'GatewiseStrong!99');
  }

  // Viewer attempts privileged admin action (POST /api/users)
  const blockedAttempt = await request
    .post('/api/users')
    .set('Cookie', effectiveViewerCookie)
    .send({ email: 'hacker@northfield.school', name: 'Hacker', role: 'admin', password: 'GatewiseStrong!99' });
  assert.equal(blockedAttempt.status, 403);

  // Verify AuditEntry & SecurityAlert for unauthorized action
  const unauthAudit = await AuditEntry.findOne({ action: 'unauthorized_role_access_blocked' }).sort({ createdAt: -1 });
  assert.ok(unauthAudit);
  assert.ok(unauthAudit.reason.includes('viewer'));

  const unauthAlert = await SecurityAlert.findOne({ alertType: 'unauthorized_access_attempt' }).sort({ createdAt: -1 });
  assert.ok(unauthAlert);
  assert.equal(unauthAlert.severity, 'high');

  // 4. Incident Management: Reporting, Automated Safeguarding & Resolution
  // Case A: Lost Device Incident -> automatically revokes and marks device lost
  const devId = `DEV-LOST-${Date.now()}`;
  await Device.create({
    id: devId,
    name: devId,
    type: 'handheld',
    assignedCampus: 'Primary campus',
    status: 'active'
  });

  const lostIncRes = await request
    .post('/api/safeguarding/incidents')
    .set('Cookie', adminCookie)
    .send({
      incidentType: 'lost_device',
      severity: 'critical',
      title: 'Handheld scanner lost near bus drop-off',
      description: 'Device was misplaced during dismissal rush.',
      targetType: 'device',
      targetId: devId
    });
  assert.equal(lostIncRes.status, 201);
  assert.equal(lostIncRes.body.incident.status, 'open');
  assert.ok(lostIncRes.body.incident.escalatedTo.length > 0);

  // Check device was immediately marked as lost
  const updatedDev = await Device.findOne({ id: devId });
  assert.equal(updatedDev.status, 'lost');

  // Case B: Compromised Account Incident -> automatically terminates sessions & revokes account
  const compUserEmail = `staff.comp.${Date.now()}@northfield.school`;
  await request
    .post('/api/users')
    .set('Cookie', adminCookie)
    .send({
      email: compUserEmail,
      name: 'Compromised Staff',
      role: 'manager',
      password: 'GatewiseStrong!99',
      assignedCampus: 'Primary campus'
    });

  const compCookie = await login(compUserEmail, 'GatewiseStrong!99');
  assert.ok(compCookie);

  const compIncRes = await request
    .post('/api/safeguarding/incidents')
    .set('Cookie', adminCookie)
    .send({
      incidentType: 'compromised_account',
      severity: 'critical',
      title: 'Phishing credential compromise suspected',
      description: 'Staff member reported unusual login notification.',
      targetType: 'user',
      targetId: compUserEmail
    });
  assert.equal(compIncRes.status, 201);

  // Verify target user is disabled and session is terminated
  const compUser = await User.findOne({ email: compUserEmail });
  assert.equal(compUser.active, false);

  // Attempting state with old session cookie must now fail (401)
  const sessionCheck = await request
    .get('/api/state')
    .set('Cookie', compCookie);
  assert.equal(sessionCheck.status, 401);

  // Case C: Suspected Unauthorized Pickup Incident & Incident Resolution
  const pickupIncRes = await request
    .post('/api/safeguarding/incidents')
    .set('Cookie', adminCookie)
    .send({
      incidentType: 'unauthorized_pickup',
      severity: 'critical',
      title: 'Unrecognized individual attempted child handover',
      description: 'Individual matched no approved collector profile; gate staff halted release.',
      targetType: 'pupil',
      targetId: 'NF-1042'
    });
  assert.equal(pickupIncRes.status, 201);
  const incId = pickupIncRes.body.incident.id;

  // Resolve incident with preserved resolution notes
  const resolveRes = await request
    .post(`/api/safeguarding/incidents/${incId}/resolve`)
    .set('Cookie', adminCookie)
    .send({
      resolutionNotes: 'Verified with legal guardian by phone. Unapproved party turned away safely.'
    });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.body.incident.status, 'resolved');
  assert.equal(resolveRes.body.incident.resolutionNotes, 'Verified with legal guardian by phone. Unapproved party turned away safely.');

  // Verify AuditEntry preserved resolution details
  const resolveAudit = await AuditEntry.findOne({ action: 'resolve_security_incident', objectId: incId });
  assert.ok(resolveAudit);
  assert.ok(resolveAudit.reason.includes('Verified with legal guardian'));

  // 5. Alert acknowledgment
  const ackRes = await request
    .post(`/api/safeguarding/alerts/${scanAlert.id}/acknowledge`)
    .set('Cookie', adminCookie)
    .send({});
  assert.equal(ackRes.status, 200);
  assert.equal(ackRes.body.alert.acknowledged, true);

  // 6. Masked tokens in audit logs (preventing raw card token leakage)
  const reissueRes = await request
    .post('/api/cards/NF-1042/reissue')
    .set('Cookie', adminCookie)
    .send({ reason: 'Security replacement test' });
  assert.equal(reissueRes.status, 201);

  const reissueAudit = await AuditEntry.findOne({ action: 'reissue_pupil_card', objectId: reissueRes.body.card.id });
  assert.ok(reissueAudit);
  assert.ok(reissueAudit.reason.includes('...'), 'Raw token in audit logs should be masked with truncation');
});

test('Pickup authorization: Guardian requests, Staff approvals, effective dates, permission types, revoking, automatic expiration, and complete audit history', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);
  const guardianCookie = await login('tomi.adeyemi@guardian.northfield.school', 'GatewiseDemo!26');

  // 1. Guardian submits a pickup contact request for linked child (NF-1042)
  const reqRes = await request
    .post('/api/pickup/request')
    .set('Cookie', guardianCookie)
    .send({
      pupilId: 'NF-1042',
      name: 'Uncle Biyi Adeyemi',
      relation: 'Uncle',
      phone: '+1 555-0888',
      email: 'biyi.adeyemi@example.com',
      permissionType: 'time_limited',
      startDate: '2026-05-01',
      endDate: '2026-05-15',
      idCheckGuidance: 'Government photo passport',
      note: 'Visiting from abroad to collect Zara for two weeks'
    });
  assert.equal(reqRes.status, 201);
  assert.ok(reqRes.body.request.id);
  const pickupReqId = reqRes.body.request.id;

  // Attempting request for unlinked pupil fails with 403
  const unlinkedReqRes = await request
    .post('/api/pickup/request')
    .set('Cookie', guardianCookie)
    .send({
      pupilId: 'NF-1087',
      name: 'Strangers Contact'
    });
  assert.equal(unlinkedReqRes.status, 403);

  // 2. Staff approves pickup request with effective dates, permission type, and ID-check guidance
  const approveRes = await request
    .post(`/api/pickup/${pickupReqId}`)
    .set('Cookie', adminCookie)
    .send({
      action: 'approve',
      permissionType: 'time_limited',
      startDate: '2026-05-01',
      validUntil: '2030-05-15',
      idCheckGuidance: 'Check passport photo',
      reason: 'Verified by telephone call with Tomi Adeyemi'
    });
  assert.equal(approveRes.status, 200);

  const updatedPupil = approveRes.body.state.pupils.find(p => p.id === 'NF-1042');
  const addedCol = updatedPupil.collectors.find(c => c.name === 'Uncle Biyi Adeyemi');
  assert.ok(addedCol);
  assert.equal(addedCol.permissionType, 'time_limited');
  assert.equal(addedCol.idCheckGuidance, 'Check passport photo');

  // 3. Staff creates an emergency_exception and a one_time pickup permission directly with mandatory audit reason
  // Missing audit reason fails
  const noReasonRes = await request
    .post('/api/pickup/contact')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-1042',
      name: 'Neighbor Susan',
      relation: 'Neighbor',
      permissionType: 'one_time',
      reason: ''
    });
  assert.equal(noReasonRes.status, 400);
  assert.ok(noReasonRes.body.error.includes('mandatory audit reason'));

  const oneTimeRes = await request
    .post('/api/pickup/contact')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-1042',
      name: 'Neighbor Susan',
      relation: 'Neighbor',
      phone: '+1 555-0999',
      permissionType: 'one_time',
      validUntil: new Date().toISOString().slice(0, 10),
      idCheckGuidance: 'National Identity Card',
      reason: 'Mother called gate phone authorizing neighbor for today only due to car breakdown'
    });
  assert.equal(oneTimeRes.status, 201);
  const oneTimeCol = oneTimeRes.body.state.pupils.find(p => p.id === 'NF-1042').collectors.find(c => c.name === 'Neighbor Susan');
  assert.ok(oneTimeCol);
  assert.equal(oneTimeCol.permissionType, 'one_time');

  // 4. Staff edits pickup permission details with mandatory audit reason
  const editRes = await request
    .put(`/api/pickup/collectors/NF-1042/${addedCol.id}`)
    .set('Cookie', adminCookie)
    .send({
      phone: '+1 555-7777',
      idCheckGuidance: 'Check passport or drivers license',
      reason: 'Updated phone number per parent request'
    });
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.collector.phone, '+1 555-7777');

  // 5. One-time permission: Pupil arrives, then departs with one-time collector Neighbor Susan -> automatically expires
  await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-1042',
      type: 'arrival',
      session: 'Morning Arrival'
    });

  const depRes = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-1042',
      type: 'departure',
      collectorId: oneTimeCol.id,
      session: 'Afternoon Dismissal'
    });
  assert.equal(depRes.status, 201);
  assert.equal(depRes.body.state.events[0].collector, 'Neighbor Susan');

  // Now verify that Neighbor Susan is no longer in active collectors list for NF-1042
  const postDepPupil = await Pupil.findOne({ id: 'NF-1042' });
  const susanInDb = postDepPupil.collectors.find(c => c.name === 'Neighbor Susan');
  assert.equal(susanInDb.status, 'expired');
  assert.equal(susanInDb.active, false);
  assert.ok(susanInDb.usedAt);

  // 6. Staff revokes a permission with mandatory audit reason
  const revokeWithoutReason = await request
    .post(`/api/pickup/collectors/NF-1042/${addedCol.id}/revoke`)
    .set('Cookie', adminCookie)
    .send({ reason: '' });
  assert.equal(revokeWithoutReason.status, 400);

  const revokeRes = await request
    .post(`/api/pickup/collectors/NF-1042/${addedCol.id}/revoke`)
    .set('Cookie', adminCookie)
    .send({ reason: 'Trip cancelled; father requested revocation of uncle permission' });
  assert.equal(revokeRes.status, 200);

  const postRevokePupil = await Pupil.findOne({ id: 'NF-1042' });
  const biyiInDb = postRevokePupil.collectors.find(c => c.name === 'Uncle Biyi Adeyemi');
  assert.equal(biyiInDb.status, 'revoked');
  assert.equal(biyiInDb.active, false);

  // 7. Complete Audit History (/api/pickup/audit)
  const auditRes = await request
    .get('/api/pickup/audit?pupilId=NF-1042')
    .set('Cookie', adminCookie);
  assert.equal(auditRes.status, 200);
  assert.ok(Array.isArray(auditRes.body.audits));
  const actions = auditRes.body.audits.map(a => a.action);

  assert.ok(actions.includes('pickup_request_created'), 'Must log guardian pickup request creation');
  assert.ok(actions.includes('pickup_approve'), 'Must log staff approval');
  assert.ok(actions.includes('pickup_permission_added'), 'Must log staff addition');
  assert.ok(actions.includes('pickup_permission_changed'), 'Must log staff edit');
  assert.ok(actions.includes('expire_pickup_permission'), 'Must log automatic expiration of one-time permission');
  assert.ok(actions.includes('pickup_permission_revoked'), 'Must log staff revocation');

  // Check audit reasons are preserved
  const revAudit = auditRes.body.audits.find(a => a.action === 'pickup_permission_revoked');
  assert.ok(revAudit.reason.includes('Trip cancelled'));
});

test('Data Model: 12 Domain Classes, DATA_CLASS_RULES, and Data Minimization', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Verify DATA_CLASS_RULES covering all 12 classes with retention, access, and minimization
  const requiredDataClasses = [
    'School',
    'Campus',
    'Pupil',
    'Guardian',
    'PupilGuardian',
    'PickupContact',
    'Card',
    'StaffUser',
    'Device',
    'AttendanceEvent',
    'Notification',
    'AuditEntry'
  ];

  for (const cls of requiredDataClasses) {
    const rule = DATA_CLASS_RULES[cls];
    assert.ok(rule, `DATA_CLASS_RULES must include ${cls}`);
    assert.ok(rule.description, `${cls} must have description`);
    assert.ok(rule.retentionSchedule, `${cls} must have retentionSchedule`);
    assert.ok(rule.accessRules, `${cls} must have accessRules`);
    assert.ok(rule.dataMinimization, `${cls} must have dataMinimization rules`);
  }

  // Check processor API includes dataClassRules
  const procRes = await request
    .get('/api/compliance/processors')
    .set('Cookie', adminCookie);
  assert.equal(procRes.status, 200);
  assert.ok(procRes.body.dataClassRules);
  assert.ok(procRes.body.dataClassRules.Pupil);
  assert.ok(procRes.body.dataClassRules.AttendanceEvent);

  // 2. School: name, policy settings, timezone, notification configuration
  const schoolDoc = await School.create({
    id: `school-${Date.now()}`,
    name: 'Northfield Academy International',
    policySettings: {
      allowOfflineStalePickupPolicy: true,
      discloseCollectorName: true,
      mfaEnforcedForAdmins: true,
      sessionTimeoutMinutes: 360
    },
    timezone: 'Europe/London',
    notificationConfiguration: {
      smsEnabled: true,
      pushEnabled: true,
      whatsappEnabled: true,
      emailEnabled: true,
      defaultProvider: 'twilio-gateway'
    }
  });
  assert.ok(schoolDoc);
  assert.equal(schoolDoc.name, 'Northfield Academy International');
  assert.equal(schoolDoc.timezone, 'Europe/London');
  assert.equal(schoolDoc.policySettings.discloseCollectorName, true);
  assert.equal(schoolDoc.notificationConfiguration.smsEnabled, true);

  // 3. Campus: school, name, address/reference, timezone override, gates
  const campusDoc = await Campus.create({
    id: `camp-${Date.now()}`,
    schoolId: schoolDoc.id,
    school: schoolDoc.name,
    name: 'North Campus',
    code: `NC-${Date.now()}`,
    address: '100 North Way',
    addressReference: 'Main entrance opposite North Park',
    timezone: 'Europe/London',
    timezoneOverride: 'Europe/Paris',
    gates: ['Gate A', 'Gate B']
  });
  assert.ok(campusDoc);
  assert.equal(campusDoc.addressReference, 'Main entrance opposite North Park');
  assert.equal(campusDoc.timezoneOverride, 'Europe/Paris');

  // 4. Pupil: school ID, name, photo reference, class, campus, status
  const pupilDoc = await Pupil.create({
    id: `NF-DM-${Date.now()}`,
    schoolId: schoolDoc.id,
    name: 'Taylor Model',
    photoReference: '/photos/pupils/taylor.jpg',
    className: 'Grade 4B',
    campus: campusDoc.name,
    guardian: 'Jordan Model',
    initials: 'TM',
    color: '#336699',
    status: 'active'
  });
  assert.ok(pupilDoc);
  assert.equal(pupilDoc.photoReference, '/photos/pupils/taylor.jpg');
  assert.equal(pupilDoc.status, 'active');
  assert.equal(pupilDoc.campus, campusDoc.name);

  // 5. Guardian: name, verified contacts, account status, preferences
  const guardianDoc = await Guardian.create({
    id: `guard-${Date.now()}`,
    name: 'Jordan Model',
    email: `jordan.${Date.now()}@example.com`,
    phone: '+44 7700 900111',
    verifiedContacts: [
      { type: 'phone', value: '+44 7700 900111', verifiedAt: new Date() },
      { type: 'email', value: `jordan.${Date.now()}@example.com`, verifiedAt: new Date() }
    ],
    accountStatus: 'active',
    preferences: {
      preferredChannels: ['sms', 'push'],
      language: 'en-GB',
      quietHoursEnabled: false
    },
    verifiedContactMethod: 'sms',
    status: 'active'
  });
  assert.ok(guardianDoc);
  assert.equal(guardianDoc.verifiedContacts.length, 2);
  assert.equal(guardianDoc.accountStatus, 'active');
  assert.equal(guardianDoc.preferences.language, 'en-GB');

  // 6. PupilGuardian: pupil, guardian, relationship, status, authority metadata
  const pupilGuardianDoc = await PupilGuardian.create({
    id: `pg-${Date.now()}`,
    pupilId: pupilDoc.id,
    guardianId: guardianDoc.id,
    relationship: 'Mother',
    status: 'active',
    authorityMetadata: {
      courtOrderRestricted: false,
      custodyDocumentationRef: 'CUST-2026-001',
      permittedToAuthorizePickups: true
    }
  });
  assert.ok(pupilGuardianDoc);
  assert.equal(pupilGuardianDoc.authorityMetadata.custodyDocumentationRef, 'CUST-2026-001');
  assert.equal(pupilGuardianDoc.authorityMetadata.permittedToAuthorizePickups, true);

  // 7. PickupContact: pupil, name, relationship, verification data/reference, effective dates, status
  const pickupContactDoc = await PickupContact.create({
    id: `pc-${Date.now()}`,
    pupilId: pupilDoc.id,
    name: 'Aunt Casey',
    relationship: 'Aunt',
    phone: '+44 7700 900222',
    verificationData: 'Passport check and matching family photo',
    effectiveDates: {
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    },
    status: 'active'
  });
  assert.ok(pickupContactDoc);
  assert.equal(pickupContactDoc.verificationData, 'Passport check and matching family photo');
  assert.equal(pickupContactDoc.effectiveDates.startDate, '2026-01-01');

  // 8. Card: pupil, random token hash/reference, issue/revoke timestamps, status
  const cardDoc = await Card.create({
    id: `card-${Date.now()}`,
    pupilId: pupilDoc.id,
    cardToken: `gw_tok_${Date.now()}`,
    tokenHash: `hash_${Date.now()}`,
    status: 'active',
    issuedAt: new Date()
  });
  assert.ok(cardDoc);
  assert.ok(cardDoc.tokenHash.startsWith('hash_'));
  assert.equal(cardDoc.status, 'active');

  // 9. StaffUser: identity, role, assigned campus, status, authentication metadata
  const staffDoc = await StaffUser.create({
    email: `staff.${Date.now()}@northfield.school`,
    name: 'Officer Alex',
    role: 'manager',
    salt: 'salt1234',
    passwordHash: 'hash1234',
    assignedCampus: campusDoc.name,
    status: 'active',
    authenticationMetadata: {
      lastLoginAt: new Date(),
      failedLoginCount: 0,
      mfaLastVerifiedAt: new Date()
    }
  });
  assert.ok(staffDoc);
  assert.equal(staffDoc.status, 'active');
  assert.equal(staffDoc.authenticationMetadata.failedLoginCount, 0);

  // 10. Device: managed device identifier, assigned staff/campus, last seen, status
  const devDoc = await Device.create({
    id: `DEV-MGD-${Date.now()}`,
    name: 'Main Gate Kiosk',
    managedDeviceIdentifier: `MGD-${Date.now()}`,
    assignedStaff: staffDoc.name,
    assignedCampus: campusDoc.name,
    lastSeen: new Date(),
    status: 'active'
  });
  assert.ok(devDoc);
  assert.ok(devDoc.managedDeviceIdentifier.startsWith('MGD-'));
  assert.equal(devDoc.status, 'active');

  // 11. AttendanceEvent: pupil, type, timestamps, actor, device, campus, source, collector, verification method, correction link, reason
  const eventDoc = await AttendanceEvent.create({
    id: `evt-dm-${Date.now()}`,
    pupilId: pupilDoc.id,
    type: 'departure',
    timestamp: new Date(),
    utcTimestamp: new Date().toISOString(),
    time: '3:30 PM',
    date: '2026-04-01',
    createdAt: Date.now(),
    staff: staffDoc.name,
    actorId: staffDoc._id,
    source: 'Card scan',
    collector: 'Aunt Casey',
    verification: 'Passport check',
    device: devDoc.name,
    campus: campusDoc.name,
    correctionLink: null,
    reason: 'Standard dismissal'
  });
  assert.ok(eventDoc);
  assert.equal(eventDoc.pupilId, pupilDoc.id);
  assert.equal(eventDoc.collector, 'Aunt Casey');
  assert.equal(eventDoc.verification, 'Passport check');

  // 12. Notification: event, guardian, channel, provider reference, status, timestamps, failure category
  const notifDoc = await Notification.create({
    id: `notif-dm-${Date.now()}`,
    eventId: eventDoc.id,
    guardianId: guardianDoc.id,
    pupilId: pupilDoc.id,
    guardianName: guardianDoc.name,
    channel: 'SMS',
    providerReference: 'tw_msg_123456789',
    recipient: guardianDoc.phone,
    message: 'Gatewise Alert: Taylor Model departed with Aunt Casey at 3:30 PM.',
    status: 'delivered',
    sentAt: '3:30 PM',
    timestamps: {
      queuedAt: new Date(),
      acceptedAt: new Date(),
      deliveredAt: new Date()
    },
    failureCategory: null
  });
  assert.ok(notifDoc);
  assert.equal(notifDoc.providerReference, 'tw_msg_123456789');
  assert.equal(notifDoc.status, 'delivered');
  assert.ok(notifDoc.timestamps.deliveredAt);

  // 13. AuditEntry: actor, action, object, timestamp, reason, before/after references as appropriate
  const auditDoc = await AuditEntry.create({
    userId: staffDoc._id,
    actor: staffDoc.email,
    action: 'record_departure',
    objectType: 'AttendanceEvent',
    objectId: eventDoc.id,
    object: `AttendanceEvent:${eventDoc.id}`,
    reason: 'Aunt Casey collected pupil',
    beforeReference: 'status=on_site',
    afterReference: 'status=departed',
    beforeAfterReferences: {
      before: { onSite: true },
      after: { onSite: false }
    },
    timestamp: new Date()
  });
  assert.ok(auditDoc);
  assert.equal(auditDoc.actor, staffDoc.email);
  assert.equal(auditDoc.object, `AttendanceEvent:${eventDoc.id}`);
  assert.equal(auditDoc.afterReference, 'status=departed');

  // 14. Data Minimization Assertion: Avoid copying entire pupil record into logs or notifications
  const fullPupilRecordCopy = {
    pupilId: pupilDoc.id,
    name: pupilDoc.name,
    className: pupilDoc.className,
    collectors: pupilDoc.collectors,
    guardianPhone: pupilDoc.guardianPhone,
    guardianEmail: pupilDoc.guardianEmail,
    photo: pupilDoc.photo
  };

  assert.throws(() => {
    assertDataMinimization('AuditEntry', fullPupilRecordCopy);
  }, /Data minimization violation/);

  assert.throws(() => {
    assertDataMinimization('Notification', fullPupilRecordCopy);
  }, /Data minimization violation/);

  // Non-infringing minimal data passes without exception
  assert.doesNotThrow(() => {
    assertDataMinimization('AuditEntry', { pupilId: pupilDoc.id, action: 'record_arrival' });
  });
});
