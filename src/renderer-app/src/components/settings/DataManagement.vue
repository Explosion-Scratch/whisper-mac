<template>
  <div class="data-management-section">
    <div class="total-data-usage-summary">
      <div class="usage-stats">
        <div class="usage-item">
          <i class="ph-duotone ph-chart-pie"></i>
          <span class="usage-label">Total Usage:</span>
          <span class="usage-value">{{ formatBytes(totalDataUsage) }}</span>
        </div>
        <div class="usage-item">
          <i class="ph-duotone ph-folder-simple"></i>
          <span class="usage-label">Plugins with Data:</span>
          <span class="usage-value">{{ pluginCountWithData }}</span>
        </div>
      </div>
    </div>

    <div class="section-header-small">
      <h5>Plugin Data Management</h5>
      <div class="header-actions">
        <button type="button" @click="$emit('clearAll')" class="btn btn-negative btn-sm" :disabled="isClearingAll || !pluginDataInfo.length" title="Clear all data from all plugins">
          <i class="ph-duotone ph-trash"></i> Clear All Data
        </button>
        <button type="button" @click="$emit('refresh')" class="btn btn-sm refresh-btn" title="Refresh data management">
          <i class="ph-duotone ph-arrow-clockwise"></i> Refresh
        </button>
      </div>
    </div>
    <div class="plugin-data-list">
      <div v-if="!pluginDataInfo.length" class="loading-indicator">
        <i class="ph-duotone ph-circle-notch" style="animation: spin 1s linear infinite"></i>Loading...
      </div>
      <template v-for="plugin in pluginDataInfo" :key="plugin.name">
        <div class="plugin-data-item" :class="{ active: plugin.isActive }">
          <div class="plugin-data-info">
            <div class="plugin-data-info-content">
              <div>
                <div class="plugin-name">
                  {{ plugin.displayName }}
                  <span v-if="plugin.isActive" class="active-badge">Active</span>
                </div>
                <div class="plugin-data-details-summary">
                  <span class="data-size"><i class="ph-duotone ph-hard-drive"></i> {{ formatBytes(plugin.dataSize) }}</span>
                </div>
              </div>
              <div class="plugin-data-actions">
                <button type="button" @click="togglePluginDetails(plugin.name)" class="btn btn-sm plugin-details-btn" title="View Details">
                  <i class="ph-duotone ph-list-bullets"></i>
                </button>
                <button v-if="!plugin.isActive" type="button" @click="$emit('clearPlugin', plugin.name)" class="btn btn-negative btn-sm" title="Clear All">
                  <i class="ph-duotone ph-trash"></i>
                </button>
              </div>
            </div>
          </div>
          <div class="plugin-data-details" v-if="expandedDataPlugins[plugin.name]">
            <div class="plugin-data-details-header">
              <h6>Data Items</h6>
              <span class="item-count">{{ pluginDataItems[plugin.name]?.length || 0 }} items</span>
            </div>
            <div v-if="!pluginDataItems[plugin.name]" class="loading-indicator">
              <i class="ph-duotone ph-circle-notch" style="animation: spin 1s linear infinite"></i>Loading...
            </div>
            <div v-else-if="!pluginDataItems[plugin.name].length" class="empty-state">
              <i class="ph-duotone ph-folder-open"></i>
              <p>No data items found</p>
            </div>
            <div v-else class="plugin-data-items">
              <div v-for="item in pluginDataItems[plugin.name]" :key="item.id" class="plugin-data-item-detail">
                <div class="item-info">
                  <div class="item-size">{{ formatBytes(item.size) }}</div>
                  <div class="item-name" :title="item.description">{{ item.name }}</div>
                </div>
                <div class="item-actions">
                  <button type="button" @click="$emit('deleteItem', plugin.name, item.id, item.name)" class="btn btn-xs btn-negative delete-item-btn" title="Delete">
                    <i class="ph-duotone ph-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import { formatBytes } from '../../utils/formatters';

export default {
  props: {
    pluginDataInfo: { type: Array, required: true },
    pluginDataItems: { type: Object, required: true },
    isClearingAll: { type: Boolean, default: false },
  },
  emits: ['clearAll', 'clearPlugin', 'deleteItem', 'refresh', 'toggleDetails'],
  data() {
    return {
      expandedDataPlugins: {},
    };
  },
  computed: {
    totalDataUsage() {
      return this.pluginDataInfo.reduce((total, p) => total + (p.dataSize || 0), 0);
    },
    pluginCountWithData() {
      return this.pluginDataInfo.filter((p) => p.dataSize > 0).length;
    },
  },
  methods: {
    formatBytes(bytes) {
      return formatBytes(bytes);
    },
    togglePluginDetails(pluginName) {
      this.expandedDataPlugins[pluginName] = !this.expandedDataPlugins[pluginName];
      if (this.expandedDataPlugins[pluginName]) {
        this.$emit('toggleDetails', pluginName);
      }
    },
  },
};
</script>
