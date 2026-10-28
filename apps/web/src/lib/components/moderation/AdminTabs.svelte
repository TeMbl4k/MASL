<script lang="ts">
  import { page } from '$app/state';
  import { session } from '#lib/session.svelte.js';

  const TABS = [
    { href: '/admin', label: 'Дела' },
    { href: '/admin/stats', label: 'Статистика' },
    { href: '/admin/support', label: 'Обращения' },
    { href: '/admin/team', label: 'Команда и метки' },
    { href: '/admin/broadcasts', label: 'Рассылки' },
  ] as const;

  // Moderators see only the cases; the API checks the role on every admin call anyway.
  const isAdmin = $derived(session.state.status === 'ready' && session.state.user.role === 'admin');
</script>

{#if isAdmin}
  <nav aria-label="Разделы админки" class="-mx-5 overflow-x-auto px-5">
    <ul class="flex w-max gap-2">
      {#each TABS as tab (tab.href)}
        {@const current = page.url.pathname === tab.href}
        <li>
          <!-- Replaced, not pushed: the tabs are one screen and Back must not walk through them. -->
          <a
            href={tab.href}
            data-sveltekit-replacestate
            aria-current={current ? 'page' : undefined}
            class="flex min-h-10 items-center rounded-full border px-3.5 text-[0.9375rem] whitespace-nowrap {current
              ? 'border-brand bg-brand/20 font-semibold'
              : 'border-gray-dark text-gray-light'}"
          >
            {tab.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
