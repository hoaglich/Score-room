// LÕI GIAO DIỆN: kết nối máy chủ, các màn hình chung, phòng gần đây, khung phòng.
// Phần riêng của từng trò nằm ở games/<trò>/ui.js (đăng ký bằng Games.register).
//
// Mỗi trò cung cấp: { mount(ctx), render(ctx), unmount?() }
//   mount(ctx)   gọi một lần khi vào phòng, vẽ khung giao diện vào ctx.root
//   render(ctx)  gọi mỗi khi dữ liệu phòng đổi (ctx.room.g là dữ liệu riêng của trò)
// ctx = { root, room, me, isOwner, online, game, act(type, extra), toast, esc, signed, fmtTime, nameOf(pid) }
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const signed = n => (n > 0 ? '+' : '') + n;
const fmtTime = t => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };
const lsJson = (k, d) => { try { return JSON.parse(lsGet(k)) || d; } catch { return d; } };

// Mã nhận diện của thiết bị này (máy chủ dùng để nhận ra bạn khi nối lại, kể cả sau khi tắt màn hình)
const TOKEN = (() => {
  let t = lsGet('sr_token');
  if (!t) {
    t = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
    lsSet('sr_token', t);
  }
  return t;
})();

let GAMES = {};
let ws = null, down = false, lastMsg = Date.now(), connTimer = null, cdTimer = null, cdLeft = 5, connecting = false;
let myName = lsGet('sr_name') || '';
let room = null, myPid = null, onlinePids = [], nearby = [];
let currentCode = lsGet('sr_cur') || null;     // phòng đang mở (nhớ lại khi tải lại trang)
let mountedCode = null;                        // phòng mà giao diện trò đã được mount
const RECONNECT_SECS = 5;

/* ---------- Màn hình ---------- */
function show(id) {
  ['s-name','s-home','s-create','s-find','s-wait','s-room'].forEach(s => $(s).classList.toggle('hidden', s !== id));
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}
function showWait(title, sub) { $('waitTitle').textContent = title; $('waitSub').textContent = sub; show('s-wait'); }

/* ---------- Kết nối tới máy chủ (dữ liệu phòng nằm trên máy chủ) ---------- */
function wsSend(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }
function act(type, extra) { if (!wsSend(Object.assign({ type }, extra || {}))) toast('Chưa kết nối, thử lại sau giây lát'); }

function connectWS() {
  clearTimeout(connTimer);
  if (ws) { ws.onopen = ws.onclose = ws.onmessage = ws.onerror = null; try { ws.close(); } catch {} }
  const sock = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/?t=' + encodeURIComponent(TOKEN));
  ws = sock; connecting = true; updateReconn();
  connTimer = setTimeout(() => { if (ws === sock && sock.readyState !== 1) handleDown(sock); }, 8000);
  sock.onopen = () => { clearTimeout(connTimer); lastMsg = Date.now(); };
  sock.onclose = () => { if (ws === sock) handleDown(sock); };
  sock.onerror = () => {};
  sock.onmessage = e => { lastMsg = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
}
function handleDown(sock) {
  clearTimeout(connTimer);
  sock.onopen = sock.onclose = sock.onmessage = null; try { sock.close(); } catch {}
  connecting = false; down = true;
  $('netStatus').textContent = 'Mất kết nối…';
  cdLeft = RECONNECT_SECS;
  clearInterval(cdTimer);
  cdTimer = setInterval(() => {              // tự động thử lại sau mỗi 5 giây
    if (connecting) return;
    cdLeft--;
    if (cdLeft <= 0) connectWS(); else updateReconn();
  }, 1000);
  updateReconn();
}
function updateReconn() {
  const need = down && !!currentCode;        // popup chỉ hiện khi đang ở trong phòng
  $('reconnModal').classList.toggle('hidden', !need);
  $('reconnMsg').textContent = connecting ? 'Đang kết nối lại…' : 'Tự động thử lại sau ' + cdLeft + ' giây…';
}
function connected() {
  down = false; connecting = false; clearInterval(cdTimer);
  $('netStatus').textContent = 'Đã kết nối';
  updateReconn();
}
// Quay lại ứng dụng (bật màn hình) hoặc có mạng trở lại: nối lại ngay, im lặng
function quickReconnect() {
  if (!ws || ws.readyState !== 1 || Date.now() - lastMsg > 30000) connectWS();
  else wsSend({ type: 'ping' });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) quickReconnect(); });
