import "../sync-agent/env"
import { machineFieldsToRefresh, buildSparePartOrdersFromRecords } from "../src/services/sparePartOrders"
import type { MaintenanceRecord } from "../src/services/maintenance"
import type { SparePartOrder } from "../src/types"

// Caso real: informe DETALLE sin columna DENOMINACION. La identificación
// completa ("... HM 1812 ...") llega por machineName y debe pisar el modelo
// viejo ("... DE 30 KG ...") aunque ninguno sea prefijo del otro.
const stale: SparePartOrder = {
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
  status: "ENCARGADO",
  requestedAt: new Date("2026-10-06"),
  createdAt: new Date("2026-10-01"),
  updatedAt: new Date("2026-10-01"),
  notes: "Importado desde Órdenes de Reparación (3C): repuesto en espera",
}

const upd = machineFieldsToRefresh(stale, "MARTILLO MAKITA HM 1812 30 KG Nº2", undefined)
console.log("UPDATES:", JSON.stringify(upd))
if (String((upd as Record<string, unknown>).machineModel ?? "") !== "MARTILLO MAKITA HM 1812 30 KG Nº2") {
  console.error("FALLO: machineFieldsToRefresh no completa el modelo desde el Detalle sin DENOMINACION")
  process.exit(1)
}

// El constructor en memoria también debe reflejarlo en el snapshot.
const fresh: MaintenanceRecord[] = [
  {
    id: "0001-00011284",
    orderNumber: "0001-00011284",
    entryDate: new Date("2026-10-06"),
    clientName: "COCREAR",
    machineName: "MARTILLO MAKITA HM 1812 30 KG Nº2",
    status: "A la Espera Repuestos",
    statusDate: new Date("2026-10-06"),
    motivoEstadoRep: "620364-2 CONTROLLER",
    motivoByStatus: [{ status: "A la Espera Repuestos", motivo: "620364-2 CONTROLLER" }],
    workItems: [],
    createdAt: new Date("2026-10-06"),
    updatedAt: new Date("2026-10-06"),
  },
]
const built = buildSparePartOrdersFromRecords(fresh, [stale])
const order = built.orders.find((o) => o.orderNumber === "0001-00011284")
console.log("snapshot machineModel:", JSON.stringify(order?.machineModel))
if (String(order?.machineModel ?? "") !== "MARTILLO MAKITA HM 1812 30 KG Nº2") {
  console.error("FALLO: el snapshot no refleja el HM 1812 del Detalle")
  process.exit(1)
}
console.log("OK: Detalle sin DENOMINACION completa el modelo con HM 1812")