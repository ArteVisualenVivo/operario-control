"use client"

import { useEffect } from "react"

/**
 * Auto-start del agente de sincronización 3C.
 * Se ejecuta UNA sola vez por sesión de navegador (sessionStorage).
 * Solo funciona cuando la web corre en local (el spawn es local);
 * en producción/Vercel devuelve error y queda registrado sin romper la UI.
 */
export function AgentAutoStart() {
    useEffect(() => {
        if (typeof window === "undefined") return
        if (sessionStorage.getItem("agent-autostart") === "1") return
        sessionStorage.setItem("agent-autostart", "1")

        fetch("/api/sync-3c/start-agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "listener" }),
        })
            .then((r) => r.json())
            .then((data) => console.log("[AgentAutoStart]", data.message ?? data))
            .catch((err) => console.warn("[AgentAutoStart] no disponible:", err))
    }, [])

    return null
}