window.addEventListener('online', quickReconnect);
window.addEventListener('pageshow', () => quickReconnect());
setInterval(() => {                          // giữ kết nối sống, phát hiện kết nối chết
  if (!ws || ws.readyState !== 1) return;
  if (Date.now() - lastMsg > 40000) connectWS(); else wsSend({ type: 'ping' });
}, 15000);

function onMsg(m) {
  if (m.type === 'welcome') {
    GAMES = m.games; fillGames(); nearby = m.rooms; renderFind();
    connected();
    // Chủ phòng gửi bản sao lưu: máy chủ chỉ nhận nếu chưa có phòng đó (ví dụ sau khi mất dữ liệu)
    Object.values(lsJson('sr_backups', {})).forEach(b => wsSend({ type: 'restore', room: b }));
    if (currentCode) wsSend({ type: 'resume', code: currentCode });
    else if (!$('s-home').classList.contains('hidden')) peekRecent();
  } else if (m.type === 'rooms') { nearby = m.rooms; renderFind(); }
  else if (m.type === 'state') onState(m);
  else if (m.type === 'pending') {
    currentCode = m.code; lsSet('sr_cur', m.code);
    showWait('Đang chờ duyệt', 'Phòng đã bắt đầu. Cần tất cả mọi người đang trong phòng chấp nhận thì bạn mới vào được.');
  } else if (m.type === 'rejected') {
    if (m.resume && currentCode) return retryResume(m);
    toast(m.reason);
    if (!room) leaveLocal();
  } else if (m.type === 'peek') onPeek(m.items);
}
// Mở lại phòng không được: máy chủ có thể vừa mất dữ liệu và chủ phòng sắp khôi phục, nên thử lại vài lần
let resumeTries = 0, resumeTimer = null;
function retryResume(m) {
  const code = currentCode;
  clearTimeout(resumeTimer);
  if (m.notmember) { resumeTries = 0; wsSend({ type: 'join', code, name: myName }); return; }   // vào lại bằng tên cũ
  if (++resumeTries > 6) { resumeTries = 0; toast('Máy chủ chưa có dữ liệu phòng này'); return leaveLocal(); }
  showWait('Đang chờ dữ liệu phòng…', 'Máy chủ chưa có phòng ' + code + ', đang thử lại…');
  resumeTimer = setTimeout(() => { if (currentCode === code) wsSend({ type: 'resume', code }); }, 5000);
}
function onState(m) {
  resumeTries = 0; clearTimeout(resumeTimer);
  room = m.room; myPid = m.me; onlinePids = m.room.online;
  currentCode = room.code; lsSet('sr_cur', room.code);
  rememberRoom(m.summary);
  if (m.backup) { const all = lsJson('sr_backups', {}); all[m.backup.code] = m.backup; lsSet('sr_backups', JSON.stringify(all)); }
  show('s-room'); renderRoom();
}
function unmountGame() {
  const ui = room && Games.registry[room.game];
  if (mountedCode && ui && ui.unmount) { try { ui.unmount(); } catch {} }
  mountedCode = null; $('gameRoot').innerHTML = ''; $('gameRoot').onclick = $('gameRoot').oninput = null;
}
function leaveLocal() {
  unmountGame();
  currentCode = null; lsSet('sr_cur', null);
  room = null; myPid = null;
  updateReconn(); renderSaved(); show('s-home');
}
function leaveRoom() {
  if (room) wsSend({ type: 'leave' }); else wsSend({ type: 'cancel' });
  leaveLocal();
}

