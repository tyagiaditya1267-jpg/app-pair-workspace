/**
 * routes/search.js — Unified Full-Text Search and Health check
 */

function registerSearchAndHealthRoutes(router, db, serverInfo) {
  // ---- Health Check ----
  router.get('/api/health', (req, res) => {
    res.success({
      status: 'healthy',
      version: '2.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      server: serverInfo()
    }, 'Backend services are running smoothly');
  });

  // ---- Unified Search across all collections ----
  router.get('/api/search', (req, res) => {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.error('Query parameter "q" is required', 400);
    }
    const limit = parseInt(req.query.limit, 10) || 30;
    const results = db.search(query, { limit });
    res.success({
      query,
      count: results.length,
      results
    }, `Found ${results.length} matches`);
  });
}

module.exports = registerSearchAndHealthRoutes;
