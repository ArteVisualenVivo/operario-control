export interface CloudinaryUploadResult {
  publicId: string
  secureUrl: string
  originalFilename: string
  format: string
}

export async function uploadBlueprintToCloudinary(
  file: File,
): Promise<CloudinaryUploadResult> {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("upload_preset", "operario_blueprints")
  formData.append("type", "upload")

  const response = await fetch(
    "https://api.cloudinary.com/v1_1/dpcdsorty/auto/upload",
    { method: "POST", body: formData },
  )

  if (!response.ok) {
    throw new Error("Error al subir archivo a Cloudinary")
  }

  const result = await response.json()

  if (!result.secure_url) {
    throw new Error("Error al subir archivo a Cloudinary")
  }

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    originalFilename: result.original_filename,
    format: result.format,
  }
}
