/**
 * ai-agent.js — Autonomous AI Agent for App-Pair Workspace
 * 
 * Provides:
 * - Natural language intent parsing and entity extraction
 * - Universal email & credential detection (e.g. "enter my mail - user@gmail.com")
 * - Smart Sign-In / Login recognition (e.g. "sign in into my account")
 * - Fuzzy app & URL matcher (e.g. "open my gmail account", "open my playlist")
 * - Webview DOM automation (filling credentials, typing into forms, clicking buttons)
 * - Multi-turn conversation and step-by-step task execution
 * - Optional Cloud LLM integration (Gemini / OpenAI) with intelligent local offline fallback
 */

class AIAgent {
  constructor(options = {}) {
    this.workspace = options.workspace || null;
    const hasStorage = typeof localStorage !== 'undefined';
    this.apiKey = hasStorage ? (localStorage.getItem('ai_agent_api_key') || '') : '';
    this.provider = hasStorage ? (localStorage.getItem('ai_agent_provider') || 'gemini') : 'gemini'; // 'gemini' | 'openai' | 'local'
    this.history = [];
    this.systemPrompt = `You are Jarvis, the Autonomous AI Agent embedded inside App-Pair Workspace. 
You help the user control their workspace, open web apps and desktop software, interact with web pages, enter credentials and form inputs, search the web, create notes, manage tasks, save code snippets, scrape data, and boost productivity.
When asked to perform an action, clearly state what you are doing and produce the action command.`;
  }

