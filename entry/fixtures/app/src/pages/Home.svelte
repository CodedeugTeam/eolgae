<script lang="ts">
  import type { PageProps } from '@codedeugteam/eolgae';
  let { data, params }: PageProps = $props();
  const version = import.meta.env.APP_VERSION;
</script>

<h1 data-page="home">홈</h1>
<p data-testid="version">v{version}</p>
