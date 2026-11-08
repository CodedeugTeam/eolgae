<script lang="ts">
  // SvelteKit 기본 오류 화면과 같은 마크업.
  import { page } from '@codedeugteam/eolgae';
</script>

<h1>{page.status}</h1>
<p>{page.error?.message}</p>
