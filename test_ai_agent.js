const AIAgent = require('./ai-agent.js');

async function testAIAgent() {
  console.log('Testing AIAgent universal email and sign-in matching...');

  const mockActions = [];
  const mockWorkspace = {
    openApp: (app) => { mockActions.push({ type: 'openApp', app }); },
    openUrl: (url, name) => { mockActions.push({ type: 'openUrl', url, name }); },
    createTask: (text, priority) => { mockActions.push({ type: 'createTask', text, priority }); },
    appendNote: (content) => { mockActions.push({ type: 'appendNote', content }); },
    saveSnippet: (code) => { mockActions.push({ type: 'saveSnippet', code }); },
    setViewMode: (mode) => { mockActions.push({ type: 'setViewMode', mode }); },
    fillCredentials: (email, pass, autoSubmit) => { mockActions.push({ type: 'fillCredentials', email, pass, autoSubmit }); return { success: true }; },
    clickOnPage: (target) => { mockActions.push({ type: 'clickOnPage', target }); return { success: true }; },
    typeIntoPage: (text) => { mockActions.push({ type: 'typeIntoPage', text }); return { success: true }; },
    focusLoginInput: () => { mockActions.push({ type: 'focusLoginInput' }); }
  };

  const agent = new AIAgent({ workspace: mockWorkspace });

  // Test 1: User's exact prompt "enter my mail - tyagiaditya1267@gmail.com"
  console.log('\n--- Test 1: "enter my mail - tyagiaditya1267@gmail.com" ---');
  let res = await agent.processCommand('enter my mail - tyagiaditya1267@gmail.com');
  console.log('Response:', res.content);
  console.log('Actions triggered:', res.actions);
  if (!mockActions.some(a => a.type === 'fillCredentials' && a.email === 'tyagiaditya1267@gmail.com')) {
    throw new Error('Test 1 failed: did not trigger fillCredentials for tyagiaditya1267@gmail.com');
  }

  // Test 2: User's exact prompt "sign in into my account"
  console.log('\n--- Test 2: "sign in into my account" ---');
  res = await agent.processCommand('sign in into my account');
  console.log('Response:', res.content);
  console.log('Actions triggered:', res.actions);
  if (!mockActions.some(a => a.type === 'openUrl' && a.url.includes('accounts.google.com/signin'))) {
    throw new Error('Test 2 failed: did not open Google Sign-In');
  }

  // Test 3: "open my gmail account"
  console.log('\n--- Test 3: "open my gmail account" ---');
  res = await agent.processCommand('open my gmail account');
  console.log('Response:', res.content);
  console.log('Actions triggered:', res.actions);
  if (!mockActions.some(a => a.type === 'openApp' && a.app.name === 'Gmail')) {
    throw new Error('Test 3 failed: did not open Gmail');
  }

  // Test 4: "open my playlist"
  console.log('\n--- Test 4: "open my playlist" ---');
  res = await agent.processCommand('open my playlist');
  console.log('Response:', res.content);
  console.log('Actions triggered:', res.actions);
  if (!mockActions.some(a => a.type === 'openApp' && a.app.name === 'Spotify')) {
    throw new Error('Test 4 failed: did not open Spotify');
  }

  console.log('\nAll tests passed successfully! 🚀');
}

testAIAgent().catch(err => {
  console.error('Test Error:', err);
  process.exit(1);
});
