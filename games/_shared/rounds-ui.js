// Giao diện dùng chung cho các trò ghi điểm THEO VÁN (bảng điểm, form ghi ván, lịch sử các ván).
// Mỗi trò gọi Games.register('<trò>', Games.rounds()) trong ui.js của mình.
// Dữ liệu từ máy chủ: ctx.room.g.rounds; ctx.game.mode ('zero' | 'free'), ctx.game.win ('high' | 'low').
Games.rounds = function () {
  let ctx = null, entrySig = '';
  const TPL = `
    <div class="card"><h2>Bảng điểm</h2><div id="rank"></div></div>
    <div class="card hidden" id="entryCard">
      <h2>Ghi ván mới</h2>
      <div id="entryRows"></div>
      <div class="sumline" id="sumLine"></div>
      <button class="primary" id="saveRound">Lưu ván</button>
    </div>
    <div class="card">
      <h2>Lịch sử các ván</h2>
      <div class="scroll"><table class="tbl" id="history"></table></div>
      <div class="muted" id="noRounds">Chưa có ván nào.</div>
    </div>`;
  const $ = sel => ctx.root.querySelector(sel);

  function totals() {
    const t = {}; ctx.room.players.forEach(p => { t[p.id] = 0; });
    ctx.room.g.rounds.forEach(r => ctx.room.players.forEach(p => { t[p.id] += r.d[p.id] || 0; }));
    return t;
  }
  function buildEntry() {
    const old = {};
    ctx.root.querySelectorAll('#entryRows input').forEach(i => { old[i.dataset.pid] = i.value; });
    $('#entryRows').innerHTML = ctx.room.players.map(p => `
      <div class="entry-row">
        <span>${ctx.esc(p.name)}</span>
        <input type="number" inputmode="numeric" data-pid="${p.id}" placeholder="0" value="${ctx.esc(old[p.id] || '')}">
        <button data-neg="${p.id}" title="Đổi dấu">±</button>
      </div>`).join('');
    updateSum();
  }
  function readEntry() {
    const vals = {};
    ctx.root.querySelectorAll('#entryRows input').forEach(i => { vals[i.dataset.pid] = i.value === '' ? null : Number(i.value); });
    return vals;
  }
  function updateSum() {
    const vals = readEntry(), el = $('#sumLine');
    const sum = Object.values(vals).reduce((a, v) => a + (v || 0), 0);
    if (ctx.game.mode === 'zero') {
      const empties = Object.values(vals).filter(v => v === null).length;
      el.innerHTML = empties === 1 ? '<span class="muted">Để trống 1 người, hệ thống tự tính cho cân bằng.</span>'
        : sum === 0 ? '<span class="pos">Tổng = 0, hợp lệ</span>' : `<span class="neg">Tổng đang lệch ${ctx.signed(sum)}, cần bằng 0</span>`;
    } else el.innerHTML = `<span class="muted">Tổng ván này: ${sum}</span>`;
  }
  function saveRound() {
    const vals = readEntry(), keys = Object.keys(vals), empties = keys.filter(k => vals[k] === null);
    if (ctx.game.mode === 'zero' && empties.length === 1) vals[empties[0]] = -keys.reduce((a, k) => a + (vals[k] || 0), 0);
    keys.forEach(k => { if (vals[k] === null) vals[k] = 0; });
    const sum = keys.reduce((a, k) => a + vals[k], 0);
    if (ctx.game.mode === 'zero' && sum !== 0) return ctx.toast('Tổng điểm phải bằng 0 (đang lệch ' + sum + ')');
    if (keys.every(k => vals[k] === 0)) return ctx.toast('Chưa nhập điểm nào');
    ctx.act('round', { d: vals });
    ctx.root.querySelectorAll('#entryRows input').forEach(i => { i.value = ''; });
    updateSum();
  }

  return {
    mount(c) {
      ctx = c; entrySig = '';
      ctx.root.innerHTML = TPL;
      ctx.root.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.neg) {
          const i = ctx.root.querySelector(`#entryRows input[data-pid="${b.dataset.neg}"]`);
          if (i && i.value !== '') { i.value = -Number(i.value); updateSum(); }
        } else if (b.dataset.del) { if (confirm('Xoá ván này?')) ctx.act('delround', { id: Number(b.dataset.del) }); }
        else if (b.id === 'saveRound') saveRound();
      };
      ctx.root.oninput = e => { if (e.target.matches('#entryRows input')) updateSum(); };
    },

    render(c) {
      ctx = c;
      const { room, isOwner, me, online } = ctx, rounds = room.g.rounds, hasScore = rounds.length > 0;
      const t = totals();
      const sorted = [...room.players].sort((a, b) => ctx.game.win === 'low' ? t[a.id] - t[b.id] : t[b.id] - t[a.id]);
      $('#rank').innerHTML = sorted.map((p, i) => `
        <div class="rank">
          <span class="${hasScore && i === 0 ? 'lead' : ''}"><span class="dot ${online.includes(p.id) ? 'on' : ''}"></span>${hasScore && i === 0 ? '👑 ' : ''}${ctx.esc(p.name)}${p.id === me ? ' (bạn)' : ''}</span>
          <b class="${t[p.id] > 0 ? 'pos' : t[p.id] < 0 ? 'neg' : ''}">${ctx.signed(t[p.id])}</b>
        </div>`).join('');
      $('#entryCard').classList.toggle('hidden', !isOwner);          // chỉ chủ phòng ghi ván
      const sig = room.players.map(p => p.id).join(',');
      if (isOwner && sig !== entrySig) { entrySig = sig; buildEntry(); }
      $('#noRounds').classList.toggle('hidden', hasScore);
      $('#history').innerHTML = !hasScore ? '' : `
        <tr><th>Ván</th>${room.players.map(p => `<th title="${ctx.esc(p.name)}">${ctx.esc(p.name)}</th>`).join('')}${isOwner ? '<th></th>' : ''}</tr>` +
        [...rounds].reverse().map(r => `
        <tr><td>#${r.id}</td>${room.players.map(p => { const v = r.d[p.id] || 0; return `<td class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${ctx.signed(v)}</td>`; }).join('')}${isOwner ? `<td><button class="x" data-del="${r.id}">✕</button></td>` : ''}</tr>`).join('');
    },

    unmount() { ctx = null; },
  };
};
