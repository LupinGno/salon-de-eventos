// Renta de brincolines (Sprints 9 y 10): cobro, firma, aviso de espacio y confirmaciones.
// El servidor vuelve a validar todo.
(() => {
    const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    function prepararPago(caja) {
        const efectivo = caja.querySelector('.campo-efectivo'), referencia = caja.querySelector('.campo-referencia')
        const recibido = caja.querySelector('[name="recibido"]'), cambio = caja.querySelector('.texto-cambio')
        const medio = () => caja.querySelector('[name="medio"]:checked').value
        const actualizar = () => {
            const monto = Number(caja.dataset.monto), enEfectivo = medio() === 'efectivo'
            efectivo.classList.toggle('d-none', !enEfectivo)
            referencia.classList.toggle('d-none', enEfectivo)
            if (!enEfectivo) { cambio.textContent = ''; return }
            const r = Number(recibido.value)
            if (!recibido.value) cambio.textContent = `A cobrar: ${dinero(monto)}`
            else if (r + 0.001 < monto) cambio.innerHTML = `<span class="text-danger">Faltan ${dinero(monto - r)}</span>`
            else cambio.innerHTML = `Cambio: <strong>${dinero(r - monto)}</strong>`
        }
        caja.addEventListener('change', actualizar)
        recibido.addEventListener('input', actualizar)
        actualizar()
        return { medio, recibido, referencia: caja.querySelector('[name="referencia"]') }
    }
    const cajasPago = [...document.querySelectorAll('.campos-pago')].map(c => [c, prepararPago(c)])

    // Confirmar antes de acciones que mueven dinero o el estado de la renta
    document.querySelectorAll('form[data-preguntar]').forEach(f => f.addEventListener('submit', async e => {
        if (f.dataset.confirmado) return
        e.preventDefault()
        const r = await Swal.fire({ title: '¿Confirmas?', text: f.dataset.preguntar, icon: 'question', showCancelButton: true,
            confirmButtonText: 'Sí, continuar', cancelButtonText: 'Regresar', confirmButtonColor: '#1b9ad6' })
        if (r.isConfirmed) { f.dataset.confirmado = '1'; f.requestSubmit() }
    }))

    // Sprint 10: elegir un brincolín de reemplazo actualiza la diferencia que se devuelve o se cobra
    document.querySelectorAll('[data-diferencia]').forEach(sel => {
        const salida = document.getElementById(sel.dataset.diferencia)
        const actual = Number(sel.dataset.actual)
        const mostrar = () => {
            const op = sel.selectedOptions[0]
            if (!op || !op.dataset.total) { salida.textContent = ''; return }
            const d = Math.round((Number(op.dataset.total) - actual) * 100) / 100
            salida.textContent = d < 0 ? `Se devuelven ${dinero(-d)} por el mismo medio.` : d > 0 ? `Se cobran ${dinero(d)} de diferencia.` : 'Mismo precio: no hay diferencia.'
        }
        sel.addEventListener('change', mostrar)
        mostrar()
    })

    // ---------- Formulario de renta ----------
    const form = document.getElementById('form-renta')
    if (!form) return
    const datos = JSON.parse(document.getElementById('datos-renta').textContent)
    const pago = cajasPago[0][1]
    const valor = id => document.getElementById(id).value.trim()

    // US-56: avisa en cuanto el espacio no alcanza
    const avisoEspacio = document.getElementById('aviso-espacio')
    const revisarEspacio = () => {
        const l = Number(valor('espacio-largo')), a = Number(valor('espacio-ancho'))
        if (!l || !a) { avisoEspacio.innerHTML = ''; return true }
        const m = datos.minimo
        const cabe = (l >= m.largo && a >= m.ancho) || (l >= m.ancho && a >= m.largo)
        avisoEspacio.innerHTML = cabe
            ? '<div class="small text-success"><i class="bi bi-check-circle"></i> El espacio alcanza.</div>'
            : `<div class="small text-danger"><i class="bi bi-x-circle"></i> No alcanza: se necesitan ${m.largo} × ${m.ancho} m libres.</div>`
        return cabe
    }
    document.getElementById('espacio-largo').addEventListener('input', revisarEspacio)
    document.getElementById('espacio-ancho').addEventListener('input', revisarEspacio)

    // Firma con el dedo o el mouse
    const lienzo = document.getElementById('firma'), ctx = lienzo.getContext('2d')
    let trazos = 0, dibujando = false
    const escala = window.devicePixelRatio || 1
    lienzo.width = lienzo.clientWidth * escala; lienzo.height = 180 * escala
    ctx.scale(escala, escala)
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b3d91'
    const punto = e => { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    lienzo.addEventListener('pointerdown', e => { dibujando = true; lienzo.setPointerCapture(e.pointerId); const p = punto(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) })
    lienzo.addEventListener('pointermove', e => { if (!dibujando) return; const p = punto(e); ctx.lineTo(p.x, p.y); ctx.stroke() })
    const soltar = () => { if (dibujando) trazos++; dibujando = false }
    lienzo.addEventListener('pointerup', soltar)
    lienzo.addEventListener('pointercancel', soltar)
    document.getElementById('firma-borrar').addEventListener('click', () => { ctx.clearRect(0, 0, lienzo.width, lienzo.height); trazos = 0 })

    const cajaErrores = document.getElementById('errores-renta')
    function mostrarErrores(lista) {
        cajaErrores.innerHTML = '<div class="fw-semibold mb-1"><i class="bi bi-exclamation-triangle-fill"></i> Revisa lo siguiente:</div><ul class="mb-0 ps-3"></ul>'
        const ul = cajaErrores.querySelector('ul')
        lista.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li) })
        cajaErrores.classList.remove('d-none')
        cajaErrores.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    form.addEventListener('submit', async e => {
        e.preventDefault()
        const faltan = []
        if (valor('cli-nombre').length < 3) faltan.push('Escribe el nombre de quien renta y paga.')
        if (valor('direccion').length < 10) faltan.push('Escribe el domicilio completo.')
        if (!valor('espacio-largo') || !valor('espacio-ancho')) faltan.push('Escribe el largo y el ancho del espacio libre.')
        else if (!revisarEspacio()) faltan.push('El espacio no alcanza para este brincolín.')
        if (!document.getElementById('toma-corriente').checked) faltan.push('Sin toma de corriente cerca no se puede instalar.')
        if (!document.getElementById('terreno-habil').checked) faltan.push('El terreno debe ser plano y firme.')
        if (!document.getElementById('acepta').checked) faltan.push('El cliente debe aceptar los términos y condiciones.')
        if (!trazos) faltan.push('Falta la firma del cliente.')
        if (faltan.length) return mostrarErrores(faltan)
        cajaErrores.classList.add('d-none')

        const cuerpo = {
            brincolin_id: datos.brincolin_id, fecha: datos.fecha,
            cliente: { nombre: valor('cli-nombre'), telefono: valor('cli-telefono'), correo: valor('cli-correo') },
            direccion: valor('direccion'), referencias: valor('referencias'),
            espacio_largo: valor('espacio-largo'), espacio_ancho: valor('espacio-ancho'),
            toma_corriente: '1', terreno_habil: '1', acepta_terminos: '1', firma: lienzo.toDataURL('image/png'),
            pago: { medio: pago.medio(), recibido: pago.recibido.value, referencia: pago.referencia.value }
        }
        const boton = document.getElementById('btn-rentar')
        boton.disabled = true
        try {
            const r = await fetch('/brincolines/rentas', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(cuerpo) })
            const j = await r.json().catch(() => ({}))
            if (r.status === 401) return mostrarErrores(['Tu sesión terminó: vuelve a iniciar sesión.'])
            if (!r.ok) return mostrarErrores(j.errores || [j.error || 'No se pudo guardar la renta.'])
            await Swal.fire({ icon: 'success', title: `Renta ${j.folio}`,
                html: `Se cobraron <strong>${dinero(j.cobrado)}</strong>` + (j.cambio > 0 ? `<br>Cambio: <strong>${dinero(j.cambio)}</strong>` : '') + '<br>El contrato firmado quedó guardado.',
                confirmButtonColor: '#1b9ad6' })
            location.href = j.url
        } catch {
            mostrarErrores(['No hay conexión con el servidor.'])
        } finally {
            boton.disabled = false
        }
    })
})()
