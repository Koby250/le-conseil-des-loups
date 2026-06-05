import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Configuration dynamique via les variables d'environnement (Vite)
// Assurez-vous d'ajouter ces variables (VITE_FIREBASE_API_KEY, etc.) dans l'interface de votre hébergeur (Netlify).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "VOTRE_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "VOTRE_PROJET.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "VOTRE_PROJET_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "VOTRE_PROJET.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "VOTRE_MESSAGING_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "VOTRE_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);