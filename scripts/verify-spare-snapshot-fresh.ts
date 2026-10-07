/**
 * Prueba buildSparePartOrdersFromRecords: Excel fresco con HM 1812 sobre una
 * base vieja con DE 30 KG. Verifica que el modelo se completa SIN Firestore.
 */
import "../sync-agent/env"
import { buildSparePartOrdersFromRecords } from "../src/services/sparePartOrders"
import type { MaintenanceRecord } from "../src/services/maintenance"
import type { SparePartOrder } from "../src/types"

const fresh: MaintenanceRecord[] = [
  {
    id: "0001-00011284",
    orderNumber: "0001-00011284",
    entryDate: new Date("2026-10-06"),
    clientName: "COCREAR",
    machineName: "MARTILLO MAKITA HM 1812 30 KG Nº2",
    machineDenominacion: "REPARACION: MARTILLO MAKITA HM 1812 30 KG Nº2",
    status: "A la Espera Repuestos",
    statusDate: new Date("2026-10-06"),
    motivoEstadoRep: "620364-2 CONTROLLER",
    motivoByStatus: [{ status: "A la Espera Repuestos", motivo: "620364-2 CONTROLLER" }],
    workItems: [],
    createdAt: new Date("2026-10-06"),
    updatedAt: new Date("2026-10-06"),
  },
]

const staleBase: SparePartOrder[] = [
  {
    id: "old-1",
    repairId: "0001-00011284",
    orderNumber: "0001-00011284",
    machineId: "0001-00011284",
    machineName: "MARTILLO MAKITA",
    machineModel: "MARTILLO MAKITA DE 30 KG Nº2",
    code: "620364-2",
    description: "CONTROLLER",
    unit: "unidad",
    quantityRequested: 1,
    quantityReceived: 0,
    quantityUsed: 0,
    status: "SOLICITADO",
    requestedAt: new Date("2026-10-06"),
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    notes: "Importado desde Órdenes de Reparación (3C): repuesto en espera",
  },
]

const built = buildSparePartOrdersFromRecords(fresh, staleBase)
const order = built.orders.find((o) => o.orderNumber === "0001-00011284")
console.log("built:", built.orders.length, "created:", built.created, "updated:", built.updated, "modelsUpdated:", built.modelsUpdated)
console.log("machineName:", JSON.stringify(order?.machineName))
console.log("machineModel:", JSON.stringify(order?.machineModel))
const okModel = String(order?.machineModel ?? "").includes("HM 1812")
const okMachine = String(order?.machineName ?? "") === "MARTILLO MAKITA"
if (!order || !okModel || !okMachine) {
  console.error("FALLO: el snapshot desde Excel fresco no completa HM 1812")
  process.exit(1)
}
console.log("OK: snapshot desde Excel fresco completa HM 1812 sin Firestore")
