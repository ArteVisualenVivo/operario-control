@echo off
REM Limpia el lock colgado del agente
REM Ejecutar manualmente si el agente no inicia

cd /d "C:\Users\Cesar\Desktop\operario-control"
node -e "const fs = require('fs'); const lockFile = 'sync-agent/.agent.lock'; if (fs.existsSync(lockFile)) { fs.unlinkSync(lockFile); console.log('Lock eliminado'); } else { console.log('No hay lock colgado'); }"