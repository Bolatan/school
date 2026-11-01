const test = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app, seedInitialData } = require('./server');
const { User, Pupil, PickupRequest, AttendanceEvent, AuditEntry } = require('./models');
const { DEMO_EMAIL, DEMO_PASSWORD } = require('./authUtils');

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
