import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serviceAccount = require(path.join(__dirname, 'sync-agent', 'service-account.json'))

initializeApp({
    credential: cert(serviceAccount)
})

const db = getFirestore()

async function main() {
    // Consultar máquinas alquiladas
    const machinesSnapshot = await db.collection('machines').where('status', '==', 'rented').get()

    console.log('=== MÁQUINAS ALQUILADAS EN FIREBASE ===')
    console.log(`Total: ${machinesSnapshot.docs.length}`)
    console.log('')

    for (const doc of machinesSnapshot.docs) {
        const data = doc.data()
        const rental = data.rental

        console.log(`ID: ${doc.id}`)
        console.log(`Status: ${data.status}`)
        console.log(`Rental: ${rental ? 'EXISTS' : 'NULL'}`)

        if (rental) {
            console.log(`  expectedEndDate: ${rental.expectedEndDate ? rental.expectedEndDate.toDate() : 'NULL'}`)
            console.log(`  isOpenEnded: ${rental.isOpenEnded}`)
            console.log(`  startDate: ${rental.startDate ? rental.startDate.toDate() : 'NULL'}`)
        }
        console.log('---')
    }

    // Calcular getDaysLeft para cada máquina
    const now = new Date()
    console.log('')
    console.log('=== CÁLCULO getDaysLeft() ===')
    console.log(`Fecha actual: ${now.toISOString()}`)
    console.log('')

    for (const doc of machinesSnapshot.docs) {
        const data = doc.data()
        const rental = data.rental

        if (rental && rental.expectedEndDate && !rental.isOpenEnded) {
            const endDate = rental.expectedEndDate.toDate()
            const days = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

            console.log(`ID: ${doc.id}`)
            console.log(`  expectedEndDate: ${endDate.toISOString()}`)
            console.log(`  getDaysLeft(): ${days}`)
            console.log(`  ¿Entra en filtro (days <= 30)? ${days <= 30 ? 'SÍ' : 'NO'}`)
            console.log('---')
        }
    }
}

main().catch(console.error)