(() => {
  const ROOT_ID = 'fishing-pond-root-v2';
  let capturing = false;

  const isListing = () => /\/listing\/\d+/.test(location.pathname);

  function remove() {
    document.getElementById(ROOT_ID)?.remove();
  }

  function sendToBackground(data) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'ingest-listing',
          data
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || 'Ingest failed'));
            return;
          }

          resolve(response.result);
        }
      );
    });
  }

  function mount() {
    if (!isListing()) {
      remove();
      return;
    }

    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = ROOT_ID;

    root.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:2147483647;' +
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';

    const shadow = root.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        .p {
          display:flex;
          flex-direction:column;
          align-items:flex-end;
          gap:7px;
        }

        .s {
          display:none;
          max-width:380px;
          background:#090d12;
          color:#fff;
          padding:9px 12px;
          border-radius:10px;
          font-size:13px;
          box-shadow:0 8px 25px #0005;
        }

        .s.show {
          display:block;
        }

        button {
          border:0;
          border-radius:999px;
          padding:12px 17px;
          background:#2764ff;
          color:#fff;
          font-weight:700;
          font-size:14px;
          cursor:pointer;
          box-shadow:0 8px 25px #0004;
        }

        button:disabled {
          opacity:.65;
        }
      </style>

      <div class="p">
        <div class="s"></div>
        <button>Fishing Pond · Capture</button>
      </div>
    `;

    const button = shadow.querySelector('button');
    const status = shadow.querySelector('.s');

    let timer;

    const showStatus = (message, hold = false) => {
      clearTimeout(timer);

      status.textContent = message;
      status.classList.add('show');

      if (!hold) {
        timer = setTimeout(() => {
          status.classList.remove('show');
        }, 3000);
      }
    };

    const capture = async () => {
      if (capturing) return;

      capturing = true;
      button.disabled = true;
      button.textContent = 'Capturing…';

      try {
        const data = await window.FishingPondCollect();

        if (!data?.listing_id) {
          throw new Error('Listing not ready');
        }

        await sendToBackground(data);

        button.textContent = 'Saved ✓';
        showStatus(`Saved #${data.listing_id}`);

        setTimeout(() => {
          button.textContent = 'Fishing Pond · Capture';
          button.disabled = false;
        }, 1000);

      } catch (error) {
        button.textContent = 'Fishing Pond · Capture';
        button.disabled = false;

        showStatus(
          `Error: ${error?.message || String(error)}`,
          true
        );

      } finally {
        capturing = false;
      }
    };

    button.addEventListener('click', capture);

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'capture') {
        capture();
      }
    });

    document.documentElement.appendChild(root);
  }

  mount();

  let lastUrl = location.href;

  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      remove();
      setTimeout(mount, 120);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
