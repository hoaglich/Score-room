// LÕI MÁY CHỦ: kết nối, phòng, người chơi, lưu dữ liệu, duyệt người vào, khoá phòng.
// Luật tính điểm của từng trò nằm riêng trong games/<trò>/logic.js, lõi chỉ chuyển thao tác cho trò đó.
//
// Máy chủ GIỮ trạng thái phòng và ghi ra file, nên người chơi tắt màn hình hay mất mạng thì dữ liệu vẫn còn.
// Chủ phòng cũng giữ một bản sao lưu trên máy mình để khôi phục nếu máy chủ mất dữ liệu.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const GAMES = require('./games');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const PUB = path.join(__dirname, 'public');
const GAMES_DIR = path.join(__dirname, 'games');
const KEEP_DAYS = 60;           // phòng không hoạt động quá lâu sẽ bị dọn
const ACTIVE_MS = 3 * 3600e3;   // phòng còn hiện trong "Tìm phòng" nếu có người online hoặc hoạt động trong 3 giờ
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// Chỉ phục vụ file giao diện của trò (ui.js, *-ui.js, *.css), không phục vụ logic.js
const GAME_PUBLIC = /^\/games\/[a-z0-9_]+\/((ui|[a-z0-9-]+-ui)\.js|[a-z0-9-]+\.css)$/;

// Thông tin các trò gửi xuống giao diện
const GAMES_META = Object.fromEntries(Object.entries(GAMES).map(([id, g]) => [id,
  Object.assign({ label: g.label, hint: g.hint, min: g.min, max: g.max, needsStart: !!g.needsStart }, g.meta || {})]));
const joinNeedsApproval = r => !!GAMES[r.game].needsStart && !!r.started;   // phòng đang chơi: người mới phải được duyệt

// ---- Dữ liệu phòng + lưu ra file ----
const rooms = new Map();
function load() {
  try {
    const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const r of j.rooms || []) {
      if (!r || !r.code || !GAMES[r.game]) continue;
      if (!r.state) {                       // dữ liệu từ bản cũ: các trường nằm ngoài room.state
        const legacy = {};
        for (const k of ['rounds', 'bal', 'hist', 'notifs']) if (r[k] !== undefined) { legacy[k] = r[k]; delete r[k]; }
        r.state = Object.assign(GAMES[r.game].initState(), legacy);
      }
      rooms.set(r.code, r);
    }
    console.log('Đã nạp ' + rooms.size + ' phòng từ ' + DATA_FILE);
  } catch (e) { if (e.code !== 'ENOENT') console.error('Không đọc được dữ liệu:', e.message); }
  sweep();
}
function sweep() {
  const limit = Date.now() - KEEP_DAYS * 86400e3;
  for (const [k, r] of rooms) if ((r.updated || 0) < limit) rooms.delete(k);
}
let saveTimer = null;
function saveSoon() { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 400); }
function saveNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ rooms: [...rooms.values()] }));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('Không ghi được dữ liệu:', e.message); }
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { saveNow(); process.exit(0); });

// ---- Tiện ích ----
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const cleanName = v => str(v, 40).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
const newId = p => p + crypto.randomBytes(4).toString('hex');
const nameOf = (r, pid) => { const p = r.players.find(x => x.id === pid); return p ? p.name : '?'; };
function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += abc[crypto.randomInt(abc.length)];
    if (!rooms.has(c)) return c;
  }
}

// ---- HTTP ----
const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  let base, file;
  if (url.startsWith('/games/')) {
    if (!GAME_PUBLIC.test(url)) { res.writeHead(404); return res.end('Not found'); }
    base = GAMES_DIR; file = path.join(GAMES_DIR, url.slice(7));
  } else { base = PUB; file = path.join(PUB, url === '/' ? 'index.html' : url); }
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? xff.split(',')[0].trim() : req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function isPrivate(ip) {
  return ip === '::1' || ip === '127.0.0.1' || /^10\./.test(ip) || /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}
const netKey = req => { const ip = clientIp(req); return isPrivate(ip) ? 'lan' : ip; };

// ---- Kết nối ----
const clients = new Map();   // ws -> { token, net, code, pid, waiting, hits }
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const isOnline = (r, pid) => { for (const c of clients.values()) if (c.code === r.code && c.pid === pid) return true; return false; };
const onlineList = r => { const s = new Set(); for (const c of clients.values()) if (c.code === r.code && c.pid) s.add(c.pid); return [...s]; };

