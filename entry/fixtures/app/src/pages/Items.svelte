<script lang="ts">
  import { page, replaceState, invalidateAll, type PageProps } from '@codedeugteam/eolgae';
  import type { Item } from '../items.ts';
  let { data }: PageProps<{ items: Item[] }> = $props();
  // replaceState 는 page.url 을 바꾸지 않으므로 필터는 page.state 를 먼저 읽는다(gk-dash 목록과 같은 꼴).
  const filter = $derived((page.state.filter as string | undefined) ?? page.url.searchParams.get('q') ?? '');
  const visible = $derived(data.items.filter((i) => i.name.includes(filter)));

  function update(next: string) {
    replaceState(next ? `/items?q=${encodeURIComponent(next)}` : '/items', { ...page.state, filter: next });
  }
</script>

<h1 data-page="items">목록</h1>
<input data-testid="filter" value={filter} oninput={(e) => update(e.currentTarget.value)} />
<p data-testid="count">{visible.length}</p>
<p data-testid="state">{JSON.stringify(page.state)}</p>
<button type="button" data-testid="reload-data" onclick={() => invalidateAll()}>다시 불러오기</button>
<ul>
  {#each visible as item (item.id)}
    <li><a href="/items/{item.id}" data-testid="item-link">{item.name}</a></li>
  {/each}
</ul>
<a href="/items/abc" data-testid="bad-link">잘못된 id</a>
