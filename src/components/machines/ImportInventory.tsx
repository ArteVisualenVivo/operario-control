"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function ImportInventory() {
  const router = useRouter()

  const handleClick = () => {
    try {
      window.localStorage.setItem("machines-source", "inventory")
    } catch {
      // ignore
    }
    router.push("/machines?source=inventory")
  }

  return (
    <Button variant="outline" onClick={handleClick}>
      Tomar desde inventario
    </Button>
  )
}
