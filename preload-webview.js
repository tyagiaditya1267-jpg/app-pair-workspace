const { contextBridge, ipcRenderer } = require('electron');

// We listen to text selections and send them to the parent application
window.addEventListener('mouseup', () => {
  const selectedText = window.getSelection().toString().trim();
  if (selectedText.length > 0) {
    ipcRenderer.sendToHost('webview-text-selected', selectedText);
  }
});

// We can also receive actions from the parent application
ipcRenderer.on('insert-text', (event, text) => {
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.contentEditable === 'true')) {
    if (activeEl.contentEditable === 'true') {
      activeEl.innerText += text;
    } else {
      activeEl.value += text;
    }
  }
});
