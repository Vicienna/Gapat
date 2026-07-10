const path = require('path');

process.env.DASHBOARD_VIEWS_DIR = path.join(__dirname, '..', 'views');
process.env.DASHBOARD_PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = require('../server');

module.exports = app;
