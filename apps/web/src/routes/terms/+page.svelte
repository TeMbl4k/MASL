<script lang="ts">
  import { TERMS_VERSION } from '@masl/shared';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import TermsText from '#lib/components/TermsText.svelte';
</script>

<svelte:head>
  <title>Пользовательское соглашение — MASL</title>
</svelte:head>

<main class="min-h-app pb-10">
  <PageHeader
    eyebrow="Документы"
    title="Пользовательское соглашение"
    subtitle="Версия {TERMS_VERSION}, тестовая. Вы её приняли."
  >
    {#snippet heading()}Пользовательское <span class="font-semibold italic">соглашение</span>{/snippet}
  </PageHeader>
  <div class="px-5 pt-5">
    <TermsText />
  </div>
</main>
