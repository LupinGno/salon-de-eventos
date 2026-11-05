// Pantallas de cocina
(() => {
    'use strict'
    const cola = document.querySelector('[data-autorefresh]')
    if (!cola) return
    const aviso = document.getElementById('actualizado')
    const CADA_MS = 8000

    async function actualizar() {
        try {
            const r = await fetch(cola.dataset.autorefresh, { headers: { Accept: 'text/html' } })
            if (r.redirected || !r.ok) return location.reload()   // sesión vencida u otro problema
            cola.innerHTML = await r.text()
            if (aviso) aviso.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        } catch (e) {
            if (aviso) aviso.textContent = 'Sin conexión con el servidor…'
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

    setInterval(actualizar, CADA_MS)
    if (aviso) aviso.textContent = 'Se actualiza cada 8 segundos'
})()
