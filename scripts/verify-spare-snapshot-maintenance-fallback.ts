import "../sync-agent/env"
import { publishSparePartOrdersSnapshot } from "../src/services/sparePartOrders"
import { installSparePartOrdersServerStore } from "../src/services/sparePartOrderStore.server"
import { getRedis, readModuleData } from "../src/lib/sync-3c/redisPrimary"

/**
 * Verifica el fix del snapshot de Pedidos Rep. cuando el agente llega SIN
 * registros frescos en memoria (consolidado cortado por timeout de cuota):
 *
 *   1. Publica el snapshot SIN argumentos (simula al agente con consolidate=null).
 *   2. El nuevo fallback debe leer el consolidado de Redis (maintenance) y
 *      refrescar los datos de la web con el Excel FRESCO de esta corrida.
 *   3. Se comprueba que la orden 11284 muestre "HM 1812".
 */
async function main() {
  installSparePartOrdersServerStore()
  const published = await publishSparePartOrdersSnapshot()
  console.log(`publish (sin registros frescos en memoria) -> ${published} pedido(s)`)

  const redis = getRedis()
  const env = await readModuleData("spare_part_orders", redis)
  const orders = env && Array.isArray(env.data) ? (env.data as Record<string, unknown>[]) : []
  console.log("snapshot en Redis:", orders.length, "pedido(s)")

  const o = orders.find((x) => String(x.orderNumber ?? "").includes("11284"))
  if (!o) {
    console.log("FAIL: orden 11284 no encontrada en el snapshot de Redis")
    process.exitCode = 1
    return
  }
  const machineName = String(o.machineName ?? "")
  const machineModel = String(o.machineModel ?? "")
  const ident = `${machineName} ${machineModel}`
  console.log("11284 =>", JSON.stringify({ machineName, machineModel, updatedAt: o.updatedAt }, null, 2))
  if (!/HM\s*1812/i.test(ident)) {
    console.log("FAIL: la identificación de la máquina NO contiene HM 1812")
    process.exitCode = 1
    return
  }
  console.log("OK: snapshot desde consolidado Redis con identificación fresca")
}
main()
  .then(() => setTimeout(() => process.exit(process.exitCode ?? 0), 200))
  .catch((e) => { console.error(e); process.exit(1) })
