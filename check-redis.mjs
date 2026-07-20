import dotenv from "dotenv"
import { Redis } from "@upstash/redis"

dotenv.config({ path: ".env.local" })

async function checkRedis() {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })

  // Buscar comandos completados recientes
  const completedCommands = []
  let cursor = "0"
  
  do {
    const result = await redis.scan(cursor, { match: "sync-3c:command:*", count: 100 })
    cursor = result[0]
    const keys = result[1]
    
    for (const key of keys) {
      const data = await redis.hgetall(key)
      if (data && data.status === "completed" && data.module) {
        completedCommands.push({
          commandId: key.replace("sync-3c:command:", ""),
          module: data.module,
          completedAt: data.completedAt,
          result: data.result
        })
      }
    }
  } while (cursor !== "0")

  console.log("Comandos completados encontrados:", completedCommands.length)
  completedCommands.forEach(cmd => {
    console.log(`  - ${cmd.module}: ${cmd.commandId} (completado: ${new Date(Number(cmd.completedAt)).toLocaleString()})`)
  })

  // Buscar resultados
  const results = []
  cursor = "0"
  do {
    const result = await redis.scan(cursor, { match: "sync-3c:result:*", count: 100 })
    cursor = result[0]
    const keys = result[1]
    
    for (const key of keys) {
      const data = await redis.hgetall(key)
      if (data && data.status === "completed") {
        results.push({
          resultKey: key.replace("sync-3c:result:", ""),
          module: data.module,
          result: data.result
        })
      }
    }
  } while (cursor !== "0")

  console.log("\nResultados encontrados:", results.length)
  results.forEach(r => {
    console.log(`  - ${r.module}: ${r.resultKey}`)
  })
}

checkRedis().catch(console.error)