const path = require("path")

module.exports = {
  watchDir: path.join(__dirname, "3c_exports"),
  stateFile: path.join(__dirname, "state.json"),

  // Mapeo de columnas del Excel exportado por 3C
  // Formato: array de arrays (header: 1), fila 0-indexada
  columns3c: {
    codigo: 2,
    name: 5,
    stockTotal: 20,
    deposito: 1,
    unidadRaw: 7,
  },

  // Fila donde empiezan los datos (0-indexed, row 5 = headers, row 6 = datos)
  dataStartRow: 6,

  // strictMode = true: no crear documentos si el material no existe en Firestore
  // strictMode = false: crear documentos nuevos (necesario para primera importación)
  strictMode: false,

  // Tiempo de espera post-detección (escritura completa del Excel)
  excelWaitMs: 3000,

  // Valores por defecto para materiales nuevos (solo si strictMode = false)
  defaults: {
    unit: "unidad",
    category: "consumibles",
    locationType: "deposito",
  },
}