/* ---------- Phòng đã tham gia gần đây (lưu trên máy này, cập nhật điểm từ máy chủ) ---------- */
const loadRecent = () => lsJson('sr_recent', []);
const saveRecent = l => lsSet('sr_recent', JSON.stringify(l.slice(0, 10)));
function rememberRoom(summary) {
  const list = loadRecent().filter(r => r.code !== room.code);
  list.unshift({
    code: room.code, name: room.name, gameLabel: (GAMES[room.game] || {}).label || room.game,
    host: room.hostName, owner: myPid === room.ownerPid, t: Date.now(), summary,
  });
  saveRecent(list);
}
function peekRecent() { const codes = loadRecent().map(r => r.code); if (codes.length) wsSend({ type: 'peek', codes }); }
function onPeek(items) {
  const list = loadRecent();
  items.forEach(it => {
    const r = list.find(x => x.code === it.code); if (!r) return;
    if (it.exists) { r.missing = false; r.name = it.name; r.gameLabel = it.gameLabel; r.host = it.host; r.summary = it.summary; }
    else r.missing = true;
  });
  saveRecent(list); renderRecent();
}
// summary = { total, items: [{ name, value }] }: điểm của bạn với từng người (hoặc bảng điểm) và tổng điểm của bạn
function sumHtml(s) {
  if (!s) return '';
  const cls = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  return (s.items.length ? s.items.map(v => `<span class="chip">${esc(v.name)} <b class="${cls(v.value)}">${signed(v.value)}</b></span>`).join('') : '<span class="muted">Chưa có người chơi khác</span>')
    + `<div>Tổng điểm của bạn: <b class="${cls(s.total)}">${signed(s.total)}</b></div>`;
}
function renderRecent() {
  const list = loadRecent();
  $('recentCard').classList.toggle('hidden', !list.length);
  $('recentList').innerHTML = list.map(r => `
    <div class="row" style="align-items:flex-start">
      <div class="grow">
        <div>${esc(r.name)}${r.owner ? ' <span class="muted">(bạn tạo)</span>' : ''}</div>
        <div class="muted">${esc(r.gameLabel)} · chủ phòng ${esc(r.host)} · mã ${esc(r.code)}</div>
        <div class="recent-sum">${sumHtml(r.summary)}</div>
        ${r.missing ? '<div class="stale">Máy chủ chưa có dữ liệu phòng này' + (r.owner ? ', bấm Kết nối để khôi phục từ máy bạn' : '') + '</div>' : ''}
      </div>
      <button class="primary small" data-qc="${esc(r.code)}">Kết nối</button>
      <button class="danger small" data-qd="${esc(r.code)}" title="Xoá khỏi danh sách">🗑</button>
    </div>`).join('');
}
function quickConnect(code) {
  if (!ws || ws.readyState !== 1) return toast('Chưa kết nối tới máy chủ, thử lại sau giây lát');
  showWait('Đang vào phòng…', 'Đang mở lại phòng ' + code + '…');
  currentCode = code; lsSet('sr_cur', code);
  wsSend({ type: 'join', code, name: myName });
}
function removeRecent(code) {
  const r = loadRecent().find(x => x.code === code);
  if (!confirm('Xoá phòng "' + (r ? r.name : code) + '" khỏi danh sách trên máy này?' + (r && r.owner ? '\nBản sao lưu trên máy bạn cũng bị xoá.' : ''))) return;
  saveRecent(loadRecent().filter(x => x.code !== code));
  const b = lsJson('sr_backups', {}); delete b[code]; lsSet('sr_backups', JSON.stringify(b));
  renderRecent();
}
function renderSaved() { renderRecent(); peekRecent(); }

