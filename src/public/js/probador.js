// Probador de pedidos 
(() => {
    'use strict'
    const sel = document.getElementById('probar-producto')
    if (!sel) return
    const caja = document.getElementById('probar-opciones')
    const boton = document.getElementById('probar-enviar')
    const salida = document.getElementById('probar-resultado')
    const dinero = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

    const opcionesRadio = (nombre, items, etiqueta) => items.length ? `
        <div class="mb-2"><div class="fw-semibold">${etiqueta}</div>
        ${items.map((x, i) => `<div class="form-check"><input class="form-check-input" type="radio" name="${nombre}" id="${nombre}-${x.id}" value="${x.id}" ${i === 0 ? 'checked' : ''}>
        <label class="form-check-label" for="${nombre}-${x.id}">${esc(x.nombre)} ${x.precio ? dinero(x.precio) : x.precio_extra > 0 ? '+' + dinero(x.precio_extra) : ''}${x.disponible === false ? ' <span class="text-body-secondary">(no disponible hoy)</span>' : ''}</label></div>`).join('')}</div>` : ''

    const opcionesCheck = (nombre, items, etiqueta, conPrecio) => items.length ? `
        <div class="mb-2"><div class="fw-semibold">${etiqueta}</div>
        ${items.map(x => `<div class="form-check"><input class="form-check-input" type="checkbox" name="${nombre}" id="${nombre}-${x.id}" value="${x.id}">
        <label class="form-check-label" for="${nombre}-${x.id}">${esc(x.nombre)} ${conPrecio ? '+' + dinero(x.precio) : ''}</label></div>`).join('')}</div>` : ''

    sel.addEventListener('change', async () => {
        salida.innerHTML = ''
        caja.innerHTML = ''
        boton.disabled = true
        if (!sel.value) return
        const r = await fetch('/api/productos/' + sel.value)
        const p = await r.json()
        // Se muestran los fijos pero no se pueden quitar, solo los moviles
        caja.innerHTML =
            (p.vendible ? '' : `<div class="alert alert-warning py-1 px-2">Fuera del menú: ${esc(p.motivo)}. Pruébalo para ver que el servidor lo rechaza.</div>`) +
            opcionesRadio('tamano', p.tamanos, 'Tamaño') +
            opcionesRadio('estilo', p.estilos, 'Estilo') +
            opcionesCheck('quitar', p.moviles, 'Quitar (gratis)') +
            opcionesCheck('quitar', p.fijos.map(x => ({ ...x, nombre: x.nombre + ' (fijo)' })), 'Intentar quitar un fijo') +
            opcionesCheck('extras', p.extras, 'Extras', true)
        boton.disabled = false
    })

    boton.addEventListener('click', async () => {
        const valor = n => (caja.querySelector(`input[name="${n}"]:checked`) || {}).value
        const marcados = n => [...caja.querySelectorAll(`input[name="${n}"]:checked`)].map(x => x.value)
        const cuerpo = { producto_id: sel.value, tamano_id: valor('tamano'), estilo_id: valor('estilo'), quitar: marcados('quitar'), extras: marcados('extras') }
        const r = await fetch('/api/cotizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
        const d = await r.json()
        if (!r.ok) {
            salida.innerHTML = `<div class="alert alert-danger py-2 mb-0"><strong>Rechazado por el servidor (${r.status})</strong><br>${esc(d.error)}</div>`
            return
        }
        salida.innerHTML = `<div class="alert alert-success py-2 mb-0">
            <div class="fw-semibold mb-1">${esc(d.producto)} — ${dinero(d.precio)}</div>
            ${d.desglose.map(x => `<div class="d-flex justify-content-between"><span>${esc(x.concepto)}</span><span>${x.importe ? dinero(x.importe) : '$0.00'}</span></div>`).join('')}
            <div class="mt-1 text-body-secondary">${d.va_a_cocina ? 'Va a cocina' : 'Se entrega al momento'}${d.piezas ? ' · ' + d.piezas + ' piezas' : ''}</div></div>`
    })
})()
