/**
 * routes/registry.js — Registered Desktop Apps, Web Bookmarks & Categories
 */

function registerRegistryRoutes(router, db, broadcast, appRegistryService) {
  // ---- Apps ----
  router.get('/api/apps', (req, res) => {
    res.success(db.getCollection('apps'));
  });

  router.post('/api/apps', (req, res) => {
    const { name, path: appPath, icon, category } = req.body;
    if (!name || !appPath) return res.error('App name and path are required', 400);

    const app = db.insert('apps', {
      name,
      path: appPath,
      icon: icon || 'desktop',
      category: category || 'Utilities'
    });
    broadcast({ type: 'APP_ADDED', app });
    res.success(app, 'App registered');
  });

  router.delete('/api/apps/:id', (req, res) => {
    const removed = db.remove('apps', req.params.id);
    if (!removed) return res.error('App not found', 404);
    broadcast({ type: 'APP_REMOVED', id: req.params.id });
    res.success({ id: req.params.id }, 'App removed');
  });

  // ---- Sites (Web Bookmarks) ----
  router.get('/api/sites', (req, res) => {
    res.success(db.getCollection('sites'));
  });

  router.post('/api/sites', (req, res) => {
    const { name, url: siteUrl, icon, category } = req.body;
    if (!name || !siteUrl) return res.error('Site name and URL are required', 400);

    const site = db.insert('sites', {
      name,
      url: siteUrl,
      icon: icon || 'globe',
      category: category || 'General'
    });
    broadcast({ type: 'SITE_ADDED', site });
    res.success(site, 'Site bookmarked');
  });

  router.delete('/api/sites/:id', (req, res) => {
    const removed = db.remove('sites', req.params.id);
    if (!removed) return res.error('Site not found', 404);
    broadcast({ type: 'SITE_REMOVED', id: req.params.id });
    res.success({ id: req.params.id }, 'Site removed');
  });

  // ---- Categories ----
  router.get('/api/categories', (req, res) => {
    res.success(db.getCollection('categories'));
  });

  router.post('/api/categories', (req, res) => {
    const { name } = req.body;
    if (!name) return res.error('Category name is required', 400);
    const categories = db.getCollection('categories');
    if (!categories.includes(name)) {
      categories.push(name);
      db.setCollectionData('categories', categories);
    }
    broadcast({ type: 'CATEGORY_ADDED', category: name });
    res.success(categories, 'Category added');
  });

  // ---- Auto-Discovery ----
  router.get('/api/discover-apps', async (req, res) => {
    try {
      if (appRegistryService && typeof appRegistryService.discoverInstalledApps === 'function') {
        const apps = await appRegistryService.discoverInstalledApps();
        res.success(apps, 'Installed apps discovered');
      } else {
        res.success([], 'Discovery not available in standalone mode');
      }
    } catch (e) {
      res.error(e.message, 500);
    }
  });
}

module.exports = registerRegistryRoutes;
