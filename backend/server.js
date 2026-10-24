/**
 * server.js — App-Pair Workspace Backend Server
 * 
 * Provides:
 * - HTTP REST API Server
 * - RFC 6455 WebSocket Server for Real-Time Sync
 * - Persistent Database Engine Integration
 * - Cross-device communication capabilities
 */

const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');
const DatabaseEngine = require('./database');
const Router = require('./router');

const registerPaletteRoutes = require('./routes/palette');
const registerRegistryRoutes = require('./routes/registry');
const registerDataRoutes = require('./routes/data');
const registerSearchAndHealthRoutes = require('./routes/search');

class BackendServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 4173;
    this.host = options.host || '127.0.0.1';
    this.db = new DatabaseEngine({ storageDir: options.storageDir });
    this.router = new Router();
    this.httpServer = null;
    this.wsClients = new Set();
    this.isRunning = false;

    this.dataService = options.dataService || null;
    this.appRegistry = options.appRegistry || null;
  }

  /**
   * Start the backend server and attach all routes
   */
  async start() {
    this.db.init();

    // Broadcast helper
    const broadcast = (eventObj) => this.broadcast(eventObj);

    // Register all route modules
    registerPaletteRoutes(this.router, this.db, broadcast);
    registerRegistryRoutes(this.router, this.db, broadcast, this.appRegistry);
    registerDataRoutes(this.router, this.db, broadcast, this.dataService);
    registerSearchAndHealthRoutes(this.router, this.db, () => this.getInfo());

    // Create HTTP Server
    this.httpServer = http.createServer((req, res) => {
      this.router.handle(req, res);
    });

    // Attach WebSocket Upgrade handler
    this._attachWebSocketServer(this.httpServer);

    // Listen on port with fallback if in use
    await this._listenWithFallback(this.port);
    this.isRunning = true;

    return this.getInfo();
  }

  _listenWithFallback(startPort, maxAttempts = 10) {
    return new Promise((resolve, reject) => {
      let currentPort = startPort;
      let attempts = 0;

      const tryListen = () => {
        this.httpServer.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
            attempts++;
            currentPort++;
            console.log(`[Backend] Port in use, trying ${currentPort}...`);
            tryListen();
          } else {
            reject(err);
          }
        });

        this.httpServer.listen(currentPort, this.host, () => {
          this.port = currentPort;
          console.log(`[Backend] Server listening on http://${this.host}:${this.port}`);
          console.log(`[Backend] WebSocket available on ws://${this.host}:${this.port}/ws`);
          resolve();
        });
      };

      tryListen();
    });
  }

  /**
   * Native RFC 6455 WebSocket server implementation
   */
  _attachWebSocketServer(server) {
    server.on('upgrade', (req, socket, head) => {
      const upgradeHeader = (req.headers['upgrade'] || '').toLowerCase();
      if (upgradeHeader !== 'websocket') {
        socket.destroy();
        return;
      }

      const clientKey = req.headers['sec-websocket-key'];
      if (!clientKey) {
        socket.destroy();
        return;
      }

      // Compute WebSocket Accept signature
      const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
      const acceptKey = crypto
        .createHash('sha1')
        .update(clientKey + GUID)
        .digest('base64');

      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n'
      ];

      socket.write(responseHeaders.join('\r\n'));

      const client = {
        id: crypto.randomUUID(),
        socket,
        connectedAt: new Date().toISOString()
      };

      this.wsClients.add(client);
      this.emit('client:connected', client);

      // Send initial welcome message with server state snapshot
      this.sendToClient(client, {
        type: 'CONNECTED',
        clientId: client.id,
        serverTime: new Date().toISOString()
      });

      socket.on('data', (buffer) => {
        this._handleWebSocketFrame(client, buffer);
      });

      socket.on('close', () => {
        this.wsClients.delete(client);
        this.emit('client:disconnected', client);
      });

      socket.on('error', (err) => {
        console.error('[WS Error]', err.message);
        this.wsClients.delete(client);
      });
    });
  }

  /**
   * Handle incoming WebSocket frames
   */
  _handleWebSocketFrame(client, buffer) {
    if (buffer.length < 2) return;

    const firstByte = buffer[0];
    const opcode = firstByte & 0x0f;

    // Close frame
    if (opcode === 0x08) {
      client.socket.end();
      return;
    }

    // Ping frame -> Send Pong
    if (opcode === 0x09) {
      client.socket.write(Buffer.from([0x8a, 0x00]));
      return;
    }

    // Text frame
    if (opcode === 0x01) {
      const secondByte = buffer[1];
      const isMasked = (secondByte & 0x80) === 0x80;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        payloadLength = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskingKey = null;
      if (isMasked) {
        maskingKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }

      const payload = buffer.slice(offset, offset + payloadLength);
      if (isMasked && maskingKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskingKey[i % 4];
        }
      }

      try {
        const message = JSON.parse(payload.toString('utf-8'));
        this._handleClientMessage(client, message);
      } catch (e) {
        // Raw text message
        this.emit('message', { client, raw: payload.toString('utf-8') });
      }
    }
  }

  _handleClientMessage(client, message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'PING':
        this.sendToClient(client, { type: 'PONG', timestamp: Date.now() });
        break;
      case 'GET_STATE':
        this.sendToClient(client, { type: 'STATE', data: this.db.exportData() });
        break;
      case 'SYNC_STATE':
        if (message.data) {
          this.db.importData(message.data);
          this.broadcast({ type: 'STATE_UPDATED', data: this.db.exportData() }, client);
        }
        break;
      default:
        this.emit('client:message', { client, message });
    }
  }

  /**
   * Encode and send a JSON packet to a specific WebSocket client
   */
  sendToClient(client, data) {
    if (!client || !client.socket || client.socket.destroyed) return;

    try {
      const payload = Buffer.from(JSON.stringify(data), 'utf-8');
      const length = payload.length;

      let header;
      if (length <= 125) {
        header = Buffer.from([0x81, length]);
      } else if (length <= 65535) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
      }

      client.socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      console.error('[WS Send Error]', e);
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(data, excludeClient = null) {
    this.wsClients.forEach((client) => {
      if (client !== excludeClient) {
        this.sendToClient(client, data);
      }
    });
  }

  /**
   * Get runtime server metadata
   */
  getInfo() {
    return {
      host: this.host,
      port: this.port,
      apiUrl: `http://${this.host}:${this.port}/api`,
      wsUrl: `ws://${this.host}:${this.port}/ws`,
      connectedClients: this.wsClients.size,
      isRunning: this.isRunning
    };
  }

  /**
   * Graceful stop
   */
  stop() {
    if (this.db) {
      this.db.flush();
    }
    this.wsClients.forEach(c => c.socket.destroy());
    this.wsClients.clear();

    if (this.httpServer) {
      this.httpServer.close();
      this.isRunning = false;
    }
  }
}

module.exports = BackendServer;
