// Cộng điểm tự do: ghi điểm theo ván. Thêm luật riêng của trò này qua checkRound (xem _shared/rounds-logic.js).
const makeRounds = require('../_shared/rounds-logic');

module.exports = makeRounds({
  id: 'free',
  label: 'Cộng điểm tự do',
  mode: 'free',
  win: 'high',
  hint: 'Nhập điểm cộng cho từng người mỗi ván, nhiều điểm nhất thắng.',
});
