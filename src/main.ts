import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './assets/index.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/realtime' },
    {
      path: '/realtime',
      component: () => import('./pages/RealtimePage.vue'),
    },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')
