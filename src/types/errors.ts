export type AppError =
  | { type: "INDEX_MISSING"; message: string; collection: string }
  | { type: "PERMISSION_DENIED"; message: string }
  | { type: "GENERIC"; message: string }
  | null
