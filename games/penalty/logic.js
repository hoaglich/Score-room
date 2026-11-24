// Điểm phạt (ít điểm thắng): ghi điểm theo ván. Thêm luật riêng của trò này qua checkRound (xem _shared/rounds-logic.js).
const makeRounds = require('../_shared/rounds-logic');

module.exports = makeRounds({
  id: 'penalty',
  label: 'Điểm phạt (ít điểm thắng)',
  mode: 'free',
  win: 'low',
  hint: 'Nhập điểm phạt mỗi ván, ít điểm nhất thắng.',
});
