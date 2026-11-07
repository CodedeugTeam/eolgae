<script lang="ts">
  import { page, type LayoutProps } from '@codedeugteam/eolgae';
  let { Page, data, params }: LayoutProps = $props();
</script>

<nav>
  <a href="/" data-testid="nav-home">홈</a>
  <a href="/about" data-testid="nav-about">소개</a>
  <a href="/legacy-page" data-testid="nav-legacy" data-eolgae-reload>옛 페이지(전체 이동)</a>
  <a href="/not-in-table" data-testid="nav-unknown">표에 없는 경로</a>
  <a href="https://example.com/" data-testid="nav-external">외부</a>
</nav>
<p data-testid="page-url">{page.url.pathname}</p>
<p data-testid="route-id">{page.route.id}</p>
<main>
  <Page {data} {params} />
</main>
