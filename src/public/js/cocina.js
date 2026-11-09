// se actualizan AL INSTANTE cuando el servidor avisa por Socket.IO
(() => {
    'use strict'
    const cola = document.querySelector('[data-autorefresh]')
    if (!cola) return
    const RESPALDO_MS = 8000        
    const REPASO_MS = 60000        

    let pidiendo = false, otraVez = false
    async function actualizar() {
        if (pidiendo) { otraVez = true; return }      
        pidiendo = true
        try {
            const r = await fetch(cola.dataset.autorefresh, { headers: { Accept: 'text/html' } })
            if (r.redirected || !r.ok) return location.reload()   
            cola.innerHTML = await r.text()
        } catch (e) {  }
        finally {
            pidiendo = false
            if (otraVez) { otraVez = false; actualizar() }
        }
    }

    // Botones Preparar / Listo / Entregado
    cola.addEventListener('submit', async e => {
        const form = e.target.closest('form[data-ajax]')
        if (!form) return
        e.preventDefault()
        const boton = form.querySelector('button')
        if (boton) boton.disabled = true
        try {
            const r = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } })
            if (!r.ok) {
                const d = await r.json().catch(() => ({}))
                Swal.fire({ icon: 'warning', title: 'No se pudo', text: d.error || 'Intenta de nuevo.', confirmButtonColor: '#1b9ad6' })
            }
        } finally {
            actualizar()
        }
    })

    // Avisos del servidor 
    window.addEventListener('tiempo-real', actualizar)

    // Respaldo
    let ultimo = Date.now()
    setInterval(() => {
        const vivo = window.tiempoReal && window.tiempoReal.conectado
        if (Date.now() - ultimo >= (vivo ? REPASO_MS : RESPALDO_MS)) { ultimo = Date.now(); actualizar() }
    }, 1000)
})()
