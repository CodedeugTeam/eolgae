<script lang="ts">
  import type { PageProps } from '@codedeugteam/eolgae';
  import type { Item } from '../items.ts';
  let { data }: PageProps<{ item: Item }> = $props();
</script>

<h1 data-page="item-detail">{data.item.name}</h1>
<a href="#part" data-testid="hash-link">아래로</a>
<p id="part" data-testid="part">part</p>
