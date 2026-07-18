// Script de limpieza de lock colgado
const fs = require('fs');
const path = require('path');

const LOCK_FILE = "C:\\Users\\Cesar\\Desktop\\operario-control\\sync-agent\\.agent.lock";

try {
    if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"));
        const lockPid = lockData.pid;
        const lockTime = lockData.timestamp;
        const now = Date.now();
        
        console.log(`[CLEANUP] Lock file found: PID ${lockPid}, age: ${now - lockTime}ms`);
        
        // Verificar si el proceso está vivo
        try {
            process.kill(lockPid, 0);
            console.log(`[CLEANUP] Process ${lockPid} is still running`);
        } catch (e) {
            console.log(`[CLEANUP] Process ${lockPid} is dead, removing lock`);
            fs.unlinkSync(LOCK_FILE);
            console.log(`[CLEANUP] Lock file removed`);
        }
    } else {
        console.log(`[CLEANUP] No lock file found`);
    }
} catch (err) {
    console.error(`[CLEANUP] Error:`, err.message);
}