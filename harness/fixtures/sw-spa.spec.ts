// 서비스 워커 fixture 용 시나리오. network.serviceWorker 를 켜서 서비스 워커가 보낸 요청도 네트워크 축에 넣는다.
// 서비스 워커 요청은 install 이 끝나야 다 나오므로 run 안에서 navigator.serviceWorker.ready 를 기다린다.
import { defineScenarios } from '../src/index.ts';
import { swReady } from './sw-spa-off.spec.ts';

export default defineScenarios([{ name: 'sw-on', run: swReady, network: { serviceWorker: true } }]);