/* ---------- Tìm phòng gần đây (cùng mạng) ---------- */
function renderFind() {
  const el = $('roomList'); if (!el) return;
  const mine = new Set(loadRecent().map(r => r.code));
  el.innerHTML = nearby.length ? nearby.map(r => `
    <div class="row">
      <div class="grow"><div>${esc(r.name)}</div><div class="muted">${esc(r.gameLabel)} · chủ phòng ${esc(r.host)} · ${r.count}/${r.max} người${r.started ? ' · đã bắt đầu' : ''}</div></div>
      <button class="primary small" data-join="${esc(r.code)}" ${!r.started && r.count >= r.max && !mine.has(r.code) ? 'disabled' : ''}>${mine.has(r.code) ? 'Vào lại' : r.started ? 'Xin vào' : r.count >= r.max ? 'Đầy' : 'Vào'}</button>
    </div>`).join('') : '<div class="muted">Chưa thấy phòng nào gần đây. Nhờ bạn bè tạo phòng, hoặc nhập mã bên dưới.</div>';
}
function joinByCode(code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return;
  if (!ws || ws.readyState !== 1) return toast('Chưa kết nối tới máy chủ, thử lại sau giây lát');
  showWait('Đang vào phòng…', 'Đang kết nối tới phòng ' + code + '…');
  currentCode = code;
  wsSend({ type: 'join', code, name: myName });
}

/* ---------- Tạo phòng ---------- */
function fillGames() {
  const cur = $('cGame').value;
  $('cGame').innerHTML = '';
  Object.entries(GAMES).forEach(([k, g]) => $('cGame').add(new Option(g.label, k)));
  if (cur && GAMES[cur]) $('cGame').value = cur;
  onGameChange();
}
function onGameChange() {
  const g = GAMES[$('cGame').value]; if (!g) return;
  $('cHint').textContent = g.hint;
  const lo = g.min || 2, hi = g.max || 8, cur = parseInt($('cMax').value, 10) || 4;
  $('cMax').innerHTML = '';
  for (let n = lo; n <= hi; n++) $('cMax').add(new Option(n + ' người', n));
  $('cMax').value = Math.min(hi, Math.max(lo, cur));
}
function createRoom() {
  if (!GAMES[$('cGame').value]) return toast('Chưa kết nối tới máy chủ, thử lại sau giây lát');
  if (!wsSend({ type: 'create', name: myName, game: $('cGame').value, max: parseInt($('cMax').value, 10), roomName: $('cName').value.trim(), listed: $('cListed').checked })) {
    return toast('Chưa kết nối tới máy chủ, thử lại sau giây lát');
  }
  showWait('Đang tạo phòng…', '');
}

