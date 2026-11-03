const test = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app, seedInitialData } = require('./server');
const {
  User,
  Pupil,
  PickupRequest,
  AttendanceEvent,
  AuditEntry,
  Guardian,
  PupilGuardian,
  CorrectionRequest,
  Card
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

test('Dashboards and reports: Live views, search/filter, attendance export with audit logging, and daily reconciliation', async () => {
  const adminCookie = await login(DEMO_EMAIL, DEMO_PASSWORD);

  // 1. Create test pupils for live views and reconciliation
  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      id: 'NF-8801',
      name: 'Simi Johnson',
      className: 'Grade 3A',
      guardian: 'Folake Johnson'
    });

  // Attach an approved collector to NF-8801
  await Pupil.updateOne(
    { id: 'NF-8801' },
    { $set: { collectors: [{ id: 1, name: 'Folake Johnson', relation: 'Mother', until: 'Ongoing', active: true }] } }
  );

  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      id: 'NF-8802',
      name: 'Tariq Al-Mansoor',
      className: 'Grade 3A',
      guardian: 'Zainab Al-Mansoor'
    });

  await request
    .post('/api/pupils')
    .set('Cookie', adminCookie)
    .send({
      id: 'NF-8803',
      name: 'Chioma Obi',
      className: 'Grade 4B',
      guardian: 'Emeka Obi'
    });

  // A. Record arrival for NF-8801 (normal scan)
  const arr1 = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-8801',
      type: 'arrival',
      campus: 'Primary campus',
      gate: 'Main gate',
      session: 'Morning Arrival',
      source: 'Card scan'
    });
  assert.equal(arr1.status, 201);

  // B. Record arrival for NF-8802 (manual entry / card_missing)
  const arr2 = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-8802',
      type: 'manual_arrival',
      campus: 'Primary campus',
      gate: 'Main gate',
      session: 'Morning Arrival',
      source: 'Manual entry',
      reason: 'card_missing',
      manualEntry: true
    });
  assert.equal(arr2.status, 201);

  // C. Attempt duplicate arrival scan for NF-8801 via /api/cards/scan to verify duplicate scan attempt logging
  const cardDoc = await Card.findOne({ pupilId: 'NF-8801', status: 'active' });
  const dupScanRes = await request
    .post('/api/cards/scan')
    .set('Cookie', adminCookie)
    .send({
      code: cardDoc ? cardDoc.cardToken : 'NF-8801',
      mode: 'arrival',
      session: 'Morning Arrival',
      campus: 'Primary campus'
    });
  assert.equal(dupScanRes.status, 200);
  assert.equal(dupScanRes.body.outcome, 'already_recorded');

  // Verify duplicate scan attempt was recorded in AuditEntry
  const dupAudit = await AuditEntry.findOne({ action: 'duplicate_scan_attempt', objectId: 'NF-8801' });
  assert.ok(dupAudit);
  assert.ok(dupAudit.reason.includes('already arrived today'));

  // D. Record departure for NF-8801 (leaving NF-8802 still on site, and NF-8803 not yet arrived)
  const dep1 = await request
    .post('/api/events')
    .set('Cookie', adminCookie)
    .send({
      pupilId: 'NF-8801',
      type: 'departure',
      collectorName: 'Folake Johnson',
      verification: 'Guardian photo ID checked',
      campus: 'Primary campus',
      gate: 'Main gate',
      session: 'Afternoon Dismissal'
    });
  assert.equal(dep1.status, 201);

  // 2. Test GET /api/dashboard/live
  const liveRes = await request
    .get('/api/dashboard/live?campus=Primary%20campus')
    .set('Cookie', adminCookie);
  assert.equal(liveRes.status, 200);
  assert.ok(liveRes.body.metrics);
  assert.ok(liveRes.body.metrics.expectedPupils >= 3);
  assert.ok(liveRes.body.metrics.arrived >= 2);
  assert.ok(liveRes.body.metrics.departed >= 1);
  assert.ok(liveRes.body.metrics.stillOnSite >= 1);
  assert.ok(liveRes.body.metrics.exceptions >= 1); // NF-8802 had manualEntry card_missing
  assert.ok(Array.isArray(liveRes.body.pupils));

  // Check specific pupil statuses in live view
  const p8801Live = liveRes.body.pupils.find(p => p.id === 'NF-8801');
  assert.equal(p8801Live.liveStatus, 'departed');
  const p8802Live = liveRes.body.pupils.find(p => p.id === 'NF-8802');
  assert.equal(p8802Live.liveStatus, 'still_on_site');
  assert.equal(p8802Live.hasException, true);
  const p8803Live = liveRes.body.pupils.find(p => p.id === 'NF-8803');
  assert.equal(p8803Live.liveStatus, 'not_yet_arrived');

  // 3. Test GET /api/reports/attendance search & filter
  // Filter by className
  const classFilterRes = await request
    .get('/api/reports/attendance?className=Grade%203A')
    .set('Cookie', adminCookie);
  assert.equal(classFilterRes.status, 200);
  assert.ok(classFilterRes.body.results.length >= 2);
  assert.ok(classFilterRes.body.results.every(r => r.className === 'Grade 3A'));

  // Filter by eventType
  const arrFilterRes = await request
    .get('/api/reports/attendance?eventType=arrival')
    .set('Cookie', adminCookie);
  assert.equal(arrFilterRes.status, 200);
  assert.ok(arrFilterRes.body.results.every(r => r.type.includes('arrival')));

  // Filter by pupil search
  const pupilSearchRes = await request
    .get('/api/reports/attendance?pupil=Tariq')
    .set('Cookie', adminCookie);
  assert.equal(pupilSearchRes.status, 200);
  assert.ok(pupilSearchRes.body.results.length >= 1);
  assert.ok(pupilSearchRes.body.results.some(r => r.pupilId === 'NF-8802'));

  // Check notification outcome and manual/offline indicators in report items
  const manualItem = pupilSearchRes.body.results.find(r => r.pupilId === 'NF-8802');
  assert.equal(manualItem.manualEntry, true);
  assert.equal(manualItem.reason, 'card_missing');
  assert.ok(manualItem.notificationOutcome);
  assert.equal(manualItem.notificationOutcome.status, 'Sent');

  // 4. Test Export Attendance Report: CSV export, role check, and audit logging
  const exportCsvRes = await request
    .get('/api/reports/attendance/export?campus=Primary%20campus&className=Grade%203A')
    .set('Cookie', adminCookie);
  assert.equal(exportCsvRes.status, 200);
  assert.equal(exportCsvRes.headers['content-type'], 'text/csv; charset=utf-8');
  assert.ok(exportCsvRes.text.includes('Event ID,Pupil ID,Pupil Name,Class'));
  assert.ok(exportCsvRes.text.includes('Simi Johnson'));
  assert.ok(exportCsvRes.text.includes('Tariq Al-Mansoor'));

  // Verify AuditEntry created for export
  const exportAudit = await AuditEntry.findOne({ action: 'export_attendance_report' });
  assert.ok(exportAudit);
  assert.ok(exportAudit.reason.includes('exported attendance report'));

  // Verify role check: unauthenticated request rejected
  const unauthExportRes = await request.get('/api/reports/attendance/export');
  assert.equal(unauthExportRes.status, 401);

  // 5. Test Daily Reconciliation endpoint: /api/reports/reconciliation
  const reconRes = await request
    .get('/api/reports/reconciliation?campus=Primary%20campus')
    .set('Cookie', adminCookie);
  assert.equal(reconRes.status, 200);
  const recon = reconRes.body.reconciliation;
  assert.ok(recon.summary);
  assert.ok(recon.missingPatterns);
  assert.ok(recon.duplicateScanAttempts);
  assert.ok(recon.unresolvedExceptions);
  assert.ok(Array.isArray(recon.timeline));

  // Check missing patterns:
  // NF-8802 arrived but not departed => arrivedWithoutDeparture
  assert.ok(recon.missingPatterns.arrivedWithoutDeparture.some(p => p.pupilId === 'NF-8802'));
  // NF-8803 never scanned => unrecordedPupils
  assert.ok(recon.missingPatterns.unrecordedPupils.some(p => p.pupilId === 'NF-8803'));

  // Check duplicate scan attempts captured
  assert.ok(recon.duplicateScanAttempts.some(d => d.objectId === 'NF-8801'));

  // Check pupil timeline present
  const simiTimeline = recon.timeline.find(t => t.pupil.id === 'NF-8801');
  assert.ok(simiTimeline);
  assert.ok(simiTimeline.events.length >= 2); // arrival and departure
});
