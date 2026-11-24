// TÁ LẢ: tính điểm theo từng cặp người chơi, mọi thay đổi cần người kia chấp nhận.
//
// room.state = {
//   bal:    { "idNhỏ|idLớn": số }   điểm của người có id nhỏ hơn so với người kia (dương = đang thắng)
//   hist:   [ { id, t, from, to, prev, value } ]   các lần đổi điểm đã được chấp nhận
//   notifs: [ { id, kind: 'request' | 'accepted' | 'rejected', from, to, value, t } ]
// }
const int = v => (Number.isInteger(v) && Math.abs(v) <= 1e9 ? v : null);
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const balOf = (s, a, b) => { const v = s.bal[pairKey(a, b)] || 0; return a < b ? v : -v; };
const setBal = (s, a, b, v) => { s.bal[pairKey(a, b)] = a < b ? v : -v; };

module.exports = {
  id: 'phom',
  label: 'Tá lả',
  hint: 'Từ 2 đến 4 người. Mỗi người ghi điểm thắng/thua với từng người còn lại, mọi thay đổi cần người kia chấp nhận.',
  min: 2,
  max: 4,
  needsStart: true,            // chủ phòng bấm "Bắt đầu"; sau đó người mới vào phải được duyệt
  meta: {},

  initState: () => ({ bal: {}, hist: [], notifs: [] }),

  sanitize(raw, ids) {
    raw = raw || {};
    const bal = {};
    for (const k of Object.keys(raw.bal || {})) {
      const [x, y] = k.split('|'); const v = int(raw.bal[k]);
      if (ids.has(x) && ids.has(y) && x < y && v !== null) bal[k] = v;
    }
    const hist = (Array.isArray(raw.hist) ? raw.hist : []).slice(-500).map(h => ({
      id: String((h && h.id) || '').slice(0, 20), t: Number(h && h.t) || 0,
      from: String((h && h.from) || '').slice(0, 16), to: String((h && h.to) || '').slice(0, 16),
      prev: int(h && h.prev), value: int(h && h.value),
    })).filter(h => ids.has(h.from) && ids.has(h.to) && h.prev !== null && h.value !== null);
    return { bal, hist, notifs: [] };
  },

  // Mỗi người chỉ nhận phần dữ liệu liên quan tới mình
  view(room, pid) {
    const s = room.state, bal = {};
    for (const k of Object.keys(s.bal)) { const [a, b] = k.split('|'); if (a === pid || b === pid) bal[k] = s.bal[k]; }
    return {
      bal,
      hist: s.hist.filter(h => h.from === pid || h.to === pid).slice(-60),
      notifs: s.notifs.filter(n => n.to === pid || (n.kind === 'request' && n.from === pid)),
    };
  },

  summary(room, pid) {
    const items = room.players.filter(p => p.id !== pid).map(p => ({ name: p.name, value: balOf(room.state, pid, p.id) }));
    return { total: items.reduce((a, v) => a + v.value, 0), items };
  },

  actions: {
    // Gửi đề xuất đổi điểm với một người
    propose(ctx, m) {
      const { room, state, pid } = ctx;
      const target = String(m.target || '').slice(0, 16), value = int(Number(m.value));
      if (!room.started || value === null || target === pid) return;
      if (!room.players.some(p => p.id === pid) || !room.players.some(p => p.id === target)) return;
      // đề xuất mới thay cho đề xuất cũ chưa được trả lời của cùng cặp
      state.notifs = state.notifs.filter(n => !(n.kind === 'request' && n.from === pid && n.to === target));
      state.notifs.push({ id: ctx.newId('n'), kind: 'request', from: pid, to: target, value, t: ctx.now });
      ctx.changed();
    },

    // Người nhận chấp nhận hoặc từ chối
    respond(ctx, m) {
      const { state, pid } = ctx;
      const id = String(m.id || '').slice(0, 20), accept = !!m.accept;
      const n = state.notifs.find(x => x.id === id && x.to === pid && x.kind === 'request');
      if (!n) return;
      state.notifs = state.notifs.filter(x => x.id !== id);
      if (accept) {                              // sửa điểm cả 2 bên cùng lúc và ghi vào lịch sử
        const prev = balOf(state, n.from, n.to);
        setBal(state, n.from, n.to, n.value);
        state.hist.push({ id: ctx.newId('h'), t: ctx.now, from: n.from, to: n.to, prev, value: n.value });
        if (state.hist.length > 500) state.hist.splice(0, state.hist.length - 500);
      }
      state.notifs.push({ id: ctx.newId('n'), kind: accept ? 'accepted' : 'rejected', from: n.to, to: n.from, value: n.value, t: ctx.now });
      if (state.notifs.length > 300) state.notifs.splice(0, state.notifs.length - 300);
      ctx.changed();
    },

    // Ẩn thông báo kết quả (chấp nhận/từ chối) của chính mình
    dismiss(ctx, m) {
      const id = String(m.id || '').slice(0, 20), before = ctx.state.notifs.length;
      ctx.state.notifs = ctx.state.notifs.filter(x => !(x.id === id && x.to === ctx.pid && x.kind !== 'request'));
      if (ctx.state.notifs.length !== before) ctx.changed();
    },
  },
};
