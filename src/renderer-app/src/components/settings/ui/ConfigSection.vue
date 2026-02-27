<template>
  <div class="config-section">
    <div class="config-section-header" @click="$emit('toggle', handlerId, section)">
      <i class="ph" :class="icon"></i>
      <span>{{ label }}</span>
      <i class="ph ph-caret-down collapse-icon" :class="{ collapsed: !expanded }"></i>
    </div>
    <div class="config-section-body" v-show="expanded">
      <slot></slot>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    handlerId: { type: String, required: true },
    section: { type: String, required: true },
    icon: { type: String, required: true },
    label: { type: String, required: true },
    configSections: { type: Object, required: true },
  },
  emits: ['toggle'],
  computed: {
    expanded() {
      return this.configSections[`${this.handlerId}_${this.section}`] !== false;
    },
  },
};
</script>