  setApiKey(key, provider = 'gemini') {
    this.apiKey = key;
    this.provider = provider;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ai_agent_api_key', key);
      localStorage.setItem('ai_agent_provider', provider);
    }
  }

  getSettings() {
    return {
      apiKey: this.apiKey,
      provider: this.provider,
      hasApiKey: !!this.apiKey
    };
  }

  /**
   * Process a user prompt and return structured response with actions
   */
  async processCommand(userPrompt) {
    if (!userPrompt || !userPrompt.trim()) return null;

    const trimmed = userPrompt.trim();
    this.history.push({ role: 'user', content: trimmed, timestamp: new Date().toISOString() });

    // Step 1: Rule & NLP Intent Recognition (runs locally and instantaneously)
    const localIntent = this._parseLocalIntent(trimmed);

    let responseText = '';
    let actions = [];

    if (localIntent && localIntent.confidence > 0.6) {
      actions = localIntent.actions;
      responseText = localIntent.response;
    } else if (this.apiKey) {
      // Step 2: If LLM API key is configured, query LLM for complex tasks
      try {
        const llmResult = await this._queryLLM(trimmed);
        responseText = llmResult.text;
        actions = llmResult.actions.length > 0 ? llmResult.actions : this._fallbackIntentExtraction(trimmed).actions;
      } catch (e) {
        console.warn('[AIAgent] LLM error, falling back to local engine:', e);
        const fallback = this._fallbackIntentExtraction(trimmed);
        responseText = fallback.response;
        actions = fallback.actions;
      }
    } else {
      // Step 3: Local intelligent fallback
      const fallback = this._fallbackIntentExtraction(trimmed);
      responseText = fallback.response;
      actions = fallback.actions;
    }

    // Step 4: Execute actions on the workspace
    const executionResults = await this._executeActions(actions);

    const agentMessage = {
      role: 'agent',
      content: responseText,
      actions: executionResults,
      timestamp: new Date().toISOString()
    };

    this.history.push(agentMessage);
    return agentMessage;
  }

  /**
   * Local Intent & Entity Extraction Engine
   */
  _parseLocalIntent(prompt) {
    const p = prompt.toLowerCase().trim();

    // ========================================================
    // 1. UNIVERSAL EMAIL & CREDENTIAL DETECTION
    // ========================================================
    // Matches ANY email address in the user's prompt (e.g. "enter my mail - user@gmail.com", "my email is ...", "user@gmail.com")
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
    const emailMatch = prompt.match(emailRegex);
    if (emailMatch) {
      const email = emailMatch[1].trim();
      return {
        confidence: 0.99,
        response: `🔑 Entering credential **"${email}"** into Google / Gmail Sign-In and clicking Next...`,
        actions: [{ type: 'FILL_CREDENTIALS', email, autoSubmit: true }]
      };
    }

    // ========================================================
    // 2. SIGN IN / LOGIN TO ACCOUNT
    // ========================================================
    // Patterns: "sign in into my account", "sign in to my account", "login to my account", "sign into gmail", "log in to google", "sign in"
    if (p.match(/(?:sign\s*in|log\s*in|login|signin)\s*(?:in\s*to|into|to|on)?\s*(?:my\s+)?(?:account|google|gmail|email|mail)?/i)) {
      return {
        confidence: 0.98,
        response: `🔐 Opening **Google Sign-In** in full window view... Please tell me your email address (or type: **"enter my mail - yourname@gmail.com"**) to fill it automatically!`,
        actions: [
          { type: 'OPEN_URL', url: 'https://accounts.google.com/signin', name: 'Google Sign-In', icon: 'mail' },
          { type: 'FOCUS_LOGIN_INPUT' }
        ]
      };
    }

    // General credentials request without an email provided: "enter my credentials", "fill login"
    if (p.match(/^(?:please\s+)?(?:enter|fill|type)\s+(?:my\s+)?(?:credentials|gmail\s+credentials|login\s+details|email\s+and\s+password|login|details)/i)) {
      return {
        confidence: 0.95,
        response: `🔑 I'm ready to enter your credentials into the login page! Please provide your email address (e.g. **"enter my mail - yourname@gmail.com"**).`,
        actions: [{ type: 'FOCUS_LOGIN_INPUT' }]
      };
    }

    // Patterns: "click next", "click sign in", "click login", "click submit", "press next", "click button"
    const clickMatch = p.match(/^(?:please\s+)?(?:click|press|hit|tap|submit)\s+(?:on\s+)?(?:the\s+)?(?:button\s+)?["']?(.+?)["']?$/i);
    if (clickMatch) {
      const targetBtn = clickMatch[1].trim();
      if (!['youtube', 'google', 'chatgpt', 'notion'].includes(targetBtn)) {
        return {
          confidence: 0.95,
          response: `👆 Clicking **"${targetBtn}"** on the active page...`,
          actions: [{ type: 'CLICK_ON_PAGE', target: targetBtn }]
        };
      }
    }

    // Patterns: "type ... in search", "type hello into input", "search for ..." inside active page
    const typeMatch = prompt.match(/^(?:please\s+)?(?:type|enter|input|write)\s+["']?(.+?)["']?\s+(?:in|into|on)\s+(?:the\s+)?(?:search|input|box|field|search\s+bar)$/i);
    if (typeMatch) {
      const textToType = typeMatch[1].trim();
      return {
        confidence: 0.95,
        response: `⌨️ Typing **"${textToType}"** into the active search field...`,
        actions: [{ type: 'TYPE_INTO_PAGE', text: textToType }]
      };
    }

    // ========================================================
    // 3. DUAL-APP SPLIT VIEW LAUNCHER (Feature 1)
    // ========================================================
    // Matches: "open Google and Notes", "launch Spotify with Notion", "pair VS Code with ChatGPT in 70/30", "open https://leetcode.com and Idea Notes", etc.
    const pairMatch = p.match(/^(?:please\s+)?(?:open|launch|start|pair|split|run|set up)\s+(.+?)\s+(?:and|with|\+|alongside|\&)\s+(.+)$/i);
    if (pairMatch) {
      let rawPartA = pairMatch[1].trim();
      let rawPartB = pairMatch[2].trim();

      // Check if this was a search query instead (e.g. "open youtube and search lofi")
      const isSearchIntent = rawPartB.match(/^(?:search|find|play|look for)\b/i);
      if (!isSearchIntent) {
        let ratio = 50;
        const ratioMatch = rawPartB.match(/\s+(?:in|at|with)\s+(\d{1,2})\/(\d{1,2})/i) || p.match(/\b(30\/70|70\/30|50\/50|60\/40|40\/60|80\/20|20\/80)\b/);
        if (ratioMatch) {
          ratio = parseInt(ratioMatch[1].split('/')[0], 10);
          rawPartB = rawPartB.replace(/\s+(?:in|at|with)\s+\d{1,2}\/\d{1,2}/i, '').trim();
        }

        const appA = this._resolveAppEntity(rawPartA);
        const appB = this._resolveAppEntity(rawPartB);

        return {
          confidence: 0.99,
          response: `⚡ Launching **${appA.name}** + **${appB.name}** in ${ratio}/${100 - ratio} Split View...`,
          actions: [
            {
              type: 'LAUNCH_SPLIT_PAIR',
              appA,
              appB,
              ratio,
              isNativeSnap: !!(appA.isNative || appB.isNative)
            }
          ]
        };
      }
    }

    // ========================================================
    // 4. OPEN APP / WEBSITE (FUZZY MATCHING WITH SYNONYMS)
    // ========================================================
    
    // Patterns: "open my gmail account", "open gmail", "go to my playlist", "launch chatgpt", "open notepad"
    const openMatch = p.match(/^(?:please\s+)?(?:open|launch|start|switch to|go to|show|run|navigate to|take me to|login to|sign in to)\s+(.+)$/i);
    if (openMatch) {
      const rawTarget = openMatch[1].trim();

      // Check for search intent inside open: "open youtube and search lofi"
      const andSearchMatch = rawTarget.match(/^([a-z0-9\s]+?)\s+(?:and\s+)?(?:search|find|play|look for)\s+(?:for\s+)?(.+)$/i);
      if (andSearchMatch) {
        const appName = andSearchMatch[1].trim();
        const searchQuery = andSearchMatch[2].trim();
        return this._buildSearchAction(appName, searchQuery);
      }

      // Check native system apps
      if (['notepad', 'notepad.exe', 'calculator', 'calc', 'calc.exe', 'cmd', 'command prompt', 'terminal', 'paint', 'mspaint'].some(k => rawTarget.includes(k))) {
        let exec = 'notepad.exe';
        if (rawTarget.includes('calc')) exec = 'calc.exe';
        if (rawTarget.includes('cmd') || rawTarget.includes('terminal')) exec = 'cmd.exe';
        if (rawTarget.includes('paint')) exec = 'mspaint.exe';

        return {
          confidence: 0.95,
          response: `🚀 Launching **${rawTarget.toUpperCase()}** on your computer...`,
          actions: [{ type: 'LAUNCH_DESKTOP_APP', exec, name: rawTarget }]
        };
      }

      // Sanitize target by stripping prefixes ("my", "the", "a", "personal", "work") and suffixes ("account", "inbox", "page", "website", "site", "web", "app", "dashboard", "portal")
      let cleanTarget = rawTarget
        .replace(/^(my|the|an?|personal|work)\s+/i, '')
        .replace(/\s+(account|inbox|page|website|site|web|app|dashboard|portal|login|signin|sign-in)$/i, '')
        .trim();

      // Web App Synonym Map
      const appMap = [
        {
          keys: ['gmail', 'mail', 'email', 'google mail', 'my mail', 'google email', 'inbox'],
          app: { name: 'Gmail', url: 'https://mail.google.com', icon: 'mail' }
        },
        {
          keys: ['playlist', 'my playlist', 'spotify', 'spotify playlist', 'music', 'songs', 'audio'],
          app: { name: 'Spotify', url: 'https://open.spotify.com', icon: 'music' }
        },
        {
          keys: ['chatgpt', 'chat gpt', 'openai', 'gpt', 'ai chat'],
          app: { name: 'ChatGPT', url: 'https://chat.openai.com', icon: 'message-square' }
        },
        {
          keys: ['youtube', 'yt', 'videos', 'video'],
          app: { name: 'YouTube', url: 'https://www.youtube.com', icon: 'youtube' }
        },
        {
          keys: ['google', 'google search', 'search engine'],
          app: { name: 'Google', url: 'https://www.google.com', icon: 'search' }
        },
        {
          keys: ['notion', 'workspace', 'my notion'],
          app: { name: 'Notion', url: 'https://www.notion.so', icon: 'file-text' }
        },
        {
          keys: ['github', 'git', 'my repo', 'repositories'],
          app: { name: 'GitHub', url: 'https://github.com', icon: 'github' }
        },
        {
          keys: ['figma', 'designs', 'design'],
          app: { name: 'Figma', url: 'https://www.figma.com', icon: 'layout' }
        },
        {
          keys: ['whatsapp', 'web whatsapp'],
          app: { name: 'WhatsApp', url: 'https://web.whatsapp.com', icon: 'message-circle' }
        },
        {
          keys: ['twitter', 'x', 'tweets'],
          app: { name: 'X / Twitter', url: 'https://x.com', icon: 'twitter' }
        },
        {
          keys: ['reddit'],
          app: { name: 'Reddit', url: 'https://www.reddit.com', icon: 'globe' }
        },
        {
          keys: ['notes', 'note', 'idea notebook', 'my notes'],
          app: { name: 'Idea Notebook', isBuiltIn: true, pane: 'notes', icon: 'book-open' }
        },
        {
          keys: ['tasks', 'task board', 'kanban', 'my tasks', 'todo list'],
          app: { name: 'Task Board', isBuiltIn: true, pane: 'tasks', icon: 'check-square' }
        },
        {
          keys: ['palette', 'common palette', 'clipboard'],
          app: { name: 'Common Palette', isPalette: true, icon: 'sparkles' }
        },
        {
          keys: ['sketchpad', 'canvas', 'drawing'],
          app: { name: 'Sketchpad', isPalette: true, tab: 'sketch-tab', icon: 'palette' }
        }
      ];

      // Find matching app in synonym map
      for (const entry of appMap) {
        if (entry.keys.some(k => cleanTarget === k || cleanTarget.includes(k) || rawTarget.includes(k))) {
          return {
            confidence: 0.98,
            response: `✨ Opening **${entry.app.name}** in full window view...`,
            actions: [{ type: 'OPEN_APP', app: entry.app }]
          };
        }
      }

      // Check if it's a direct URL
      let url = rawTarget;
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(rawTarget) || rawTarget.startsWith('http')) {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        const name = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        return {
          confidence: 0.92,
          response: `🌐 Opening **${name}** (${url})...`,
          actions: [{ type: 'OPEN_URL', url, name }]
        };
      }
    }

    // ========================================================
    // 4. SEARCH WEB / YOUTUBE / GOOGLE
    // ========================================================
    const searchMatch = p.match(/^(?:search|google|find|look up)\s+(?:(youtube|google|duckduckgo)\s+)?(?:(on|in)\s+(youtube|google)\s+)?(?:for\s+)?(.+)$/i);
    if (searchMatch) {
      const specificEngine = searchMatch[1] || searchMatch[3] || (p.includes('youtube') ? 'youtube' : 'google');
      let query = (searchMatch[4] || '').replace(/^(?:youtube|google|on youtube|on google|for)\s+/i, '').replace(/^for\s+/i, '').trim();
      return this._buildSearchAction(specificEngine, query);
    }

    // ========================================================
    // 5. CREATE / ADD TASK
    // ========================================================
    const taskMatch = prompt.match(/^(?:add|create|make|new)\s+task:?\s*(.+)$/i) || prompt.match(/^todo:?\s*(.+)$/i);
    if (taskMatch) {
      const taskText = taskMatch[1].trim();
      let priority = 'medium';
      if (p.includes('urgent') || p.includes('high priority') || p.includes('important')) priority = 'high';
      if (p.includes('low priority')) priority = 'low';

      return {
        confidence: 0.95,
        response: `📋 Added new task to your Kanban Board: **"${taskText}"** (Priority: ${priority.toUpperCase()})`,
        actions: [{ type: 'CREATE_TASK', text: taskText, priority }]
      };
    }

    // ========================================================
    // 6. CREATE / TAKE NOTE
    // ========================================================
    const noteMatch = prompt.match(/^(?:take|write|add|create|save)?\s*(?:a\s+)?note:?\s*(.+)$/i);
    if (noteMatch) {
      const noteContent = noteMatch[1].trim();
      return {
        confidence: 0.9,
        response: `📝 Saved note to your Idea Notebook!`,
        actions: [{ type: 'CREATE_NOTE', content: noteContent }]
      };
    }

    // ========================================================
    // 7. SAVE CODE SNIPPET
    // ========================================================
    const snippetMatch = prompt.match(/^(?:save|add|create)\s+snippet:?\s*([\s\S]+)$/i);
    if (snippetMatch) {
      const code = snippetMatch[1].trim();
      return {
        confidence: 0.9,
        response: `💾 Saved code snippet to Common Palette clipboard!`,
        actions: [{ type: 'SAVE_SNIPPET', code, title: 'AI Saved Snippet' }]
      };
    }

    // ========================================================
    // 8. SCRAPE URL
    // ========================================================
    const scrapeMatch = prompt.match(/^(?:scrape|extract|fetch|read)\s+(?:from\s+)?(https?:\/\/[^\s]+)/i);
    if (scrapeMatch) {
      const url = scrapeMatch[1];
      return {
        confidence: 0.95,
        response: `🕷️ Scraping and analyzing webpage: ${url}...`,
        actions: [{ type: 'SCRAPE_URL', url }]
      };
    }

    // ========================================================
    // 9. VIEW MODE SWITCHING
    // ========================================================
    if (p.includes('split view') || p.includes('split screen') || p.includes('side by side') || p.includes('split mode')) {
      return {
        confidence: 0.95,
        response: `🔀 Switched workspace to **Dual Split-Pair Mode**!`,
        actions: [{ type: 'SET_VIEW_MODE', mode: 'split' }]
      };
    }
    if (p.includes('full window') || p.includes('full screen') || p.includes('single app') || p.includes('full view')) {
      return {
        confidence: 0.95,
        response: `🔲 Switched workspace to **Full Window App View**!`,
        actions: [{ type: 'SET_VIEW_MODE', mode: 'full' }]
      };
    }

    return null;
  }

  _resolveAppEntity(raw) {
    if (!raw) return { type: 'notes', name: 'Idea Notes', icon: 'book-open' };
    const clean = raw.trim().replace(/^["']|["']$/g, '');
    const lower = clean.toLowerCase();

    // Raw URLs & domain shorthands
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      const hostname = clean.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
      return { type: 'custom-web', name: hostname, url: clean, icon: 'globe' };
    }
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(clean) || lower.startsWith('localhost:')) {
      const url = lower.startsWith('localhost:') ? 'http://' + clean : 'https://' + clean;
      return { type: 'custom-web', name: clean.split('/')[0], url, icon: 'globe' };
    }

    // Built-in Workspace Tools
    if (lower.includes('google') || lower === 'search') return { type: 'google', name: 'Google Search', url: 'https://www.google.com', icon: 'globe' };
    if (lower.includes('spotify') || lower.includes('music') || lower.includes('playlist')) return { type: 'spotify', name: 'Spotify', url: 'https://open.spotify.com', icon: 'music' };
    if (lower.includes('github') || lower.includes('repo')) return { type: 'github', name: 'GitHub', url: 'https://github.com', icon: 'github' };
    if (lower.includes('chatgpt') || lower.includes('gpt') || lower.includes('openai')) return { type: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', icon: 'message-square' };
    if (lower.includes('notion')) return { type: 'notion', name: 'Notion', url: 'https://www.notion.so', icon: 'file-text' };
    if (lower.includes('pdf') || lower.includes('contract')) return { type: 'pdf', name: 'Local PDF Reader', icon: 'file-check' };
    if (lower.includes('note') || lower.includes('notebook')) return { type: 'notes', name: 'Idea Notes', icon: 'book-open' };
    if (lower.includes('task') || lower.includes('kanban') || lower.includes('sprint') || lower.includes('board')) return { type: 'tasks', name: 'Task Board', icon: 'check-square' };
    if (lower.includes('word') || lower.includes('docx') || lower.includes('doc')) return { type: 'word', name: 'Word Document Studio', icon: 'file-edit' };

    // Standard Windows Desktop Native Apps
    if (lower.includes('notepad')) return { type: 'local-app', name: 'Notepad', exec: 'notepad.exe', path: 'notepad.exe', isNative: true, icon: 'file-text' };
    if (lower.includes('calc')) return { type: 'local-app', name: 'Calculator', exec: 'calc.exe', path: 'calc.exe', isNative: true, icon: 'hash' };
    if (lower.includes('code') || lower.includes('vs code') || lower.includes('vscode')) return { type: 'local-app', name: 'VS Code', exec: 'code.cmd', path: 'code.cmd', isNative: true, icon: 'code' };
    if (lower.includes('paint') || lower.includes('mspaint')) return { type: 'local-app', name: 'Paint', exec: 'mspaint.exe', path: 'mspaint.exe', isNative: true, icon: 'image' };
    if (lower.includes('terminal') || lower.includes('cmd') || lower.includes('command prompt')) return { type: 'local-app', name: 'Command Prompt', exec: 'cmd.exe', path: 'cmd.exe', isNative: true, icon: 'terminal' };

    // Check custom saved laptop apps in localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        const custom = JSON.parse(localStorage.getItem('app_pair_custom_apps') || '[]');
        const found = custom.find(c => c.name && (c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())));
        if (found) {
          if (found.type === 'local') {
            return { type: 'local-app', name: found.name, path: found.path, isNative: true, icon: found.icon || 'laptop' };
          } else {
            return { type: 'custom-web', name: found.name, url: found.url, icon: found.icon || 'globe' };
          }
        }
      } catch (e) {}
    }

    // Default to search or webview
    return { type: 'google', name: clean, url: 'https://www.google.com/search?q=' + encodeURIComponent(clean), icon: 'globe' };
  }

  _buildSearchAction(engine, query) {
    if (!query) query = 'trending';
    const isYT = engine.toLowerCase().includes('youtube') || engine.toLowerCase().includes('yt');
    const url = isYT 
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    return {
      confidence: 0.95,
      response: `🔍 Searching ${isYT ? 'YouTube' : 'Google'} for **"${query}"** in full window view...`,
      actions: [{
        type: 'OPEN_URL',
        url,
        name: isYT ? `YouTube: ${query}` : `Google: ${query}`,
        icon: isYT ? 'youtube' : 'search'
      }]
    };
  }

  _fallbackIntentExtraction(prompt) {
    const p = prompt.toLowerCase();
    
    // Greeting
    if (['hi', 'hello', 'hey', 'jarvis', 'help', 'what can you do'].some(w => p === w || p.startsWith(w + ' '))) {
      return {
        response: `👋 Hello! I am your **Autonomous Workspace AI Agent**.
        
Here are some things I can do for you:
- 🌐 **"Open my Gmail account"**, **"Open my playlist"**, **"Open ChatGPT"**, **"Open YouTube"**
- 🔑 **"Enter my mail - user@gmail.com"**, **"Sign in into my account"**, **"Click Next"**
- 🔍 **"Search YouTube for lo-fi beats"** or **"Google latest tech news"**
- 📋 **"Add task: Review pull request with high priority"**
- 📝 **"Take a note: Meeting ideas for project launch"**
- 💾 **"Save snippet: const x = 42;"**
- 💻 **"Open Notepad"** or **"Open Calculator"**
- 🔀 **"Switch to split view"** or **"Switch to full window"**

What would you like me to do?`,
        actions: []
      };
    }

    // Default: treat as a smart Google search or general assist
    return {
      response: `💡 I'll help you search for **"${prompt}"** across the web:`,
      actions: [{
        type: 'OPEN_URL',
        url: `https://www.google.com/search?q=${encodeURIComponent(prompt)}`,
        name: `Search: ${prompt.substring(0, 25)}...`,
        icon: 'search'
      }]
    };
  }

  /**
   * Execute extracted actions on the UI workspace
   */
  async _executeActions(actions) {
    const results = [];
    if (!this.workspace || !Array.isArray(actions)) return results;

    for (const action of actions) {
      try {
        let status = 'success';
        let detail = '';

        switch (action.type) {
          case 'LAUNCH_SPLIT_PAIR':
            if (this.workspace && this.workspace.launchSplitPair) {
              await this.workspace.launchSplitPair(action.appA, action.appB, action.ratio);
              detail = `Launched ${action.appA.name} and ${action.appB.name} in Split View (${action.ratio}/${100 - action.ratio})`;
            } else if (typeof window !== 'undefined' && typeof window.launchCustomSplitPair === 'function') {
              await window.launchCustomSplitPair(action.appA, action.appB, action.ratio);
              detail = `Launched ${action.appA.name} and ${action.appB.name} in Split View`;
            }
            break;

          case 'OPEN_APP':
            if (this.workspace.openApp) {
              this.workspace.openApp(action.app);
              detail = `Opened ${action.app.name}`;
            }
            break;

          case 'OPEN_URL':
            if (this.workspace.openUrl) {
              this.workspace.openUrl(action.url, action.name || 'Web App', action.icon || 'globe');
              detail = `Navigated to ${action.url}`;
            }
            break;

          case 'FILL_CREDENTIALS':
            if (this.workspace.fillCredentials) {
              const res = await this.workspace.fillCredentials(action.email, action.password, action.autoSubmit);
              detail = res?.message || `Entered credentials into form`;
            }
            break;

          case 'FOCUS_LOGIN_INPUT':
            if (this.workspace.focusLoginInput) {
              await this.workspace.focusLoginInput();
              detail = `Focused login field`;
            }
            break;

          case 'CLICK_ON_PAGE':
            if (this.workspace.clickOnPage) {
              const res = await this.workspace.clickOnPage(action.target);
              detail = res?.message || `Clicked "${action.target}"`;
            }
            break;

          case 'TYPE_INTO_PAGE':
            if (this.workspace.typeIntoPage) {
              const res = await this.workspace.typeIntoPage(action.text);
              detail = res?.message || `Typed "${action.text}"`;
            }
            break;

          case 'LAUNCH_DESKTOP_APP':
            if (window.api && window.api.system && window.api.system.launchApp) {
              await window.api.system.launchApp(action.exec, action.name);
              detail = `Launched ${action.exec}`;
            } else {
              detail = `Launch requested: ${action.exec}`;
            }
            break;

          case 'CREATE_TASK':
            if (this.workspace.createTask) {
              this.workspace.createTask(action.text, action.priority);
              detail = `Created task: "${action.text}"`;
            }
            break;

          case 'CREATE_NOTE':
            if (this.workspace.appendNote) {
              this.workspace.appendNote(action.content);
              detail = `Note saved to notebook`;
            }
            break;

          case 'SAVE_SNIPPET':
            if (this.workspace.saveSnippet) {
              this.workspace.saveSnippet(action.code, action.title);
              detail = `Saved snippet to palette`;
            }
            break;

          case 'SCRAPE_URL':
            if (this.workspace.scrapeUrl) {
              const scrapeResult = await this.workspace.scrapeUrl(action.url);
              detail = scrapeResult ? `Scraped: ${scrapeResult.title}` : `Scrape initiated`;
            }
            break;

          case 'SET_VIEW_MODE':
            if (this.workspace.setViewMode) {
              this.workspace.setViewMode(action.mode);
              detail = `Mode set to ${action.mode}`;
            }
            break;

          default:
            status = 'skipped';
            detail = `Unknown action: ${action.type}`;
        }

        results.push({ action: action.type, status, detail });
      } catch (err) {
        console.error('[AIAgent] Action execution error:', err);
        results.push({ action: action.type, status: 'error', detail: err.message });
      }
    }

    return results;
  }

  /**
   * Query Cloud LLM (Gemini or OpenAI) if API Key is configured
   */
  async _queryLLM(prompt) {
    if (this.provider === 'gemini') {
      return this._queryGemini(prompt);
    } else {
      return this._queryOpenAI(prompt);
    }
  }

  async _queryGemini(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [{
        parts: [{ text: `${this.systemPrompt}\nUser request: "${prompt}"\nIf you want to perform an action, append JSON block: \`\`\`json\n{"actions": [{"type": "OPEN_APP|OPEN_URL|FILL_CREDENTIALS|CLICK_ON_PAGE|TYPE_INTO_PAGE|CREATE_TASK|CREATE_NOTE|SAVE_SNIPPET", ...}]}\`\`\`` }]
      }]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Gemini API error');

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const actions = this._extractJsonActions(text);
    const cleanText = text.replace(/```json[\s\S]*?```/gi, '').trim();

    return { text: cleanText || text, actions };
  }

  async _queryOpenAI(prompt) {
    const url = 'https://api.openai.com/v1/chat/completions';
    const payload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `${this.systemPrompt}\nIf you trigger actions, return JSON block: \`\`\`json\n{"actions": [{"type": "OPEN_APP|OPEN_URL|FILL_CREDENTIALS|CLICK_ON_PAGE|TYPE_INTO_PAGE|CREATE_TASK|CREATE_NOTE|SAVE_SNIPPET", ...}]}\`\`\`` },
        { role: 'user', content: prompt }
      ]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'OpenAI API error');

    const text = data.choices?.[0]?.message?.content || '';
    const actions = this._extractJsonActions(text);
    const cleanText = text.replace(/```json[\s\S]*?```/gi, '').trim();

    return { text: cleanText || text, actions };
  }

  _extractJsonActions(text) {
    try {
      const match = text.match(/```json([\s\S]*?)```/i);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (parsed.actions && Array.isArray(parsed.actions)) {
          return parsed.actions;
        }
      }
    } catch (e) {}
    return [];
  }
}

if (typeof window !== 'undefined') {
  window.AIAgent = AIAgent;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIAgent;
}
