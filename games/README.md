# Cách tổ chức các trò

Mỗi trò có một thư mục riêng `games/<id>/` gồm hai file tách biệt:

| File | Chạy ở đâu | Việc của nó |
|---|---|---|
| `logic.js` | máy chủ | luật tính điểm, dữ liệu của trò, ai được làm gì |
| `ui.js` | trình duyệt | giao diện của trò |

Phần lõi (kết nối, phòng, người chơi, lưu dữ liệu, duyệt người vào, khoá phòng) nằm ở `server.js` và `public/app.js`, không cần sửa khi chỉnh một trò.

```
server.js                  lõi máy chủ
public/index.html          khung trang
public/style.css           giao diện chung
public/app.js              lõi giao diện
games/index.js             danh sách trò (thứ tự trong ô chọn bộ môn)
games/_shared/             phần dùng chung cho các trò ghi theo ván
games/phom/                Tá lả (luật riêng: điểm từng cặp, đề xuất + chấp nhận)
games/tienlen/ ...         Tiến lên, Xì dách, Mậu binh, Sâm lốc, Liêng, Cộng điểm tự do, Điểm phạt
```

## logic.js (máy chủ)

```js
module.exports = {
  id, label, hint, min, max,   // thông tin hiển thị khi tạo phòng, số người tối thiểu/tối đa
  needsStart: false,           // true: chủ phòng phải bấm "Bắt đầu", sau đó người mới vào cần được duyệt
  meta: {},                    // gửi xuống giao diện (ctx.game.xxx)
  initState() {},              // trạng thái ban đầu, lưu trong room.state
  sanitize(raw, ids) {},       // làm sạch dữ liệu khi khôi phục từ bản sao lưu của chủ phòng
  view(room, pid) {},          // dữ liệu gửi cho từng người (giao diện nhận ở ctx.room.g)
  summary(room, pid) {},       // { total, items: [{ name, value }] } hiện ở "Phòng đã tham gia gần đây"
  actions: { tênThaoTác(ctx, m) {} },   // thao tác giao diện gửi lên
};
```

`ctx` trong `actions`: `room`, `state`, `pid`, `isOwner`, `now`, `newId(tiềnTố)`, `nameOf(id)`, `reject(lýDo)`, `changed()` (gọi sau khi đổi dữ liệu để lưu và gửi cho mọi người).

## ui.js (giao diện)

```js
Games.register('<id>', {
  mount(ctx) {},     // một lần khi vào phòng: vẽ khung vào ctx.root
  render(ctx) {},    // mỗi lần dữ liệu đổi
  unmount() {},      // (không bắt buộc)
});
```

`ctx`: `root`, `room` (có `room.g`), `me`, `isOwner`, `online`, `game`, `act(tênThaoTác, dữLiệu)`, `toast`, `esc`, `signed`, `fmtTime`, `nameOf(id)`.

## Chỉnh một trò ghi theo ván

Các trò ghi theo ván dùng `_shared/rounds-logic.js` và `_shared/rounds-ui.js`. Để thêm luật riêng, sửa `logic.js` của trò đó, ví dụ:

```js
module.exports = makeRounds({
  id: 'tienlen', label: 'Tiến lên', mode: 'zero', win: 'high', hint: makeRounds.ZERO_HINT,
  checkRound(d, room) {                       // d = { idNgườiChơi: điểm }
    if (Object.values(d).some(v => Math.abs(v) > 100)) return 'Điểm mỗi ván không quá 100';
    return null;
  },
});
```

Muốn đổi giao diện riêng, thay `Games.rounds()` trong `ui.js` của trò đó bằng giao diện của bạn.

## Thêm trò mới

1. Tạo `games/<id>/logic.js` và `games/<id>/ui.js`.
2. Thêm `<id>` vào danh sách trong `games/index.js`.
