// The counter's dashboard: one self-contained page (no libraries, nothing loaded from elsewhere) that asks for
// the key once, keeps it in this browser, and reads /stats.json with it every few seconds. The page holds no
// numbers itself, and the key is never part of an address. A JS string, not an .html file, so the Worker and the local
// runner import it the same way with no build step. The page's script uses no template literals for that reason.
//
// One series everywhere, so one colour (the palette's first slot, checked against both surfaces). Every chart
// has hover and keyboard readouts and a table of the same numbers.
export const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OmniCam counter</title>
<style>
  :root {
    color-scheme: light;
    --plane: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --axis: #c3c2b7; --ring: rgba(11, 11, 11, 0.1); --series: #2a78d6; --good: #0ca30c; --critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --plane: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --axis: #383835; --ring: rgba(255, 255, 255, 0.1); --series: #3987e5;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 24px 48px; background: var(--plane); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; display: grid; gap: 16px; }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; }
  .live { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; color: var(--ink-2); font-size: 12.5px; }
  .live i { width: 8px; height: 8px; border-radius: 50%; background: var(--good); }
  .live.down i { background: var(--critical); }
  .card { background: var(--surface); border: 1px solid var(--ring); border-radius: 12px; padding: 18px 20px; min-width: 0; }
  .card h2 { margin: 0; font-size: 13px; font-weight: 600; }
  .card .sub { margin: 2px 0 14px; color: var(--muted); font-size: 12px; }
  .kpis { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 16px; }
  .kpi .label { color: var(--ink-2); font-size: 12.5px; }
  .kpi .value { font-size: 28px; font-weight: 600; line-height: 1.15; margin-top: 4px; }
  .kpi.hero .value { font-size: 52px; }
  .kpi .note { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  @media (max-width: 760px) { .kpis, .two, .three { grid-template-columns: 1fr; } }

  /* Columns: thin bars on one baseline, hairline grid, the whole slot is the hover target. */
  .plot { position: relative; height: 150px; margin-left: 36px; }
  .gridline { position: absolute; left: 0; right: 0; height: 0; border-top: 1px solid var(--grid); }
  .gridline.base { border-top-color: var(--axis); }
  .gridline span { position: absolute; right: 100%; margin-right: 8px; transform: translateY(-50%); color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .cols { position: absolute; inset: 0; display: flex; }
  .slot { flex: 1; min-width: 0; position: relative; display: flex; align-items: flex-end; justify-content: center; outline: none; }
  .slot .bar { width: min(24px, 64%); background: var(--series); border-radius: 4px 4px 0 0; }
  .slot:hover .bar, .slot:focus-visible .bar, .row:hover .hbar, .row:focus-visible .hbar { filter: brightness(1.18); }
  .slot .cap { position: absolute; left: 50%; transform: translate(-50%, -4px); color: var(--ink-2); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .xaxis { display: flex; margin: 6px 0 0 36px; }
  .xaxis span { flex: 1; min-width: 0; text-align: center; color: var(--muted); font-size: 11px; white-space: nowrap; }

  /* Ranked rows: a name, a bar from one baseline, the figure at its end. */
  .row { display: grid; grid-template-columns: 76px 1fr auto; align-items: center; gap: 10px; padding: 5px 0; outline: none; }
  .row .name { color: var(--ink-2); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .track { height: 10px; }
  .row .hbar { display: block; height: 100%; min-width: 2px; background: var(--series); border-radius: 0 4px 4px 0; }
  .row .val { font-size: 12.5px; font-variant-numeric: tabular-nums; min-width: 28px; text-align: right; }
  .empty { margin: 0; color: var(--muted); font-size: 12.5px; }

  details { margin-top: 12px; }
  summary { cursor: pointer; color: var(--muted); font-size: 12px; width: fit-content; }
  table { border-collapse: collapse; margin-top: 8px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 3px 18px 3px 0; }
  th { color: var(--muted); font-weight: 500; }
  td:last-child, th:last-child { text-align: right; padding-right: 0; }

  #tip { position: fixed; z-index: 2; pointer-events: none; padding: 6px 10px; border-radius: 8px; background: var(--ink); color: var(--surface); font-size: 12px; white-space: nowrap; transform: translate(-50%, calc(-100% - 10px)); }
  #tip b { font-weight: 600; margin-right: 6px; }
  #tip[hidden] { display: none; }
  main[hidden], form[hidden] { display: none; }
  form { max-width: 360px; margin: 18vh auto 0; display: grid; gap: 12px; }
  form label { color: var(--ink-2); font-size: 12.5px; }
  input, button { font: inherit; border-radius: 8px; border: 1px solid var(--axis); padding: 8px 12px; background: var(--surface); color: var(--ink); }
  form button { background: var(--series); border-color: transparent; color: #fff; font-weight: 600; cursor: pointer; }
  #wrong { margin: 0; color: var(--ink-2); font-size: 12.5px; min-height: 1.4em; }
  footer button { padding: 0; border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; }
  footer { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<form id="login" class="card" hidden>
  <h1>OmniCam counter</h1>
  <label for="key">Key</label>
  <input id="key" type="password" autocomplete="current-password" required autofocus>
  <button>Show the counts</button>
  <p id="wrong" role="status"></p>
</form>
<main id="app" hidden>
  <header>
    <h1>OmniCam counter</h1>
    <span class="live" id="live"><i></i><span id="live-text">Connecting</span></span>
  </header>

  <section class="kpis">
    <div class="card kpi hero"><div class="label">Installs in use this month</div><div class="value" id="k-month">-</div><div class="note" id="k-month-note"></div></div>
    <div class="card kpi"><div class="label">Counted today</div><div class="value" id="k-today">-</div><div class="note">new this month, arrived today</div></div>
    <div class="card kpi"><div class="label">Average rating</div><div class="value" id="k-avg">-</div><div class="note">out of 5</div></div>
    <div class="card kpi"><div class="label">Ratings</div><div class="value" id="k-rated">-</div><div class="note">since the start</div></div>
  </section>

  <section class="two">
    <div class="card"><h2>Installs in use, per month</h2><p class="sub">Each install is counted once a month. Last 12 months.</p><div id="c-months"></div><details><summary>Table</summary><div id="t-months"></div></details></div>
    <div class="card"><h2>When they were counted, per day</h2><p class="sub">The day each install's ping for the month arrived. Last 30 days.</p><div id="c-days"></div><details><summary>Table</summary><div id="t-days"></div></details></div>
  </section>

  <section class="three">
    <div class="card"><h2>Versions</h2><p class="sub">Installs this month.</p><div id="c-versions"></div></div>
    <div class="card"><h2>Systems</h2><p class="sub">Installs this month.</p><div id="c-systems"></div></div>
    <div class="card"><h2>Ratings</h2><p class="sub">How many gave each number of stars.</p><div id="c-stars"></div></div>
  </section>

  <footer>Only installs whose user said yes are counted. Days and months are UTC. No addresses or IDs are stored. <button id="forget">Forget the key on this browser</button></footer>
</main>
<div id="tip" hidden></div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STORED = 'omnicam-counter-key';
  var key = '';
  try { key = localStorage.getItem(STORED) || ''; } catch (e) { /* storage off: the key is asked for each visit */ }
  function remember(value) {
    key = value;
    try { if (value) localStorage.setItem(STORED, value); else localStorage.removeItem(STORED); } catch (e) { /* as above */ }
  }
  function ask(message) {
    $('app').hidden = true;
    $('login').hidden = false;
    $('wrong').textContent = message || '';
    $('key').value = '';
    $('key').focus();
  }
  var tip = $('tip');
  var SYSTEMS = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

  // Every label goes in as text, never as markup: versions and systems come from outside.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  // The readout: the figure first, what it is second. Same on hover and on keyboard focus.
  function showTip(x, y, value, label) {
    tip.textContent = '';
    tip.appendChild(el('b', '', value));
    tip.appendChild(document.createTextNode(label));
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.hidden = false;
  }
  function readout(node, value, label) {
    node.tabIndex = 0;
    node.setAttribute('aria-label', label + ': ' + value);
    node.addEventListener('pointermove', function (e) { showTip(e.clientX, e.clientY, value, label); });
    node.addEventListener('pointerleave', function () { tip.hidden = true; });
    node.addEventListener('focus', function () { var r = node.getBoundingClientRect(); showTip(r.left + r.width / 2, r.top, value, label); });
    node.addEventListener('blur', function () { tip.hidden = true; });
  }

  // An axis top that halves to a whole number: 4, 6, 8, 10, 20, 40...
  function axisTop(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = p === 1 ? [2, 4, 6, 8, 10] : [1, 2, 4, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  function columns(host, rows, everyNth) {
    host.textContent = '';
    var top = axisTop(Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([0])));
    var plot = el('div', 'plot');
    [1, 0.5, 0].forEach(function (f) {
      var line = el('div', 'gridline' + (f === 0 ? ' base' : ''));
      line.style.bottom = f * 100 + '%';
      line.appendChild(el('span', '', fmt(top * f)));
      plot.appendChild(line);
    });
    var cols = el('div', 'cols');
    rows.forEach(function (r, i) {
      var slot = el('div', 'slot');
      if (r.n > 0) {
        var bar = el('div', 'bar');
        bar.style.height = (r.n / top) * 100 + '%';
        slot.appendChild(bar);
      }
      // Only the latest column carries its figure; the axis, the readout and the table carry the rest.
      if (i === rows.length - 1 && r.n > 0) {
        var cap = el('span', 'cap', fmt(r.n));
        cap.style.bottom = (r.n / top) * 100 + '%';
        slot.appendChild(cap);
      }
      readout(slot, fmt(r.n), r.long);
      cols.appendChild(slot);
    });
    plot.appendChild(cols);
    host.appendChild(plot);
    var axis = el('div', 'xaxis');
    rows.forEach(function (r, i) { axis.appendChild(el('span', '', i % everyNth === 0 ? r.short : '')); });
    host.appendChild(axis);
  }

  function ranked(host, rows, nothing) {
    host.textContent = '';
    var top = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([0]));
    if (!top) { host.appendChild(el('p', 'empty', nothing)); return; }
    rows.forEach(function (r) {
      var row = el('div', 'row');
      row.appendChild(el('span', 'name', r.label));
      var track = el('span', 'track');
      if (r.n > 0) {
        var bar = el('span', 'hbar');
        bar.style.width = (r.n / top) * 100 + '%';
        track.appendChild(bar);
      }
      row.appendChild(track);
      row.appendChild(el('span', 'val', fmt(r.n)));
      readout(row, fmt(r.n), r.label);
      host.appendChild(row);
    });
  }

  function table(host, head, rows) {
    host.textContent = '';
    var t = el('table');
    var tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', '', h)); });
    t.appendChild(tr);
    rows.forEach(function (r) {
      var line = el('tr');
      line.appendChild(el('td', '', r.long));
      line.appendChild(el('td', '', fmt(r.n)));
      t.appendChild(line);
    });
    host.appendChild(t);
  }

  function utc(y, m, d) { return new Date(Date.UTC(y, m, d)); }
  function iso(date, length) { return date.toISOString().slice(0, length); }
  function name(date, options) { options.timeZone = 'UTC'; return date.toLocaleDateString('en-US', options); }

  function render(s) {
    var y = Number(s.today.slice(0, 4)), m = Number(s.today.slice(5, 7)) - 1, d = Number(s.today.slice(8, 10));
    var byMonth = {}, byDay = {};
    s.months.forEach(function (r) { byMonth[r.month] = r.n; });
    s.days.forEach(function (r) { byDay[r.day] = r.n; });

    // Every month and day on the axis, counted or not: a gap in use has to look like a gap.
    var months = [], days = [], i;
    for (i = 11; i >= 0; i--) {
      var month = utc(y, m - i, 1);
      months.push({ n: byMonth[iso(month, 7)] || 0, short: name(month, { month: 'short' }), long: name(month, { month: 'long', year: 'numeric' }) });
    }
    for (i = 29; i >= 0; i--) {
      var day = utc(y, m, d - i);
      days.push({ n: byDay[iso(day, 10)] || 0, short: String(day.getUTCDate()), long: name(day, { day: 'numeric', month: 'long' }) });
    }

    var thisMonth = months[11].n, lastMonth = months[10].n;
    $('k-month').textContent = fmt(thisMonth);
    $('k-month-note').textContent = months[11].long + ' so far. ' + months[10].long + ': ' + fmt(lastMonth) + '.';
    $('k-today').textContent = fmt(days[29].n);
    $('k-avg').textContent = s.average == null ? '-' : s.average.toFixed(1);
    $('k-rated').textContent = fmt(s.rated);

    columns($('c-months'), months, 1);
    columns($('c-days'), days, 5);
    table($('t-months'), ['Month', 'Installs'], months.slice().reverse());
    table($('t-days'), ['Day', 'Counted'], days.slice().reverse());

    ranked($('c-versions'), s.versions.map(function (r) { return { label: r.v, n: r.n }; }), 'No pings this month yet.');
    ranked($('c-systems'), s.systems.map(function (r) { return { label: SYSTEMS[r.os] || r.os, n: r.n }; }), 'No pings this month yet.');
    var given = {};
    s.stars.forEach(function (r) { given[r.stars] = r.n; });
    ranked($('c-stars'), [5, 4, 3, 2, 1].map(function (n) { return { label: n + (n === 1 ? ' star' : ' stars'), n: given[n] || 0 }; }), 'No ratings yet.');
  }

  function live(ok) {
    $('live').className = ok ? 'live' : 'live down';
    $('live-text').textContent = ok ? 'Live, updated ' + new Date().toLocaleTimeString() : 'Cannot reach the counter, trying again';
  }

  // The charts keep what they showed while the next numbers load, and while the counter is unreachable.
  function load() {
    if (document.hidden || !key) return;
    fetch('stats.json', { cache: 'no-store', headers: { authorization: 'Bearer ' + key } })
      .then(function (r) {
        if (r.status === 401) {
          remember('');
          // Counts already on screen (the key was changed meanwhile): start clean, so nothing stays in the page.
          if (!$('app').hidden) location.reload(); else ask('That key is not right.');
          return null;
        }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (s) {
        if (!s) return;
        $('login').hidden = true;
        $('app').hidden = false;
        render(s);
        live(true);
      })
      .catch(function () { live(false); });
  }
  $('login').addEventListener('submit', function (e) { e.preventDefault(); remember($('key').value); load(); });
  // Reloading leaves nothing behind in the page, not just out of sight.
  $('forget').addEventListener('click', function () { remember(''); location.reload(); });
  if (!key) ask('');
  load();
  setInterval(load, 5000);
  document.addEventListener('visibilitychange', load);
})();
</script>
</body>
</html>
`;
