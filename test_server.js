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