/* ---------- Khung phòng (chung cho mọi trò) ---------- */
const nameOf = pid => { const p = room.players.find(x => x.id === pid); return p ? p.name : '?'; };
const uiFailed = {};
function loadGameUI(id) {       // tải giao diện của trò khi cần: /games/<trò>/ui.js
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '/games/' + id + '/ui.js';
    s.onload = s.onerror = () => resolve(!!Games.registry[id]);
    document.head.appendChild(s);
  });
}
function makeCtx() {
  return {
    root: $('gameRoot'), room, me: myPid, isOwner: myPid === room.ownerPid, online: onlinePids,
    game: GAMES[room.game] || { label: room.game }, act, toast, esc, signed, fmtTime, nameOf,
  };
}
function renderRoom() {
  if (!room) return;
  const g = GAMES[room.game] || { label: room.game }, isOwner = myPid === room.ownerPid;
  $('rTitle').textContent = room.name;
  $('rSub').textContent = g.label + ' · ' + room.players.length + '/' + room.max + ' người' + (isOwner ? ' · bạn là chủ phòng' : '') + (room.locked ? ' · 🔒 đã khoá' : '');
  $('rCode').textContent = room.code;
  $('lockBtn').classList.toggle('hidden', !isOwner);
  $('lockBtn').textContent = room.locked ? '🔓 Mở khoá phòng (cho phép vào bằng mã)' : '🔒 Khoá phòng (không ai vào thêm được)';
  renderJoinReqs();
  // Trò có nút "Bắt đầu": trước khi bắt đầu chỉ hiện danh sách người trong phòng
  const lobby = !!g.needsStart && !room.started;
  $('waitCard').classList.toggle('hidden', !lobby);
  $('gameRoot').classList.toggle('hidden', lobby);
  if (lobby) {
    $('waitCount').textContent = room.players.length + '/' + room.max;
    $('waitList').innerHTML = room.players.map(p => `
      <div class="row"><span><span class="dot ${onlinePids.includes(p.id) ? 'on' : ''}"></span>${esc(p.name)}${p.id === myPid ? ' (bạn)' : ''}</span></div>`).join('');
    $('startBtn').classList.toggle('hidden', !isOwner);
    $('startBtn').disabled = room.players.length < 2;
    $('waitMsg').textContent = !isOwner ? 'Đang chờ chủ phòng bấm Bắt đầu…'
      : room.players.length < 2 ? 'Cần ít nhất 2 người để bắt đầu.' : 'Bấm Bắt đầu khi mọi người đã vào đủ.';
  }
  // Giao diện riêng của trò
  const id = room.game, ui = Games.registry[id];
  if (!ui) {
    if (uiFailed[id]) return;
    loadGameUI(id).then(okLoaded => {
      if (!okLoaded) { uiFailed[id] = true; toast('Không tải được giao diện của trò này'); }
      else if (room && room.game === id) renderRoom();
    });
    return;
  }
  if (mountedCode !== room.code) { unmountGame(); mountedCode = room.code; ui.mount(makeCtx()); }
  if (!lobby) ui.render(makeCtx());
}
// Người xin vào phòng đang chơi: cần tất cả người đang online chấp nhận (không thuộc phần của riêng trò nào)
function renderJoinReqs() {
  const reqs = room.joinReqs || [];
  $('joinCard').classList.toggle('hidden', !reqs.length);
  const onl = room.players.filter(p => onlinePids.includes(p.id));
  $('joinReqs').innerHTML = reqs.map(r => r.votes[myPid]
    ? `<div class="note"><b>${esc(r.name)}</b> đang xin vào phòng. Đã duyệt ${onl.filter(p => r.votes[p.id]).length}/${onl.length}, chờ những người còn lại.</div>`
    : `<div class="note req"><div><b>${esc(r.name)}</b> muốn vào phòng. Cần tất cả mọi người đang trong phòng chấp nhận.</div><div class="acts"><button class="primary" data-jacc="${r.id}">Chấp nhận</button><button class="danger" data-jrej="${r.id}">Từ chối</button></div></div>`).join('');
}

/* ---------- Sự kiện chung ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.jacc) act('vote', { id: d.jacc, accept: true });
  else if (d.jrej) act('vote', { id: d.jrej, accept: false });
  else if (d.join) joinByCode(d.join);
  else if (d.qc) quickConnect(d.qc);
  else if (d.qd) removeRecent(d.qd);
});
$('cGame').onchange = onGameChange;
function setName() {
  const n = $('nameInput').value.trim();
  if (!n) return toast('Hãy nhập tên');
  myName = n.slice(0, 16); lsSet('sr_name', myName);
  $('hiName').textContent = myName; renderSaved(); show('s-home');
}
$('nameOk').onclick = setName;
$('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') setName(); });
$('changeName').onclick = e => { e.preventDefault(); $('nameInput').value = myName; show('s-name'); };
$('goCreate').onclick = () => show('s-create');
$('goFind').onclick = () => { renderFind(); show('s-find'); };
$('createBack').onclick = () => show('s-home');
$('findBack').onclick = () => show('s-home');
$('createOk').onclick = createRoom;
$('startBtn').onclick = () => act('start');
$('lockBtn').onclick = () => act('lock');
$('leaveBtn').onclick = leaveRoom;
$('waitCancel').onclick = leaveRoom;
$('codeGo').onclick = () => joinByCode($('codeInput').value);
$('reconnBtn').onclick = () => { if (!connecting) connectWS(); };
$('reconnLeave').onclick = leaveRoom;

// Khởi động: có tên rồi thì vào trang chính (hoặc mở lại phòng đang dở), chưa có thì hỏi tên
$('nameInput').value = myName;
if (myName) {
  $('hiName').textContent = myName; renderRecent();
  if (currentCode) showWait('Đang mở lại phòng…', 'Phòng ' + currentCode + ' (điểm được lưu trên máy chủ)'); else show('s-home');
} else { currentCode = null; show('s-name'); }
connectWS();
