import { initializeApp, getApps } from "firebase/app"
import { getFirestore, collection, getDocs } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyCl39k1P-GxLSl2bEa7ZLEfQgeT14SuLlc",
  authDomain: "operario-control.firebaseapp.com",
  projectId: "operario-control",
  storageBucket: "operario-control.firebasestorage.app",
  messagingSenderId: "474065245898",
  appId: "1:474065245898:web:003f8836cec7429ad80633",
}

console.log("=== FIREBASE TEST ===")
console.log("firebaseConfig:", JSON.stringify(firebaseConfig, null, 2))

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
const db = getFirestore(app)

console.log("LOCAL_MODE check:")
console.log("  NEXT_PUBLIC_LOCAL_MODE:", process.env.NEXT_PUBLIC_LOCAL_MODE)
console.log("  LOCAL_MODE:", process.env.LOCAL_MODE)

console.log("\n=== Testing collection 'machines' ===")
try {
  const snapshot = await getDocs(collection(db, "machines"))
  console.log("machines snapshot.size:", snapshot.size)
} catch (err) {
  console.log("machines ERROR:")
  console.log("  code:", err.code)
  console.log("  message:", err.message)
  console.log("  stack:", err.stack)
}

console.log("\n=== Testing collection 'inventory_stock' ===")
try {
  const snapshot = await getDocs(collection(db, "inventory_stock"))
  console.log("inventory_stock snapshot.size:", snapshot.size)
} catch (err) {
  console.log("inventory_stock ERROR:")
  console.log("  code:", err.code)
  console.log("  message:", err.message)
  console.log("  stack:", err.stack)
}