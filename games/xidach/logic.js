// Xì dách: ghi điểm theo ván. Thêm luật riêng của trò này qua checkRound (xem _shared/rounds-logic.js).
const makeRounds = require('../_shared/rounds-logic');

module.exports = makeRounds({
  id: 'xidach',
  label: 'Xì dách',
  mode: 'zero',
  win: 'high',
  hint: makeRounds.ZERO_HINT,
});
