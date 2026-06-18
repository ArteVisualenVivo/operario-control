import {
  collection, addDoc, deleteDoc, doc, getDoc, getDocs, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { uploadBlueprintToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary"
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

const SPARE_PARTS_COLLECTION = "machine_spare_parts"
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

  const { publicId, secureUrl, originalFilename, format, resourceType } =
    await uploadBlueprintToCloudinary(file)

  const fileType: "pdf" | "image" = format === "pdf" ? "pdf" : "image"

  const docRef = await addDoc(collection(db, COLLECTION), {
    machineId,
    name: originalFilename,
    fileUrl: secureUrl,
    publicId,
    resourceType,
    fileType,
    createdAt: Timestamp.now(),
  })

  await createAuditLog("create", "blueprint", docRef.id, null, {
    machineId, fileUrl: secureUrl, publicId, resourceType, fileName: originalFilename, fileType,
  })

  if (fileType === "pdf") {
    try {
      const oldParts = await getDocs(
        query(
          collection(db, SPARE_PARTS_COLLECTION),
          where("machineId", "==", machineId),
          where("source", "==", "blueprint"),
        ),
      )
      const deletions = oldParts.docs.map((d) => deleteDoc(doc(db, SPARE_PARTS_COLLECTION, d.id)))
      await Promise.all(deletions)
    } catch {
      /* cleanup of old blueprint parts failed — continue */
    }

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
  const data = snap.data()

  const publicId = data.publicId as string | undefined
  const resourceType = (data.resourceType as string) ?? "image"
  if (publicId) {
    try {
      await deleteFromCloudinary(publicId, resourceType)
    } catch {
      /* Cloudinary deletion failed — continue with local cleanup */
    }
  }

  const machineId = data.machineId as string
  if (!machineId) {
    await deleteDoc(ref_)
    await createAuditLog("delete", "blueprint", id, before, null)
    return
  }

  const partsSnap = await getDocs(
    query(
      collection(db, SPARE_PARTS_COLLECTION),
      where("blueprintId", "==", id),
    ),
  )
  const deletions = partsSnap.docs.map((partDoc) =>
    deleteDoc(doc(db, SPARE_PARTS_COLLECTION, partDoc.id)),
  )

  const allPartsSnap = await getDocs(
    query(
      collection(db, SPARE_PARTS_COLLECTION),
      where("machineId", "==", machineId),
    ),
  )
  const legacyDeletions = allPartsSnap.docs
    .filter((d) => {
      const s = d.data().source
      const bpId = d.data().blueprintId
      return (
        s === "blueprint" &&
        (bpId === undefined || bpId === null || bpId === "")
      )
    })
    .map((d) => deleteDoc(doc(db, SPARE_PARTS_COLLECTION, d.id)))

  await Promise.all([...deletions, ...legacyDeletions])

  await deleteDoc(ref_)
  await createAuditLog("delete", "blueprint", id, before, null)
}
