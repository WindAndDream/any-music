<script setup lang="ts">
import { provideEditingSession, useEditingSession } from '@any-music/ui/catalog'
import type { UiThemeFeatureMap, UiThemeHostSlots } from '@any-music/ui/theme'

import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioDrawerRail from './StudioDrawerRail.vue'
import StudioResults from './StudioResults.vue'
import StudioSearch from './StudioSearch.vue'

defineProps<{ feature: UiThemeFeatureMap['catalog'] }>()
defineSlots<UiThemeHostSlots>()
provideEditingSession(useEditingSession('catalog-root'))
</script>

<template>
  <section class="studio-catalog" aria-label="发现音乐">
    <header class="studio-catalog__heading">
      <div>
        <p class="studio-eyebrow">发现</p>
        <h1>寻找下一首音乐</h1>
      </div>
      <slot name="source-identity" :source-id="feature.state.sourceId" />
    </header>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" />
    <StudioSearch :feature="feature" />
    <div class="studio-catalog__desk">
      <StudioDrawerRail :feature="feature" /><StudioResults
        :key="feature.state.activeDrawerId ?? undefined"
        :feature="feature"
        ><template v-if="$slots['request-account']" #request-account="context"
          ><slot name="request-account" v-bind="context" /></template
      ></StudioResults>
    </div>
  </section>
</template>
