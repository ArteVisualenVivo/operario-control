const path = require("path")

module.exports = {
  watchDir: path.join(__dirname, "3c_exports"),
  stateFile: path.join(__dirname, "state.json"),

  // Mapeo de columnas del Excel exportado por 3C
  // Ajustar según el formato real de exportación
  columns: {
    name: "A",
    stockTotal: "B",
    stockAvailable: "C",
  },

  // strictMode = true: no crear documentos si el material no existe en Firestore
  strictMode: true,

  // Tiempo de espera post-detección (escritura completa del Excel)
  excelWaitMs: 3000,

  // Valores por defecto para materiales nuevos (solo si strictMode = false)
  defaults: {
    unit: "unidad",
    category: "consumibles",
    locationType: "deposito",
  },
}
