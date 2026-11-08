// load 를 쓰는 fixture 라우트(/items, /items/:id)의 데이터 로더. 정적 파일 /data/items.json 을 읽는다.
import { error, type LoadEvent } from '@codedeugteam/eolgae';

export interface Item {
  id: number;
  name: string;
}

async function fetchItems(fetchFn: typeof fetch): Promise<Item[]> {
  const res = await fetchFn('/data/items.json');
  if (!res.ok) throw new Error(`items ${res.status}`);
  return res.json();
}

export async function listLoad({ fetch }: LoadEvent): Promise<{ items: Item[] }> {
  return { items: await fetchItems(fetch) };
}

export async function detailLoad({ fetch, params }: LoadEvent): Promise<{ item: Item }> {
  const id = Number(params.id);
  if (!Number.isInteger(id)) error(400, 'Invalid item id');
  const item = (await fetchItems(fetch)).find((i) => i.id === id);
  // 일반 Error: 오류 화면은 500 Internal Error 가 된다.
  if (!item) throw new Error(`item ${id} not found`);
  return { item };
}
