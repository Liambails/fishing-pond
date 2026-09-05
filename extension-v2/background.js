async function sendCapture(tab) {
  if (!tab?.id || !tab?.url?.includes('trademe.co.nz/')) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'capture' });
  } catch (e) {
    console.error('Unable to send capture command:', e);
  }
}

chrome.action.onClicked.addListener(sendCapture);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-current-listing') return;

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  sendCapture(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ingest-listing') return;

  (async () => {
    try {
      const config = await chrome.storage.sync.get({
        endpoint: 'http://localhost:3000/api/ingest',
        token: ''
      });

      if (!config.endpoint) {
        throw new Error('No ingest endpoint configured');
      }

      const headers = {
        'Content-Type': 'application/json'
      };

      if (config.token) {
        headers['X-Fishing-Pond-Token'] = config.token;
      }

      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(message.data)
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      sendResponse({
        ok: true,
        result
      });

    } catch (error) {
      console.error('Fishing Pond ingest failed:', error);

      sendResponse({
        ok: false,
        error: error?.message || String(error)
      });
    }
  })();

  return true;
});