// Phần dữ liệu chung của phòng; riêng phần của trò nằm ở khoá `g` (do games/<trò>/logic.js quyết định)
function viewFor(r, pid) {
  return {
    code: r.code, name: r.name, game: r.game, max: r.max, listed: r.listed, locked: !!r.locked, started: !!r.started,
    created: r.created, ownerPid: r.ownerPid, hostName: nameOf(r, r.ownerPid),
    players: r.players.map(p => ({ id: p.id, name: p.name })),
    joinReqs: r.joinReqs.map(q => ({ id: q.id, name: q.name, votes: q.votes })),
    online: onlineList(r),
    g: GAMES[r.game].view(r, pid),
  };
}
function backupOf(r) {      // bản đầy đủ (không có token) để chủ phòng giữ trên máy
  return {
    v: 2, code: r.code, name: r.name, game: r.game, max: r.max, listed: r.listed, locked: !!r.locked, started: !!r.started,
    created: r.created, ownerPid: r.ownerPid, players: r.players.map(p => ({ id: p.id, name: p.name })), state: r.state,
  };
}
function sendState(ws, c, r) {
  const msg = { type: 'state', me: c.pid, room: viewFor(r, c.pid), summary: GAMES[r.game].summary(r, c.pid) };
  if (c.pid === r.ownerPid) msg.backup = backupOf(r);
  send(ws, msg);
}
function pushRoom(r) { for (const [ws, c] of clients) if (c.code === r.code && c.pid) sendState(ws, c, r); }
function listFor(net) {
  const now = Date.now(), out = [];
  for (const r of rooms.values()) {
    if (r.net !== net || !r.listed || r.locked) continue;
    if (!onlineList(r).length && now - r.updated > ACTIVE_MS) continue;
    out.push({ code: r.code, name: r.name, game: r.game, gameLabel: GAMES[r.game].label, host: nameOf(r, r.ownerPid), max: r.max, count: r.players.length, started: !!r.started });
  }
  return out;
}
function pushLists() {
  const cache = {};
  for (const [ws, c] of clients) { if (!cache[c.net]) cache[c.net] = listFor(c.net); send(ws, { type: 'rooms', rooms: cache[c.net] }); }
}
function touch(r) { r.updated = Date.now(); saveSoon(); pushRoom(r); pushLists(); }

function attach(ws, c, r, pid) {
  const prev = c.code && c.code !== r.code ? rooms.get(c.code) : null;
  c.code = r.code; c.pid = pid; c.waiting = null;
  if (prev) pushRoom(prev);
  pushRoom(r);            // gửi trạng thái cho người vừa vào và báo mọi người biết có người online
  pushLists();
}
function detach(ws, c) {
  const prev = c.code ? rooms.get(c.code) : null;
  c.code = null; c.pid = null;
  if (prev) presenceChanged(prev); else pushLists();
}
const reject = (ws, reason, extra) => send(ws, Object.assign({ type: 'rejected', reason }, extra || {}));
function clientsWaiting(r, token) { const out = []; for (const [ws, c] of clients) if (c.token === token && c.waiting === r.code) out.push([ws, c]); return out; }

// ---- Duyệt người xin vào phòng đang chơi ----
function voteJoin(r, pid, id, accept) {
  const q = r.joinReqs.find(x => x.id === id);
  if (!q || !r.players.some(p => p.id === pid)) return;
  if (!accept) {
    r.joinReqs = r.joinReqs.filter(x => x.id !== id);
    clientsWaiting(r, q.token).forEach(([ws, c]) => { c.waiting = null; reject(ws, nameOf(r, pid) + ' đã từ chối cho bạn vào phòng'); });
    return touch(r);
  }
  q.votes[pid] = true;
  checkJoinReqs(r);
  touch(r);
}
// "Người trong phòng" = những người đang online trong phòng. Người đã thoát hoặc đang offline không chặn việc duyệt.
function checkJoinReqs(r) {
  let changed = false;
  for (const q of [...r.joinReqs]) {
    const need = r.players.filter(p => isOnline(r, p.id));
    if (!need.length || !need.every(p => q.votes[p.id])) continue;
    r.joinReqs = r.joinReqs.filter(x => x.id !== q.id);      // đủ tất cả người đang online chấp nhận
    changed = true;
    const waiting = clientsWaiting(r, q.token);
    if (r.locked || r.players.length >= r.max) {
      waiting.forEach(([ws, c]) => { c.waiting = null; reject(ws, r.locked ? 'Phòng đã khoá' : 'Phòng đã đủ người'); });
      continue;
    }
    const np = { id: newId('u'), name: q.name, token: q.token };
    r.players.push(np);
    waiting.forEach(([ws, c]) => { c.code = r.code; c.pid = np.id; c.waiting = null; });
  }
  return changed;
}
// Có người vào/ra: duyệt lại các yêu cầu đang chờ rồi báo cho mọi người
function presenceChanged(r) {
  if (checkJoinReqs(r)) { r.updated = Date.now(); saveSoon(); }
  pushRoom(r); pushLists();
}

