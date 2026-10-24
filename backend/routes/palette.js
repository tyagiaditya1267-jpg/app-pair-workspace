/**
 * routes/palette.js — Snippets, Tasks, Notes, and Color Palette Endpoints
 */

function registerPaletteRoutes(router, db, broadcast) {
  // ---- Full State Sync ----
  router.get('/api/state', (req, res) => {
    res.success(db.exportData(), 'State retrieved');
  });

  router.post('/api/state/sync', (req, res) => {
    if (req.body && typeof req.body === 'object') {
      db.importData(req.body);
      broadcast({ type: 'STATE_UPDATED', data: db.exportData() });
      res.success(db.exportData(), 'State synchronized');
    } else {
      res.error('Invalid state payload', 400);
    }
  });

  // ---- Snippets ----
  router.get('/api/snippets', (req, res) => {
    res.success(db.getCollection('snippets'));
  });

  router.post('/api/snippets', (req, res) => {
    const { title, code, language, tags } = req.body;
    if (!code && !title) {
      return res.error('Snippet code or title is required', 400);
    }
    const snippet = db.insert('snippets', {
      title: title || 'Untitled Snippet',
      code: code || '',
      language: language || 'plaintext',
      tags: Array.isArray(tags) ? tags : []
    });
    broadcast({ type: 'SNIPPET_CREATED', snippet });
    res.success(snippet, 'Snippet created');
  });

  router.put('/api/snippets/:id', (req, res) => {
    const updated = db.update('snippets', req.params.id, req.body);
    if (!updated) return res.error('Snippet not found', 404);
    broadcast({ type: 'SNIPPET_UPDATED', snippet: updated });
    res.success(updated, 'Snippet updated');
  });

  router.delete('/api/snippets/:id', (req, res) => {
    const removed = db.remove('snippets', req.params.id);
    if (!removed) return res.error('Snippet not found', 404);
    broadcast({ type: 'SNIPPET_DELETED', id: req.params.id });
    res.success({ id: req.params.id }, 'Snippet deleted');
  });

  // ---- Tasks ----
  router.get('/api/tasks', (req, res) => {
    res.success(db.getCollection('tasks'));
  });

  router.post('/api/tasks', (req, res) => {
    const { text, priority, completed, dueDate } = req.body;
    if (!text) return res.error('Task text is required', 400);
    const task = db.insert('tasks', {
      text,
      completed: !!completed,
      priority: priority || 'medium',
      dueDate: dueDate || null
    });
    broadcast({ type: 'TASK_CREATED', task });
    res.success(task, 'Task created');
  });

  router.put('/api/tasks/:id', (req, res) => {
    const updated = db.update('tasks', req.params.id, req.body);
    if (!updated) return res.error('Task not found', 404);
    broadcast({ type: 'TASK_UPDATED', task: updated });
    res.success(updated, 'Task updated');
  });

  router.delete('/api/tasks/:id', (req, res) => {
    const removed = db.remove('tasks', req.params.id);
    if (!removed) return res.error('Task not found', 404);
    broadcast({ type: 'TASK_DELETED', id: req.params.id });
    res.success({ id: req.params.id }, 'Task deleted');
  });

  // ---- Notes ----
  router.get('/api/notes', (req, res) => {
    res.success(db.getCollection('notes'));
  });

  router.post('/api/notes', (req, res) => {
    const { title, body } = req.body;
    const note = db.insert('notes', {
      title: title || 'New Note',
      body: body || ''
    });
    broadcast({ type: 'NOTE_CREATED', note });
    res.success(note, 'Note created');
  });

  router.put('/api/notes/:id', (req, res) => {
    const updated = db.update('notes', req.params.id, req.body);
    if (!updated) return res.error('Note not found', 404);
    broadcast({ type: 'NOTE_UPDATED', note: updated });
    res.success(updated, 'Note updated');
  });

  // ---- Colors ----
  router.get('/api/colors', (req, res) => {
    res.success(db.getCollection('colors'));
  });

  router.post('/api/colors', (req, res) => {
    const { color } = req.body;
    if (!color) return res.error('Hex color is required', 400);
    const colors = db.getCollection('colors');
    if (!colors.includes(color)) {
      colors.push(color);
      db.setCollectionData('colors', colors);
    }
    broadcast({ type: 'COLORS_UPDATED', colors });
    res.success(colors, 'Color added');
  });

  router.delete('/api/colors', (req, res) => {
    const { color } = req.body || req.query;
    if (!color) return res.error('Color to remove is required', 400);
    let colors = db.getCollection('colors');
    colors = colors.filter(c => c.toLowerCase() !== color.toLowerCase());
    db.setCollectionData('colors', colors);
    broadcast({ type: 'COLORS_UPDATED', colors });
    res.success(colors, 'Color removed');
  });
}

module.exports = registerPaletteRoutes;
