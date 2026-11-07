// WebSocket 축 테스트용 최소 SPA. /api/ws 에 연결해 메시지 둘을 보내고, 받은 메시지를 화면에 적는다.
// 서버는 연결 직후 welcome 을 보내고 받은 메시지를 그대로 돌려주므로, 받는 메시지는 welcome + echo 둘 = 셋이다.
// 셋을 다 받으면 소켓을 닫고 data-ready=1 을 켠다.
const app = document.getElementById('app');
const list = document.createElement('ol');
list.className = 'messages';
app.appendChild(list);

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${proto}//${location.host}/api/ws?token=abc`);
let received = 0;
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'ping', seq: 1 }));
  ws.send(JSON.stringify({ type: 'chat', text: '안녕', seq: 2 }));
});
ws.addEventListener('message', (ev) => {
  const li = document.createElement('li');
  li.textContent = String(ev.data);
  list.appendChild(li);
  received++;
  if (received >= 3) {
    ws.close();
  }
});
ws.addEventListener('close', () => {
  app.dataset.ready = '1';
});
ws.addEventListener('error', () => {
  console.error('ws 실패');
  app.dataset.ready = '1';
});
