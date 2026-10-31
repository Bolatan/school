const { app, seedInitialData } = require('../server');
const { connectToDatabase } = require('../lib/mongodb');

let seeded = false;

module.exports = async (req, res) => {
  try {
    await connectToDatabase();
    if (!seeded) {
      await seedInitialData();
      seeded = true;
    }
  } catch (err) {
    console.error('Database connection error in serverless handler:', err);
  }

  if (req.url && !req.url.startsWith('/api/') && req.url !== '/api') {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  return app(req, res);
};
