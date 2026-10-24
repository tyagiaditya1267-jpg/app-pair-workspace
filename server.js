/**
 * server.js — Standalone runner for the backend REST & WebSocket server
 * 
 * Run with: node server.js
 */

const path = require('path');
const BackendServer = require('./backend/server');

const PORT = parseInt(process.env.PORT || '4173', 10);
const HOST = process.env.HOST || '127.0.0.1';
const STORAGE_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const server = new BackendServer({
  port: PORT,
  host: HOST,
  storageDir: STORAGE_DIR
});

server.start().then(info => {
  console.log('====================================================');
  console.log('  APP-PAIR WORKSPACE BACKEND SERVER STARTED');
  console.log('====================================================');
  console.log(`  REST API URL : ${info.apiUrl}`);
  console.log(`  WebSocket URL: ${info.wsUrl}`);
  console.log(`  Health Check : ${info.apiUrl}/health`);
  console.log('====================================================');
}).catch(err => {
  console.error('Failed to start backend server:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nStopping backend server...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});
