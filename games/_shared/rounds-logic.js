// Luật dùng chung cho các trò ghi điểm THEO VÁN: mỗi ván nhập điểm cho từng người.
// Mỗi trò chỉ cần gọi makeRounds({...}) trong logic.js của mình, và có thể thêm luật riêng qua checkRound.
//
//   mode: 'zero'  tổng điểm mỗi ván phải bằng 0 (thắng +, thua −)
//         'free'  nhập điểm tự do
//   win:  'high'  nhiều điểm nhất thắng | 'low'  ít điểm nhất thắng
//   checkRound(d, room): kiểm tra thêm luật riêng của trò, trả về câu báo lỗi hoặc null
const int = v => (Number.isInteger(v) && Math.abs(v) <= 1e9 ? v : null);

function makeRounds(def) {
  const low = def.win === 'low';
  return {
    id: def.id,
    label: def.label,
    hint: def.hint,
    min: def.min || 2,
    max: def.max || 8,
    needsStart: false,
    meta: { mode: def.mode, win: def.win || 'high' },     // gửi xuống giao diện

    // Trạng thái riêng của trò, lưu trong room.state
    initState: () => ({ rounds: [] }),

    // Làm sạch dữ liệu khi khôi phục từ bản sao lưu của chủ phòng
    sanitize(raw, ids) {
      const list = Array.isArray(raw && raw.rounds) ? raw.rounds : [];
      return {
        rounds: list.slice(-500).map(x => {
          const d = {};
          for (const id of ids) { const v = int(x && x.d && x.d[id]); d[id] = v === null ? 0 : v; }
          return { id: int(x && x.id) || 0, t: Number(x && x.t) || 0, d };
        }),
      };
    },

    // Phần dữ liệu gửi cho giao diện (room.g)
    view: room => ({ rounds: room.state.rounds }),

    // Tóm tắt hiển thị ở "Phòng đã tham gia gần đây": tổng điểm của bạn + điểm từng người
    summary(room, pid) {
      const t = {};
      room.players.forEach(p => { t[p.id] = 0; });
      room.state.rounds.forEach(x => room.players.forEach(p => { t[p.id] += x.d[p.id] || 0; }));
      const items = room.players.map(p => ({ name: p.name, value: t[p.id] || 0 }))
        .sort((a, b) => (low ? a.value - b.value : b.value - a.value));
      return { total: t[pid] || 0, items };
    },

    actions: {
      // Chủ phòng ghi một ván
      round(ctx, m) {
        if (!ctx.isOwner) return;
        const d = {};
        let sum = 0, any = false;
        for (const p of ctx.room.players) {
          const raw = m.d && m.d[p.id];
          const v = int(Number(raw == null ? 0 : raw));
          if (v === null) return ctx.reject('Điểm không hợp lệ');
          d[p.id] = v; sum += v; if (v) any = true;
        }
        if (!any) return ctx.reject('Chưa nhập điểm nào');
        if (def.mode === 'zero' && sum !== 0) return ctx.reject('Tổng điểm phải bằng 0 (đang lệch ' + sum + ')');
        if (def.checkRound) { const err = def.checkRound(d, ctx.room); if (err) return ctx.reject(err); }
        const rs = ctx.state.rounds;
        rs.push({ id: rs.reduce((a, x) => Math.max(a, x.id), 0) + 1, t: ctx.now, d });
        if (rs.length > 500) rs.shift();
        ctx.changed();
      },
      // Chủ phòng xoá một ván
      delround(ctx, m) {
        if (!ctx.isOwner) return;
        ctx.state.rounds = ctx.state.rounds.filter(x => x.id !== Number(m.id));
        ctx.changed();
      },
    },
  };
}
makeRounds.ZERO_HINT = 'Mỗi ván tổng điểm các người phải bằng 0 (thắng +, thua −).';
module.exports = makeRounds;
