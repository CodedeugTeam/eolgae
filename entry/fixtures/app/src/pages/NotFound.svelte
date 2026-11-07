<script lang="ts">
  import { page, type PageProps } from '@codedeugteam/eolgae';
  let { data, params }: PageProps = $props();
</script>

<h1 data-page="not-found">없는 페이지: {page.url.pathname}</h1>
