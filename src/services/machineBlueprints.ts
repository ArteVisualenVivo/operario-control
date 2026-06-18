import {
  collection, addDoc, deleteDoc, doc, getDocs, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { db, storage } from "@/lib/firebase"
import { createAuditLog } from "./audit"

export interface MachineBlueprint {
  id: string
  machineId: string
  fileUrl: string
  fileName: string
  fileType: "pdf" | "image"
  createdAt: Date
}

interface BlueprintDoc {
  machineId: string
  fileUrl: string
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

export async function uploadBlueprint(machineId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
  const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)
  const fileType: "pdf" | "image" = ext === "pdf" ? "pdf" : "image"
  const fileName = file.name

  if (ext !== "pdf" && !isImage) {
    throw new Error("Solo se permiten archivos PDF, JPG, JPEG, PNG, GIF o WebP")
  }

  const uuid = crypto.randomUUID()
  const storagePath = `blueprints/${machineId}/${uuid}.${ext}`
  const storageRef = ref(storage, storagePath)

  await uploadBytes(storageRef, file)
  const fileUrl = await getDownloadURL(storageRef)

  const docRef = await addDoc(collection(db, COLLECTION), {
    machineId,
    fileUrl,
    fileName,
    fileType,
    createdAt: Timestamp.now(),
  })

  await createAuditLog("create", "blueprint", docRef.id, null, {
    machineId, fileUrl, fileName, fileType,
  })

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
    const data = d.data() as Omit<BlueprintDoc, "createdAt"> & { createdAt: unknown }
    return {
      id: d.id,
      machineId: data.machineId,
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      fileType: data.fileType,
      createdAt: toDate(data.createdAt),
    }
  })
}

export async function deleteBlueprint(id: string): Promise<void> {
  const ref_ = doc(db, COLLECTION, id)
  const snap = await getDocs(query(collection(db, COLLECTION), where("__name__", "==", id)))
  if (snap.empty) throw new Error("Despiece no encontrado")

  const data = snap.docs[0].data() as { fileUrl?: string }
  const before = { ...data, id }

  if (data.fileUrl) {
    try {
      const storageRef_ = ref(storage, data.fileUrl)
      await deleteObject(storageRef_)
    } catch { /* file may not exist */ }
  }

  await deleteDoc(ref_)
  await createAuditLog("delete", "blueprint", id, before, null)
}
