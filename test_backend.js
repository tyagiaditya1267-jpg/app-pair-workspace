const http = require('http');
const path = require('path');
const BackendServer = require('./backend/server');

async function runTests() {
  console.log('Testing BackendServer...');
  const server = new BackendServer({
    port: 4180,
    host: '127.0.0.1',
    storageDir: path.join(__dirname, 'test_data')
  });

  const info = await server.start();
  console.log('Server started:', info);

  // Helper request
  const request = (path, method = 'GET', body = null) => {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: info.port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  // 1. Health check
  const health = await request('/api/health');
  console.log('1. Health check status:', health.status, 'Data:', health.data.success);
  if (health.status !== 200 || !health.data.success) throw new Error('Health check failed');

  // 2. Create snippet
  const snippetRes = await request('/api/snippets', 'POST', {
    title: 'React Quick Hook',
    code: 'const [state, setState] = useState(null);',
    language: 'javascript',
    tags: ['react', 'hook']
  });
  console.log('2. Create snippet status:', snippetRes.status, 'Snippet ID:', snippetRes.data.data.id);
  if (snippetRes.status !== 200) throw new Error('Snippet creation failed');

  // 3. Create task
  const taskRes = await request('/api/tasks', 'POST', {
    text: 'Prepare backend architecture release',
    priority: 'high'
  });
  console.log('3. Create task status:', taskRes.status, 'Task ID:', taskRes.data.data.id);
  if (taskRes.status !== 200) throw new Error('Task creation failed');

  // 4. Search
  const searchRes = await request('/api/search?q=React');
  console.log('4. Full-text search result count:', searchRes.data.data.count);
  if (searchRes.data.data.count === 0) throw new Error('Search failed to find React snippet');

  server.stop();
  console.log('All backend tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