// ---- Khôi phục từ bản sao lưu của chủ phòng (chỉ khi máy chủ chưa có phòng đó) ----
function restoreRoom(c, b) {
  if (!b || typeof b !== 'object') return;
  const code = str(b.code, 8).toUpperCase();
  const g = GAMES[b.game];
  if (!/^[A-Z0-9]{4}$/.test(code) || rooms.has(code) || !g) return;
  const players = (Array.isArray(b.players) ? b.players : []).slice(0, 12)
    .map(p => ({ id: str(p && p.id, 16), name: cleanName(p && p.name), token: null })).filter(p => p.id && p.name);
  if (new Set(players.map(p => p.id)).size !== players.length) return;
  const owner = players.find(p => p.id === b.ownerPid);
  if (!owner) return;
  owner.token = c.token;
  const ids = new Set(players.map(p => p.id));
  // bản sao lưu cũ để trường rounds/bal/hist ngoài cùng, bản mới để trong state
  const state = Object.assign(g.initState(), g.sanitize(b.state || b, ids));
  rooms.set(code, {
    code, name: str(b.name, 30) || g.label + ' ' + code, game: b.game,
    max: Math.min(g.max || 8, Math.max(g.min || 2, players.length, parseInt(b.max, 10) || g.max || 8)),
    listed: b.listed !== false, locked: !!b.locked, started: !!b.started,
    created: Number(b.created) || Date.now(), updated: Date.now(), net: c.net, ownerPid: owner.id,
    players, state, joinReqs: [],
  });
  saveSoon();
  console.log('Đã khôi phục phòng ' + code + ' từ máy chủ phòng');
}

