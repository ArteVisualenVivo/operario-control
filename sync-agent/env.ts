// Precarga .env.local para el agente local (Node sin Next.js).
// Importar este módulo PRIMERO en agent.ts garantiza que las variables de
// entorno existan antes de que cualquier import evalúe src/lib/firebase.ts,
// el cual llama a getAuth() con la apiKey de Firebase.
import dotenv from "dotenv"
import { fileURLToPath } from "url"

dotenv.config({
    path: fileURLToPath(new URL("../.env.local", import.meta.url)),
})
