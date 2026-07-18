import fs from 'fs'

const lockFile = "C:\\Users\\Cesar\\Desktop\\operario-control\\sync-agent\\.agent.lock"

try {
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile)
    console.log("Lock file eliminado exitosamente")
  } else {
    console.log("Lock file no existe")
  }
} catch (err) {
  console.error("Error:", err)
}