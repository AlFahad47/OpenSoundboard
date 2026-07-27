/**
 * The mobile remote UI, served as a single self-contained page by remote.ts.
 * Kept free of template literals so the outer string needs no escaping.
 */
export const REMOTE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#0d0d12" />
<title>OpenSoundboard Remote</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;background:#0d0d12;color:#eceaf5;font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
  header{position:sticky;top:0;z-index:5;background:rgba(13,13,18,.92);backdrop-filter:blur(12px);
         padding:14px 16px 10px;border-bottom:1px solid #22222e}
  h1{margin:0;font-size:17px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
  .dot{width:8px;height:8px;border-radius:50%;background:#4b4b5a;transition:background .2s}
  .dot.on{background:#41d18a;box-shadow:0 0 10px #41d18a}
  #search{width:100%;margin-top:10px;padding:11px 13px;border-radius:11px;border:1px solid #2a2a38;
          background:#16161f;color:inherit;font-size:16px;outline:none}
  #search:focus{border-color:#7c5cff}
  #chips{display:flex;gap:7px;overflow-x:auto;padding:10px 16px 0;scrollbar-width:none}
  #chips::-webkit-scrollbar{display:none}
  .chip{flex:0 0 auto;padding:6px 13px;border-radius:999px;background:#191922;border:1px solid #2a2a38;
        font-size:13px;color:#a8a6bd;white-space:nowrap}
  .chip.sel{background:#7c5cff;border-color:#7c5cff;color:#fff}
  #grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:9px;padding:14px 16px 130px}
  .pad{position:relative;aspect-ratio:1;border-radius:15px;border:1px solid #2a2a38;background:#16161f;
       display:flex;align-items:flex-end;padding:11px;font-size:13px;font-weight:550;text-align:left;
       overflow:hidden;-webkit-tap-highlight-color:transparent;color:inherit;line-height:1.25}
  .pad::before{content:"";position:absolute;inset:0;background:var(--c);opacity:.16;transition:opacity .18s}
  .pad::after{content:"";position:absolute;left:11px;top:11px;width:22px;height:22px;border-radius:7px;background:var(--c);opacity:.9}
  .pad span{position:relative;z-index:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .pad:active{transform:scale(.955)}
  .pad.playing::before{opacity:.42}
  .pad.playing{border-color:var(--c)}
  footer{position:fixed;left:0;right:0;bottom:0;background:rgba(19,19,26,.96);backdrop-filter:blur(14px);
         border-top:1px solid #262634;padding:12px 16px calc(14px + env(safe-area-inset-bottom))}
  .row{display:flex;gap:9px;align-items:center}
  button{font:inherit;color:inherit;border:1px solid #2f2f3e;background:#1e1e29;border-radius:11px;
         padding:11px 14px;flex:1;-webkit-tap-highlight-color:transparent}
  button:active{background:#282836}
  button.primary{background:#7c5cff;border-color:#7c5cff;color:#fff;font-weight:600}
  #vol{width:100%;margin-top:11px;accent-color:#7c5cff}
  #now{font-size:12.5px;color:#8a889f;margin-bottom:9px;height:16px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  #gate{padding:40px 22px;text-align:center}
  #gate input{width:100%;max-width:230px;margin:14px auto;display:block;text-align:center;font-size:22px;
              letter-spacing:.35em;padding:13px;border-radius:12px;border:1px solid #2a2a38;background:#16161f;color:inherit}
  .empty{grid-column:1/-1;text-align:center;color:#6d6b82;padding:44px 0;font-size:14px}
</style>
</head>
<body>
<div id="gate" hidden>
  <h1 style="justify-content:center">Enter PIN</h1>
  <input id="pin" inputmode="numeric" maxlength="8" placeholder="- - - -" />
  <button class="primary" style="max-width:230px;margin:0 auto" onclick="submitPin()">Connect</button>
  <p id="pinerr" style="color:#ff7b7b;font-size:13px;min-height:18px"></p>
</div>

<div id="app" hidden>
  <header>
    <h1><span class="dot" id="dot"></span> OpenSoundboard Remote</h1>
    <input id="search" placeholder="Search sounds" autocomplete="off" autocorrect="off" spellcheck="false" />
  </header>
  <div id="chips"></div>
  <div id="grid"></div>
  <footer>
    <div id="now">Nothing playing</div>
    <div class="row">
      <button onclick="cmd({type:'random'})">Random</button>
      <button onclick="cmd({type:'pause'})">Pause</button>
      <button class="primary" onclick="cmd({type:'stop'})">Stop all</button>
    </div>
    <input id="vol" type="range" min="0" max="100" value="100" />
  </footer>
</div>

<script>
(function () {
  var pin = sessionStorage.getItem('soundboard-pin') || '';
  var state = { sounds: [], categories: [], playing: null, paused: false, volume: 1 };
  var filter = '';
  var cat = 'all';
  var source = null;

  function qs(id) { return document.getElementById(id); }
  function withPin(path) { return pin ? path + (path.indexOf('?') < 0 ? '?' : '&') + 'pin=' + encodeURIComponent(pin) : path; }

  window.cmd = function (payload) {
    if (navigator.vibrate) navigator.vibrate(12);
    fetch(withPin('/command'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () {});
  };

  window.submitPin = function () {
    pin = qs('pin').value.trim();
    sessionStorage.setItem('soundboard-pin', pin);
    fetch(withPin('/needs-pin')).then(function (r) {
      if (r.status === 401) { qs('pinerr').textContent = 'Wrong PIN'; return; }
      qs('gate').hidden = true; qs('app').hidden = false; connect();
    }).catch(function () { qs('pinerr').textContent = 'Cannot reach OpenSoundboard'; });
  };

  function colorFor(s) { return s.color || '#7c5cff'; }

  function renderChips() {
    var host = qs('chips');
    var html = '<button class="chip' + (cat === 'all' ? ' sel' : '') + '" data-c="all">All</button>';
    for (var i = 0; i < state.categories.length; i++) {
      var c = state.categories[i];
      html += '<button class="chip' + (cat === c.id ? ' sel' : '') + '" data-c="' + c.id + '">' + esc(c.name) + '</button>';
    }
    host.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function render() {
    var grid = qs('grid');
    var needle = filter.toLowerCase();
    var list = state.sounds.filter(function (s) {
      if (cat !== 'all' && s.categoryId !== cat) return false;
      return !needle || s.name.toLowerCase().indexOf(needle) >= 0;
    });
    if (!list.length) {
      grid.innerHTML = '<div class="empty">' + (state.sounds.length ? 'No matches' : 'No sounds yet') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      html += '<button class="pad' + (state.playing === s.id ? ' playing' : '') + '" style="--c:' +
              esc(colorFor(s)) + '" data-id="' + esc(s.id) + '"><span>' + esc(s.name) + '</span></button>';
    }
    grid.innerHTML = html;
  }

  function renderNow() {
    var playing = null;
    for (var i = 0; i < state.sounds.length; i++) if (state.sounds[i].id === state.playing) playing = state.sounds[i];
    qs('now').textContent = playing ? (state.paused ? 'Paused - ' : 'Playing - ') + playing.name : 'Nothing playing';
  }

  function connect() {
    if (source) source.close();
    source = new EventSource(withPin('/events'));
    source.onopen = function () { qs('dot').classList.add('on'); };
    source.onerror = function () { qs('dot').classList.remove('on'); };
    source.onmessage = function (e) {
      try { state = JSON.parse(e.data); } catch (err) { return; }
      renderChips(); render(); renderNow();
      var vol = qs('vol');
      if (document.activeElement !== vol) vol.value = Math.round((state.volume || 0) * 100);
    };
  }

  qs('grid').addEventListener('click', function (e) {
    var pad = e.target.closest('.pad');
    if (pad) window.cmd({ type: 'play', id: pad.dataset.id });
  });
  qs('chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (chip) { cat = chip.dataset.c; renderChips(); render(); }
  });
  qs('search').addEventListener('input', function (e) { filter = e.target.value; render(); });
  qs('vol').addEventListener('input', function (e) { window.cmd({ type: 'volume', value: e.target.value / 100 }); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && source && source.readyState === 2) connect(); });

  fetch('/needs-pin').then(function (r) { return r.json(); }).then(function (info) {
    if (info.needsPin && !pin) { qs('gate').hidden = false; return; }
    qs('app').hidden = false; connect();
  }).catch(function () { qs('app').hidden = false; connect(); });
})();
</script>
</body>
</html>`
