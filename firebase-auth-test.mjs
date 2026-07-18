import { initializeApp, getApps } from "firebase/app"
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth"
import { getFirestore, collection, getDocs } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyCl39k1P-GxLSl2bEa7ZLEfQgeT14SuLlc",
  authDomain: "operario-control.firebaseapp.com",
  projectId: "operario-control",
  storageBucket: "operario-control.firebasestorage.app",
  messagingSenderId: "474065245898",
  appId: "1:474065245898:web:003f8836cec7429ad80633",
}

console.log("=== FIREBASE CONFIG ===")
console.log("projectId:", firebaseConfig.projectId)
console.log("apiKey:", firebaseConfig.apiKey)
console.log("authDomain:", firebaseConfig.authDomain)

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
const auth = getAuth(app)
const db = getFirestore(app)

console.log("\n=== AUTH STATE BEFORE LOGIN ===")
console.log("auth.currentUser:", auth.currentUser)

// Esperar a que onAuthStateChanged se dispare
await new Promise((resolve) => {
  const unsub = onAuthStateChanged(auth, (user) => {
    console.log("onAuthStateChanged user:", user)
    resolve()
    unsub()
  })
})

console.log("\n=== TESTING getDocs WITHOUT AUTH ===")
try {
  const snapshot = await getDocs(collection(db, "machines"))
  console.log("machines snapshot.size:", snapshot.size)
} catch (err) {
  console.log("machines ERROR:")
  console.log("  code:", err.code)
  console.log("  message:", err.message)
}