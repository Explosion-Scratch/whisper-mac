import { createRouter, createWebHashHistory } from 'vue-router'
import Settings from './views/Settings.vue'
import Dictation from './views/Dictation.vue'
import Onboarding from './views/Onboarding.vue'

const routes = [
  { path: '/', redirect: '/settings' },
  { path: '/settings', component: Settings },
  { path: '/dictation', component: Dictation },
  { path: '/onboarding', component: Onboarding }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
