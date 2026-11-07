// 앱과 서비스 워커가 함께 쓰는 wasm 주소. roomcast 의 matrix-sdk-crypto-wasm 과 같은 꼴(new URL + import.meta.url)이다.
export const payloadUrl = new URL('./payload.wasm', import.meta.url).pathname;
