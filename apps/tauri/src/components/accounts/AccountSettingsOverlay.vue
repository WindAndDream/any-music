<script setup lang="ts">
import { AppIcon, ConfirmationDialog } from '@any-music/ui'
import { computed, shallowRef, watch } from 'vue'

import type { AccountSettingsController } from '../../features/accounts/use-account-settings'
import { useAccountSettingsConfirmation } from '../../features/accounts/use-account-settings-confirmation'
import AccountBreadcrumbs from './AccountBreadcrumbs.vue'
import AccountConnectionForm from './AccountConnectionForm.vue'
import AccountCreateForm from './AccountCreateForm.vue'
import AccountDetailsPanel from './AccountDetailsPanel.vue'
import AccountList from './AccountList.vue'
import AccountLoginPanel from './AccountLoginPanel.vue'
import AccountNameForm from './AccountNameForm.vue'
import AccountPlatformList from './AccountPlatformList.vue'
import AccountSettingsDialog from './AccountSettingsDialog.vue'

/** Account workflows live in the protected overlay host, independently of global settings. */
const props = defineProps<{
  settings: AccountSettingsController
  isMobileLayout?: boolean
  overlayTarget?: HTMLElement | null
  suspended?: boolean
}>()
const confirmation = useAccountSettingsConfirmation({
  detailOpen: props.settings.detailOpen,
  suspended: () => props.suspended,
})
const busy = computed(() => props.settings.busy.value || props.settings.checking.value)
const returning = shallowRef(false)
watch(
  () => props.settings.breadcrumbs.value.length,
  (depth, previous) => {
    returning.value = depth < previous
  },
  { flush: 'sync' },
)
const accounts = computed(() =>
  props.settings.snapshot.value.accounts.filter(
    (account) => account.platformId === props.settings.selectedPlatform.value,
  ),
)
</script>
<template>
  <AccountSettingsDialog
    :page="settings.section.value ?? 'root'"
    :returning="returning"
    :open="settings.detailOpen.value"
    :title="settings.title.value"
    :is-mobile-layout="isMobileLayout"
    :overlay-target="overlayTarget"
    :suspended="suspended || Boolean(confirmation.activeRequest.value)"
    :back-action="settings.back"
    @close="settings.closeDetail"
  >
    <AccountBreadcrumbs :items="settings.breadcrumbs.value" @navigate="settings.navigate" />
    <p v-if="settings.error.value" class="settings-form__error" role="alert">
      {{ settings.error.value }}
    </p>
    <AccountCreateForm
      v-if="settings.section.value === 'add'"
      v-model:name="settings.createName.value"
      :platform="settings.addPlatform.value"
      :platform-label="settings.platformLabel(settings.addPlatform.value)"
      :accounts="settings.snapshot.value.accounts"
      :busy="busy"
      @select-platform="settings.showSection('platform')"
      @add="settings.add"
    />
    <AccountPlatformList
      :platforms="settings.platforms"
      v-else-if="settings.section.value === 'platform'"
      :accounts="settings.snapshot.value.accounts"
      :busy="busy"
      :selection="settings.addPlatform.value"
      choosing
      @select="settings.choosePlatform"
    />
    <AccountList
      v-else-if="settings.section.value === 'accounts'"
      :accounts="accounts"
      :proxies="settings.snapshot.value.proxies"
      :busy="busy"
      :checking-id="settings.checkingId.value"
      :check-results="settings.checkResults.value"
      @select="settings.selectAccountDetail"
      @check="settings.checkAccount"
    />
    <template v-else-if="settings.selectedAccount.value">
      <AccountDetailsPanel
        v-if="settings.section.value === 'details'"
        :platform-label="settings.platformLabel(settings.selectedAccount.value.platformId)"
        :account="settings.selectedAccount.value"
        :proxies="settings.snapshot.value.proxies"
        :busy="busy"
        :checking="settings.checkingId.value === settings.selectedAccount.value.id"
        :check-message="settings.checkResults.value.get(settings.selectedAccount.value.id)?.message"
        @check="settings.checkAccount(settings.selectedAccount.value)"
        @edit-name="settings.showSection('name')"
        @connection="settings.showSection('connection')"
        @login="settings.selectLogin(settings.selectedAccount.value)"
        @update="settings.update"
      />
      <AccountNameForm
        v-else-if="settings.section.value === 'name'"
        :account="settings.selectedAccount.value"
        :accounts="settings.snapshot.value.accounts"
        :busy="busy"
        :editing="settings.editing"
        @save="settings.saveAccount"
      />
      <AccountConnectionForm
        v-else-if="settings.section.value === 'connection'"
        :account="settings.selectedAccount.value"
        :proxies="settings.snapshot.value.proxies"
        :busy="busy"
        :editing="settings.editing"
        @save="settings.saveAccount"
      />
      <AccountLoginPanel
        v-else-if="settings.section.value === 'login'"
        :account="settings.selectedAccount.value"
        :busy="busy"
        :checking="settings.checkingId.value === settings.selectedAccount.value.id"
        :check-message="settings.checkResults.value.get(settings.selectedAccount.value.id)?.message"
        @check="settings.checkAccount(settings.selectedAccount.value)"
        :status="settings.loginStatus.value"
        :phase="settings.loginPhase.value"
        :qr-image="settings.qrImage.value"
        :qr-content="settings.qrContent.value"
        :qr-unavailable="settings.qrUnavailable.value"
        :opening-app="settings.openingApp.value"
        :capabilities="settings.capabilities.value"
        :authentication="settings.authentication.value"
        :phone-code-sent="settings.phoneCodeSent.value"
        :verification="settings.verification.value"
        :retry-after="settings.retryAfter.value"
        @qr="settings.beginQr"
        @choose="settings.chooseMethod"
        @open-qr-app="settings.reopenQrApp"
        @qr-error="settings.disableQr"
        @browser="settings.beginBrowser"
        @credentials="settings.chooseSourceMethod('credentials')"
        @phone="settings.chooseSourceMethod('phone')"
        @without-login="settings.useWithoutLogin"
        @submit-credentials="settings.submitCredentials"
        @send-phone-code="settings.sendPhoneCode"
        @submit-phone-code="settings.submitPhoneCode"
        @complete="settings.completeBrowser"
        @select-verification="settings.selectVerification"
        @resend-sms="settings.resendSms"
        @submit-sms="settings.submitSms"
      />
    </template>
    <template #footer
      ><div class="settings-form__footer">
        <button class="native-settings__button" type="button" @click="settings.back">
          {{ settings.isDialogRoot.value ? '关闭' : '返回' }}
        </button>
        <button
          v-if="settings.section.value === 'details' && settings.selectedAccount.value"
          class="native-settings__button native-settings__button--danger"
          type="button"
          :disabled="busy"
          aria-haspopup="dialog"
          @click="settings.requestRemove(settings.selectedAccount.value, confirmation.confirm)"
        >
          删除账号
        </button>
        <button
          v-if="settings.checking.value"
          class="native-settings__button"
          type="button"
          @click="settings.cancelChecks"
        >
          取消检测
        </button>
        <button
          v-if="settings.section.value === 'accounts'"
          class="settings-form__save"
          type="button"
          :disabled="busy"
          @click="settings.startAdd(settings.selectedPlatform.value)"
        >
          <AppIcon name="plus" :size="16" />添加账号
        </button>
      </div></template
    >
  </AccountSettingsDialog>
  <Teleport :to="overlayTarget ?? 'body'" :disabled="!overlayTarget">
    <ConfirmationDialog
      :request="confirmation.activeRequest.value"
      @confirm="confirmation.accept"
      @cancel="confirmation.cancel"
    />
  </Teleport>
</template>