// ---- Xử lý tin nhắn ----
const wss = new WebSocketServer({ server, maxPayload: 512 * 1024 });
wss.on('connection', (ws, req) => {
  let token = '';
  try { token = new URL(req.url, 'http://x').searchParams.get('t') || ''; } catch {}
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) token = 'anon-' + crypto.randomBytes(8).toString('hex');
  const c = { token, net: netKey(req), code: null, pid: null, waiting: null, hits: 0 };
  clients.set(ws, c);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'welcome', games: GAMES_META, rooms: listFor(c.net) });

  ws.on('message', raw => {
    if (++c.hits > 120) return;                       // chống gửi dồn dập
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    const room = c.code ? rooms.get(c.code) : null;
    const pid = c.pid;
    const owner = !!room && pid === room.ownerPid;

    // ---- Thao tác của lõi ----
    switch (m.type) {
      case 'ping': return send(ws, { type: 'pong' });

      case 'create': {
        const name = cleanName(m.name), g = GAMES[m.game];
        if (!name) return reject(ws, 'Tên không hợp lệ');
        if (!g) return reject(ws, 'Bộ môn không hợp lệ');
        if (rooms.size >= 5000) return reject(ws, 'Máy chủ đã đủ số phòng');
        const code = newCode(), id = newId('u');
        const r = {
          code, name: str(m.roomName, 30).trim() || g.label + ' ' + code, game: m.game,
          max: Math.min(g.max || 8, Math.max(g.min || 2, parseInt(m.max, 10) || 4)), listed: m.listed !== false, locked: false, started: false,
          created: Date.now(), updated: Date.now(), net: c.net, ownerPid: id,
          players: [{ id, name, token: c.token }], state: g.initState(), joinReqs: [],
        };
        rooms.set(code, r); saveSoon();
        return attach(ws, c, r, id);
      }

      case 'join':
      case 'resume': {
        const code = str(m.code, 8).toUpperCase();
        const r = rooms.get(code);
        const resume = m.type === 'resume';
        if (!r) return reject(ws, 'Không tìm thấy phòng mã ' + code, { notfound: true, resume });
        const me = r.players.find(x => x.token === c.token);
        if (me) return attach(ws, c, r, me.id);                   // đúng người cũ: vào lại ngay
        if (r.joinReqs.some(q => q.token === c.token)) { c.waiting = code; return send(ws, { type: 'pending', code }); }
        if (resume) return reject(ws, 'Bạn không còn trong phòng này', { resume: true, notmember: true });
        const name = cleanName(m.name);
        if (!name) return reject(ws, 'Tên không hợp lệ');
        const same = r.players.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (same) {                                               // vào lại bằng tên khi người đó đang offline
          if (isOnline(r, same.id)) return reject(ws, 'Tên này đang được dùng trong phòng');
          same.token = c.token; saveSoon();
          return attach(ws, c, r, same.id);
        }
        if (r.locked) return reject(ws, 'Phòng đã khoá, không nhận thêm người');
        if (r.players.length >= r.max) return reject(ws, 'Phòng đã đủ người');
        if (joinNeedsApproval(r)) {                               // phòng đang chơi: cần TẤT CẢ người đang online chấp nhận
          if (r.joinReqs.some(q => q.name.toLowerCase() === name.toLowerCase())) return reject(ws, 'Tên này đang chờ duyệt');
          r.joinReqs.push({ id: newId('j'), name, token: c.token, votes: {}, t: Date.now() });
          c.waiting = code; send(ws, { type: 'pending', code });
          return touch(r);
        }
        const id = newId('u');
        r.players.push({ id, name, token: c.token });
        attach(ws, c, r, id);
        return touch(r);
      }

      case 'cancel': {                                            // huỷ yêu cầu xin vào đang chờ
        const r = c.waiting ? rooms.get(c.waiting) : null;
        c.waiting = null;
        if (r) { r.joinReqs = r.joinReqs.filter(q => q.token !== c.token); touch(r); }
        return;
      }
      case 'leave': c.waiting = null; return detach(ws, c);

      case 'restore': return restoreRoom(c, m.room);

      case 'peek': {
        const items = (Array.isArray(m.codes) ? m.codes : []).slice(0, 12).map(x => {
          const code = str(x, 8).toUpperCase(), r = rooms.get(code), me = r && r.players.find(p => p.token === c.token);
          if (!r || !me) return { code, exists: false };
          return { code, exists: true, name: r.name, gameLabel: GAMES[r.game].label, host: nameOf(r, r.ownerPid), summary: GAMES[r.game].summary(r, me.id) };
        });
        return send(ws, { type: 'peek', items });
      }
    }

    if (!room || !pid) return;                                    // các thao tác dưới đây cần đang ở trong phòng
    const g = GAMES[room.game];
    switch (m.type) {
      case 'start':                                               // trò có "Bắt đầu": chỉ chủ phòng bấm được
        if (!owner || !g.needsStart || room.started) return;
        if (room.players.length < 2) return reject(ws, 'Cần ít nhất 2 người để bắt đầu');
        room.started = true; return touch(room);
      case 'lock':
        if (!owner) return;
        room.locked = !room.locked;
        if (room.locked) {
          room.joinReqs.forEach(q => clientsWaiting(room, q.token).forEach(([w, cc]) => { cc.waiting = null; reject(w, 'Phòng đã khoá'); }));
          room.joinReqs = [];
        }
        return touch(room);
      case 'vote': return voteJoin(room, pid, str(m.id, 20), !!m.accept);
    }

    // ---- Thao tác riêng của trò: giao cho games/<trò>/logic.js ----
    const fn = g.actions && Object.prototype.hasOwnProperty.call(g.actions, m.type) ? g.actions[m.type] : null;
    if (typeof fn === 'function') {
      fn({
        room, state: room.state, pid, isOwner: owner, now: Date.now(),
        newId, nameOf: id => nameOf(room, id),
        reject: reason => reject(ws, reason),
        changed: () => touch(room),
      }, m);
    }
  });

  ws.on('close', () => {
    const prev = c.code ? rooms.get(c.code) : null;
    clients.delete(ws);
    if (prev) presenceChanged(prev); else pushLists();
  });
});

// Giữ kết nối sống (tránh bị proxy ngắt khi im lặng), dọn kết nối chết và reset bộ đếm
setInterval(() => {
  for (const w of wss.clients) {
    if (!w.isAlive) { w.terminate(); continue; }
    w.isAlive = false;
    try { w.ping(); } catch {}
  }
}, 25000);
setInterval(() => { for (const c of clients.values()) c.hits = 0; }, 10000);
setInterval(() => { sweep(); saveSoon(); }, 6 * 3600e3);

load();
server.listen(PORT, () => console.log('Chạy tại http://localhost:' + PORT + ' · dữ liệu lưu ở ' + DATA_FILE));
