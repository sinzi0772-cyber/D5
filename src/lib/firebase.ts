import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const defaultConfig = {
  apiKey: 'AIzaSyAPpUhiZ2NEBcPtOJxI7faoPQQbelBfkm0',
  authDomain: 'd5-partner-desk.firebaseapp.com',
  projectId: 'd5-partner-desk',
  storageBucket: 'd5-partner-desk.firebasestorage.app',
  messagingSenderId: '336806163815',
  appId: '1:336806163815:web:614c1d2cff03d2e3352bc2',
}

const config = {
  apiKey: defaultConfig.apiKey,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || defaultConfig.authDomain,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || defaultConfig.projectId,
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) || defaultConfig.storageBucket,
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || defaultConfig.messagingSenderId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || defaultConfig.appId,
}

export const isFirebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)
export const isDemoMode = !isFirebaseConfigured && (import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true')
const app = isFirebaseConfigured ? initializeApp(config) : null
export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null
