// TÁ LẢ: giao diện. Dữ liệu từ máy chủ nằm ở ctx.room.g = { bal, hist, notifs } (đã lọc theo người xem).
//
// Cách hiển thị thông báo:
//  - Yêu cầu đổi điểm (có nút Chấp nhận / Từ chối) hiện ngay phía trên tên của người gửi.
//  - Mục "Thông báo" chỉ hiện kết quả: ai đã chấp nhận hoặc từ chối đề xuất của bạn (tự ẩn sau 3 giây).
Games.register('phom', (function () {
  let ctx = null, drafts = {}, pairSig = '';
  const timers = {};             // hẹn giờ tự ẩn thông báo kết quả
  const TPL = `
    <div class="card"><h2>Thông báo</h2><div id="notifs"></div></div>
    <div class="card" style="text-align:center">
      <div class="muted">Tổng điểm của bạn</div>
      <div class="big" id="totalVal">0</div>
      <div class="muted" id="totalSub"></div>
    </div>
    <div class="card">
      <h2>Điểm với từng người</h2>
      <div class="muted" style="margin-bottom:6px">Số dương: bạn đang thắng người đó. Số âm: bạn đang thua. Sửa số rồi bấm Xác nhận để gửi cho họ duyệt.</div>
      <div id="pairRows"></div>
    </div>`;
  const $ = sel => ctx.root.querySelector(sel);

  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const balOf = (a, b) => { const v = ctx.room.g.bal[pairKey(a, b)] || 0; return a < b ? v : -v; };

  // Yêu cầu của người khác gửi cho mình (hiện trên tên người gửi)
  function requestHtml(n) {
    return `
      <div class="note req">
        <div>${ctx.esc(ctx.nameOf(n.from))} đề xuất điểm giữa hai người: bạn <b>${ctx.signed(-n.value)}</b> <span class="muted">(hiện tại ${ctx.signed(balOf(ctx.me, n.from))})</span></div>
        <div class="acts"><button class="primary" data-acc="${n.id}">Chấp nhận</button><button class="danger" data-rej="${n.id}">Từ chối</button></div>
      </div>`;
  }
  // Kết quả (mục Thông báo): ai đã chấp nhận hoặc từ chối
  function resultHtml(n) {
    const who = ctx.esc(ctx.nameOf(n.from));
    return n.kind === 'accepted'
      ? `<div class="note"><button class="x2" data-dis="${n.id}" title="Ẩn">✕</button>${who} đã chấp nhận. Điểm của bạn với ${who}: <b>${ctx.signed(n.value)}</b></div>`
      : `<div class="note"><button class="x2" data-dis="${n.id}" title="Ẩn">✕</button>${who} đã từ chối đề xuất <b>${ctx.signed(n.value)}</b> của bạn.</div>`;
  }

  function renderNotifs() {
    const results = ctx.room.g.notifs.filter(n => n.to === ctx.me && n.kind !== 'request').sort((a, b) => b.t - a.t);
    $('#notifs').innerHTML = results.map(resultHtml).join('') || '<div class="muted">Chưa có thông báo.</div>';
    results.forEach(n => {
      if (!timers[n.id]) timers[n.id] = setTimeout(() => { delete timers[n.id]; if (ctx) ctx.act('dismiss', { id: n.id }); }, 3000);
    });
  }
  function renderTotal() {
    const total = ctx.room.players.filter(p => p.id !== ctx.me).reduce((a, p) => a + balOf(ctx.me, p.id), 0);
    $('#totalVal').textContent = ctx.signed(total);
    $('#totalVal').className = 'big ' + (total > 0 ? 'pos' : total < 0 ? 'neg' : '');
    $('#totalSub').textContent = total > 0 ? 'Bạn đang thắng' : total < 0 ? 'Bạn đang thua' : 'Đang hoà';
  }
  function renderRows() {
    const others = ctx.room.players.filter(p => p.id !== ctx.me), box = $('#pairRows');
    const sigStr = others.map(p => p.id + ':' + p.name).join('|');
    if (sigStr !== pairSig) {            // chỉ dựng lại khung khi danh sách người đổi, để không mất số đang gõ
      pairSig = sigStr;
      box.innerHTML = others.length ? others.map(p => `
        <div class="pair" data-p="${p.id}">
          <div data-notes="${p.id}"></div>
          <div class="pair-top"><span class="dot"></span>${ctx.esc(p.name)}</div>
          <div class="entry-row2">
            <input type="number" inputmode="numeric" step="1" data-in="${p.id}">
            <button data-dec="${p.id}">-1</button>
            <button data-inc="${p.id}">+1</button>
            <button class="primary hidden" data-ok="${p.id}">Xác nhận</button>
          </div>
          <div class="pend hidden" data-pend="${p.id}"></div>
          <div class="hist" data-hist="${p.id}"></div>
        </div>`).join('') : '<div class="muted">Chưa có người chơi khác trong phòng.</div>';
    }
    updateRows();
  }
  function updateRows() {
    const box = $('#pairRows'), g = ctx.room.g;
    ctx.room.players.filter(p => p.id !== ctx.me).forEach(p => {
      const inp = box.querySelector(`[data-in="${p.id}"]`); if (!inp) return;
      const cur = balOf(ctx.me, p.id);
      if (drafts[p.id] !== undefined && Number(drafts[p.id]) === cur && drafts[p.id] !== '') delete drafts[p.id];
      const draft = drafts[p.id];
      if (document.activeElement !== inp) inp.value = draft !== undefined ? draft : String(cur);
      const changed = draft !== undefined && draft !== '' && Number.isInteger(Number(draft)) && Number(draft) !== cur;
      box.querySelector(`[data-ok="${p.id}"]`).classList.toggle('hidden', !changed);
      box.querySelector(`[data-p="${p.id}"] .dot`).classList.toggle('on', ctx.online.includes(p.id));
      // yêu cầu của người này gửi cho mình: hiện ngay trên tên họ
      box.querySelector(`[data-notes="${p.id}"]`).innerHTML = g.notifs
        .filter(n => n.kind === 'request' && n.to === ctx.me && n.from === p.id).sort((a, b) => b.t - a.t).map(requestHtml).join('');
      // đề xuất mình đã gửi đi và đang chờ
      const pend = g.notifs.find(n => n.kind === 'request' && n.from === ctx.me && n.to === p.id), el = box.querySelector(`[data-pend="${p.id}"]`);
      el.classList.toggle('hidden', !pend);
      if (pend) el.textContent = `Đã gửi đề xuất ${ctx.signed(pend.value)}, đang chờ ${p.name} chấp nhận`;
      // lịch sử thay đổi: chỉ 5 lần gần nhất
      const hl = g.hist.filter(h => (h.from === ctx.me && h.to === p.id) || (h.from === p.id && h.to === ctx.me)).sort((a, b) => b.t - a.t).slice(0, 5);
      box.querySelector(`[data-hist="${p.id}"]`).innerHTML = hl.length
        ? '<div class="muted hh">Lịch sử thay đổi (5 lần gần nhất)</div>' + hl.map(h => {
            const mine = h.from === ctx.me, prev = mine ? h.prev : -h.prev, val = mine ? h.value : -h.value, d = val - prev;
            return `<div class="hrow"><span class="muted">${ctx.fmtTime(h.t)}</span> ${ctx.signed(prev)} → <b>${ctx.signed(val)}</b> <span class="${d > 0 ? 'pos' : 'neg'}">(${ctx.signed(d)})</span> <span class="muted">${ctx.esc(ctx.nameOf(h.from))} đề xuất</span></div>`;
          }).join('')
        : '<div class="muted hh">Chưa có thay đổi nào.</div>';
    });
  }
  function bump(pid, d) {                // -1 / +1: tăng giảm nhanh số trong ô
    const i = $('#pairRows').querySelector(`[data-in="${pid}"]`);
    const base = i.value !== '' && Number.isFinite(Number(i.value)) ? Math.round(Number(i.value)) : balOf(ctx.me, pid);
    i.value = String(base + d); drafts[pid] = i.value; updateRows();
  }
  function sendProposal(pid) {
    const inp = $('#pairRows').querySelector(`[data-in="${pid}"]`), v = Number(inp.value);
    if (inp.value === '' || !Number.isInteger(v)) return ctx.toast('Hãy nhập số nguyên');
    delete drafts[pid]; inp.value = String(balOf(ctx.me, pid));
    ctx.act('propose', { target: pid, value: v });
    ctx.toast('Đã gửi đề xuất');
  }

  return {
    mount(c) {
      ctx = c; drafts = {}; pairSig = '';
      ctx.root.innerHTML = TPL;
      ctx.root.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.acc) ctx.act('respond', { id: d.acc, accept: true });
        else if (d.rej) ctx.act('respond', { id: d.rej, accept: false });
        else if (d.dis) ctx.act('dismiss', { id: d.dis });
        else if (d.dec) bump(d.dec, -1);
        else if (d.inc) bump(d.inc, 1);
        else if (d.ok) sendProposal(d.ok);
      };
      ctx.root.oninput = e => { const i = e.target.dataset && e.target.dataset.in; if (i) { drafts[i] = e.target.value; updateRows(); } };
    },
    render(c) { ctx = c; renderNotifs(); renderTotal(); renderRows(); },
    unmount() { Object.values(timers).forEach(clearTimeout); ctx = null; },
  };
})());
