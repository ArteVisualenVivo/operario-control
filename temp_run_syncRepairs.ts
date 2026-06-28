import fs from 'fs'
import path from 'path'
import { syncRepairsToMaintenance } from './src/lib/sync-3c/engine.js'

const file = path.join('automation-watcher', '3c_exports', 'tresc3790378219325866507.xls')
console.log('using file', file)
const buffer = fs.readFileSync(file).buffer

async function run() {
  try {
    const result = await syncRepairsToMaintenance(buffer)
    console.log('RESULT', JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('ERROR', err)
    if (err instanceof Error) console.error(err.stack)
    process.exit(1)
  }
}

run()
