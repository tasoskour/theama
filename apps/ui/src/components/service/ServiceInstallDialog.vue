<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ServiceAccountChoice } from '@theama/contracts'

const props = defineProps<{ modelValue: boolean; mode: 'install' | 'repair' | 'uninstall' }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [account: ServiceAccountChoice | null]
}>()

const account = ref<ServiceAccountChoice['kind']>('current-user')
watch(
  () => props.modelValue,
  (open) => {
    if (open) account.value = 'current-user'
  },
)

function confirm(): void {
  emit('confirm', props.mode === 'uninstall' ? null : { kind: account.value })
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="32rem"
    aria-labelledby="service-dialog-title"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="pa-2">
      <v-card-title id="service-dialog-title" class="th-display">
        {{
          mode === 'install'
            ? $t('service.install.title')
            : mode === 'repair'
              ? $t('service.install.repairTitle')
              : $t('service.install.uninstallTitle')
        }}
      </v-card-title>
      <v-card-text>
        <template v-if="mode === 'uninstall'">
          <p>{{ $t('service.install.uninstallBody') }}</p>
        </template>
        <template v-else>
          <fieldset class="account">
            <legend class="th-eyebrow mb-3">{{ $t('service.install.account') }}</legend>
            <v-radio-group v-model="account" hide-details>
              <v-radio value="current-user" color="primary">
                <template #label>
                  <div>
                    <div>{{ $t('service.install.currentUser') }}</div>
                    <div class="th-muted text-caption">{{ $t('service.install.currentUserHint') }}</div>
                  </div>
                </template>
              </v-radio>
              <v-radio value="local-system" color="primary" class="mt-3">
                <template #label>
                  <div>
                    <div>{{ $t('service.install.localSystem') }}</div>
                    <div class="th-muted text-caption">{{ $t('service.install.localSystemHint') }}</div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>
          </fieldset>
        </template>
        <p class="th-muted text-caption mt-4">{{ $t('service.elevation') }}</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">{{ $t('common.cancel') }}</v-btn>
        <v-btn :color="mode === 'uninstall' ? 'error' : 'primary'" @click="confirm">{{ $t('service.install.confirm') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.account {
  border: 0;
  padding: 0;
  margin: 0;
}
</style>
