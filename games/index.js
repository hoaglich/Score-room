// Danh sách các trò. Thứ tự ở đây là thứ tự trong ô chọn bộ môn khi tạo phòng.
// Thêm trò mới: tạo thư mục games/<id>/ có logic.js (máy chủ) và ui.js (giao diện), rồi thêm id vào đây.
const ids = ['tienlen', 'phom', 'xidach', 'maubinh', 'samloc', 'lieng', 'free', 'penalty'];

module.exports = Object.fromEntries(ids.map(id => [id, require('./' + id + '/logic.js')]));
