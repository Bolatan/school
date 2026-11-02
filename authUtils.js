const crypto = require('crypto');
const { User, Pupil, PickupRequest, AttendanceEvent, Household, PupilHousehold, Card } = require('./models');

const DEMO_EMAIL = 'admin@northfield.school';
const DEMO_PASSWORD = 'GatewiseDemo!26';

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

// Generate a random, non-meaningful card token.
// Does NOT encode pupil name, birth date, phone number, or other personal details.
function generateCardToken() {
  const randomBytes = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `GWC-${randomBytes.slice(0, 4)}-${randomBytes.slice(4, 8)}-${randomBytes.slice(8, 12)}-${randomBytes.slice(12, 16)}`;
}

function hashCardToken(token) {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
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
      active: true
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
        campus: 'Primary campus',
        status: 'active',
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

      // Issue random non-meaningful card token for each pupil
      const cardToken = generateCardToken();
      await Card.create({
        id: `CARD-${id}`,
        pupilId: id,
        cardToken,
        tokenHash: hashCardToken(cardToken),
        status: 'active',
        issuedAt: new Date(),
        issuedBy: 'System Seed'
      });
    }

    // Seed sample Households and PupilHousehold links
    const household1 = await Household.create({
      id: 'HH-101',
      name: 'Adeyemi Household',
      address: '14 Kensington Crescent, Northfield',
      phone: '+1 555-0142',
      notes: 'Primary residence'
    });
    const household2 = await Household.create({
      id: 'HH-102',
      name: 'Adeyemi Secondary / Grandparents',
      address: '28 Pine Grove, Northfield',
      phone: '+1 555-0143',
      notes: 'Grandparents home - alternate pickup address'
    });
    const household3 = await Household.create({
      id: 'HH-103',
      name: 'Mensah Household',
      address: '9 Victoria Way, Northfield',
      phone: '+1 555-0187',
      notes: 'Family residence'
    });

    // Pupil linked to more than one household (Zara Adeyemi linked to HH-101 and HH-102)
    await PupilHousehold.create({
      id: 'PH-1',
      pupilId: 'NF-1042',
      householdId: 'HH-101',
      isPrimary: true,
      relationshipNotes: 'Main residence'
    });
    await PupilHousehold.create({
      id: 'PH-2',
      pupilId: 'NF-1042',
      householdId: 'HH-102',
      isPrimary: false,
      relationshipNotes: 'Alternate weekend / grandparents residence'
    });
    await PupilHousehold.create({
      id: 'PH-3',
      pupilId: 'NF-1087',
      householdId: 'HH-103',
      isPrimary: true,
      relationshipNotes: 'Main residence'
    });

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
        time: formatTime(t),
        date: formatDate(t),
        createdAt: t.getTime(),
        staff,
        source: 'Card scan',
        alert: 'Demo only',
        reason: '',
        manualEntry: false
      });
    }

    const requests = [
      { id: "r1", pupilId: "NF-1042", name: "Bola Adeyemi", relation: "Aunt", requestedBy: "Tomi Adeyemi", time: "Today, 8:42 AM", note: "One-time pickup today. ID check required." },
      { id: "r2", pupilId: "NF-1087", name: "Kojo Mensah", relation: "Uncle", requestedBy: "Ama Mensah", time: "Today, 9:06 AM", note: "Temporary approval. Confirm the expiry with the guardian." }
    ];

    for (const req of requests) {
      await PickupRequest.create(req);
    }
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
  passwordHash,
  verifyPassword,
  nowLocal,
  formatTime,
  formatDate,
  generateCardToken,
  hashCardToken,
  seedInitialData,
  getNextCollectorId
};
