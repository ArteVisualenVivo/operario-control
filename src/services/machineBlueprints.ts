import {
  collection, addDoc, deleteDoc, doc, getDoc, getDocs, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { uploadBlueprintToCloudinary } from "@/lib/cloudinary"
import { createAuditLog } from "./audit"
import { createSparePart } from "./spareParts"
import { extractPartsFromPdf } from "./pdfPartsExtractor"

export interface MachineBlueprint {
  id: string
  machineId: string
  fileUrl: string
  publicId: string
  fileName: string
  fileType: "pdf" | "image"
  createdAt: Date
}

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

const COLLECTION = "machine_blueprints"

async function getMachineInfo(machineId: string) {
  const snap = await getDoc(doc(db, "machines", machineId))
  if (!snap.exists()) return { machineName: "", machineModel: "" }
  const data = snap.data()
  return {
    machineName: (data.name as string) ?? "",
    machineModel: (data.model as string) ?? "",
  }
}

export async function uploadBlueprint(machineId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
  const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)

  if (ext !== "pdf" && !isImage) {
    throw new Error("Solo se permiten archivos PDF, JPG, JPEG, PNG, GIF o WebP")
  }

  const { publicId, secureUrl, originalFilename, format } =
    await uploadBlueprintToCloudinary(file)

  const fileType: "pdf" | "image" = format === "pdf" ? "pdf" : "image"

  const docRef = await addDoc(collection(db, COLLECTION), {
    machineId,
    name: originalFilename,
    fileUrl: secureUrl,
    publicId,
    fileType,
    createdAt: Timestamp.now(),
  })

  await createAuditLog("create", "blueprint", docRef.id, null, {
    machineId, fileUrl: secureUrl, publicId, fileName: originalFilename, fileType,
  })

  if (fileType === "pdf") {
    try {
      const { machineName, machineModel } = await getMachineInfo(machineId)
      const parts = await extractPartsFromPdf(secureUrl)

      for (const part of parts) {
        try {
          await createSparePart({
            machineId,
            machineName,
            machineModel,
            partName: part.partName,
            partCode: part.partCode,
            category: "otro",
            unit: "unidad",
            stockTotal: 1,
            source: "blueprint",
            blueprintId: docRef.id,
          })
        } catch {
          /* duplicate or error — skip silently */
        }
      }
    } catch {
      /* PDF extraction failed — upload still succeeded */
    }
  }

  return docRef.id
}

export async function getBlueprints(machineId: string): Promise<MachineBlueprint[]> {
  const q = query(
    collection(db, COLLECTION),
    where("machineId", "==", machineId),
    orderBy("createdAt", "desc"),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      machineId: data.machineId as string,
      fileUrl: data.fileUrl as string,
      publicId: (data.publicId as string) ?? "",
      fileName: (data.name as string) ?? (data.fileName as string) ?? "",
      fileType: (data.fileType as "pdf" | "image") ?? "image",
      createdAt: toDate(data.createdAt),
    }
  })
}

export async function deleteBlueprint(id: string): Promise<void> {
  const ref_ = doc(db, COLLECTION, id)
  const snap = await getDoc(ref_)
  if (!snap.exists()) throw new Error("Despiece no encontrado")

  const before = { ...snap.data(), id }

  await deleteDoc(ref_)
  await createAuditLog("delete", "blueprint", id, before, null)
}
