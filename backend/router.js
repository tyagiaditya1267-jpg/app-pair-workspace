/**
 * router.js — Lightweight REST API Router with Middleware & Path Param Matching
 */

const url = require('url');

class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
  }

  get(path, ...handlers) {
    this._addRoute('GET', path, handlers);
  }

  post(path, ...handlers) {
    this._addRoute('POST', path, handlers);
  }

  put(path, ...handlers) {
    this._addRoute('PUT', path, handlers);
  }

  delete(path, ...handlers) {
    this._addRoute('DELETE', path, handlers);
  }

  options(path, ...handlers) {
    this._addRoute('OPTIONS', path, handlers);
  }

  _addRoute(method, pathPattern, handlers) {
    const paramNames = [];
    const regexPattern = pathPattern
      .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);
    this.routes.push({
      method: method.toUpperCase(),
      pattern: pathPattern,
      regex,
      paramNames,
      handlers
    });
  }

  async handle(req, res) {
    // Enhance response with helper methods
    res.json = (data, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end(JSON.stringify(data));
    };

    res.error = (message, status = 500, details = null) => {
      res.json({ success: false, error: message, details }, status);
    };

    res.success = (data = {}, message = 'OK') => {
      res.json({ success: true, message, data });
    };

    // Handle CORS preflight OPTIONS immediately
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      });
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    req.pathname = parsedUrl.pathname;
    req.query = parsedUrl.query;
    req.params = {};

    // Body parsing for POST / PUT
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try {
        req.body = await this._parseBody(req);
      } catch (e) {
        return res.error('Invalid JSON payload in request body', 400);
      }
    } else {
      req.body = {};
    }

    // Execute global middlewares
    for (const mw of this.middlewares) {
      let nextCalled = false;
      await mw(req, res, () => { nextCalled = true; });
      if (!nextCalled && res.writableEnded) return;
    }

    // Match route
    for (const route of this.routes) {
      if (route.method === req.method) {
        const match = req.pathname.match(route.regex);
        if (match) {
          route.paramNames.forEach((name, i) => {
            req.params[name] = decodeURIComponent(match[i + 1]);
          });

          for (const handler of route.handlers) {
            try {
              let nextCalled = false;
              await handler(req, res, () => { nextCalled = true; });
              if (res.writableEnded) return;
            } catch (err) {
              console.error('[Router Error]', err);
              return res.error(err.message || 'Internal Server Error', 500);
            }
          }
          return;
        }
      }
    }

    // Route not found
    res.error(`Route ${req.method} ${req.pathname} not found`, 404);
  }

  _parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) { // 5MB limit
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body.trim()) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body });
        }
      });
      req.on('error', reject);
    });
  }
}

module.exports = Router;
