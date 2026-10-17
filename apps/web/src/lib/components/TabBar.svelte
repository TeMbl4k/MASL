<script lang="ts">
  import type { Component } from 'svelte';
  import { preloadCode } from '$app/navigation';
  import { page } from '$app/state';
  import type { RouteId } from '$app/types';
  import { warmMaplibre } from '#lib/map/maplibre.js';
  import { myLobbies } from '#lib/stores/my-lobbies.svelte.js';
  import Calendar from './icons/Calendar.svelte';
  import Home from './icons/Home.svelte';
  import Pin from './icons/Pin.svelte';
  import Plus from './icons/Plus.svelte';
  import User from './icons/User.svelte';
  import type { IconProps } from './icons/Icon.svelte';

  interface Tab {
    href: string;
    route: RouteId;
    label: string;
    icon: Component<IconProps>;
    onwarm?: () => void;
  }

  const tabs: Tab[] = [
    { href: '/', route: '/(tabs)', label: 'Лента', icon: Home },
    {
      href: '/map',
      route: '/(tabs)/map',
      label: 'Карта',
      icon: Pin,
      onwarm: () => {
        void preloadCode('/(tabs)/map').catch(() => undefined);
        warmMaplibre();
      },
    },
    { href: '/create', route: '/create', label: 'Создать встречу', icon: Plus },
    { href: '/my', route: '/(tabs)/my', label: 'Мои события', icon: Calendar },
    { href: '/profile', route: '/(tabs)/profile', label: 'Профиль', icon: User },
  ];
</script>

<nav aria-label="Разделы" class="fixed inset-x-0 bottom-0 z-30 bg-ink/90 pb-(--safe-bottom) backdrop-blur">
  <ul class="mx-auto flex h-(--tab-bar-height) max-w-lg items-center justify-between px-6">
    {#each tabs as tab (tab.href)}
      {@const active = page.route.id === tab.route}
      {@const Icon = tab.icon}
      <li class="flex">
        {#if tab.route === '/create'}
          <a
            href={tab.href}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
            class="flex size-14 items-center justify-center rounded-full border-2 border-brand text-brand transition active:scale-95 {active
              ? 'bg-brand/20'
              : 'bg-ink'}"
          >
            <Icon size={26} strokeWidth={2.2} />
          </a>
        {:else}
          {@const dot = tab.route === '/(tabs)/my' && myLobbies.pendingTotal > 0}
          <a
            href={tab.href}
            aria-label={dot ? `${tab.label}, есть новые заявки` : tab.label}
            aria-current={active ? 'page' : undefined}
            ontouchstart={tab.onwarm}
            onmouseenter={tab.onwarm}
            class="relative flex size-12 items-center justify-center rounded-full text-paper transition active:scale-95 {active
              ? 'bg-brand'
              : 'bg-gray-dark'}"
          >
            <Icon />
            {#if dot}
              <span
                aria-hidden="true"
                class="absolute top-1 right-1 size-2.5 rounded-full border-2 {active
                  ? 'border-brand bg-paper'
                  : 'border-gray-dark bg-brand'}"
              ></span>
            {/if}
          </a>
        {/if}
      </li>
    {/each}
  </ul>
</nav>
