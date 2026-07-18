import fs from 'fs';

const LOCK_FILE = "C:\\Users\\Cesar\\Desktop\\operario-control\\sync-agent\\.agent.lock";

if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    console.log("Lock file removed");
} else {
    console.log("No lock file found");
}