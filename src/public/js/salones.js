// Renta de salones
(() => {
    const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const redondear = n => Math.round(n * 100) / 100

    // Campos de pago
    function prepararPago(caja) {
        const efectivo = caja.querySelector('.campo-efectivo')
        const referencia = caja.querySelector('.campo-referencia')
        const recibido = caja.querySelector('[name="recibido"]')
        const cambio = caja.querySelector('.texto-cambio')
        const medio = () => caja.querySelector('[name="medio"]:checked').value
        const actualizar = () => {
            const monto = Number(caja.dataset.monto)
            const enEfectivo = medio() === 'efectivo'
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
        caja.actualizar = actualizar
        actualizar()
        return { medio, recibido, referencia: caja.querySelector('[name="referencia"]') }
    }
    document.querySelectorAll('.campos-pago').forEach(prepararPago)

    //Detalle
    document.querySelectorAll('form[data-preguntar]').forEach(f => f.addEventListener('submit', async e => {
        if (f.dataset.confirmado) return
        e.preventDefault()
        const r = await Swal.fire({ title: '¿Confirmas?', text: f.dataset.preguntar, icon: 'question', showCancelButton: true,
            confirmButtonText: 'Sí, continuar', cancelButtonText: 'Regresar', confirmButtonColor: '#1b9ad6' })
        if (r.isConfirmed) { f.dataset.confirmado = '1'; f.requestSubmit() }
    }))

    // Recibir el salón
    const recibir = document.getElementById('form-recibir')
    if (recibir) {
        const explicar = () => {
            const v = (recibir.querySelector('[name="resultado"]:checked') || {}).value
            recibir.querySelector('.campo-costo').classList.toggle('d-none', v !== 'danos')
            recibir.querySelector('.campo-descripcion').classList.toggle('d-none', !v || v === 'limpio')
            const costo = Number(recibir.querySelector('[name="costo"]').value) || 0
            const cuota = Number(recibir.dataset.cuota)
            const textos = {
                limpio: `Se devuelven ${dinero(cuota)} a ${recibir.dataset.paga} en ${recibir.dataset.medio}.`,
                sucio: `La cuota de ${dinero(cuota)} no se devuelve.`,
                danos: `La cuota de ${dinero(cuota)} no se devuelve` + (costo > cuota ? ` y el responsable paga ${dinero(costo - cuota)} más.` : '.')
            }
            recibir.querySelector('.que-pasa').textContent = textos[v] || ''
            recibir.dataset.preguntar = textos[v] || ''
        }
        recibir.addEventListener('change', explicar)
        recibir.addEventListener('input', explicar)
        explicar()
    }

    //Formulario de reserva
    const form = document.getElementById('form-reserva')
    if (!form) return
    const datos = JSON.parse(document.getElementById('datos-reserva').textContent)
    const pago = prepararPago(form.querySelector('.campos-pago'))
    const cajaPago = form.querySelector('.campos-pago')
    const lineas = []

    //no más brincolines de los que incluye el salón
    const casillas = [...form.querySelectorAll('.casilla-brincolin')]
    const limitar = () => {
        const marcados = casillas.filter(c => c.checked).length
        casillas.forEach(c => { c.disabled = !c.checked && marcados >= datos.max_brincolines })
    }
    casillas.forEach(c => c.addEventListener('change', limitar))

    //el cobro cambia con los alimentos
    function recalcular() {
        const alimentos = redondear(lineas.reduce((t, l) => t + l.precio * l.cantidad, 0))
        const precio = redondear(datos.renta + alimentos)
        const pagoRenta = datos.pago_total ? precio : redondear(precio / 2)
        const hoy = redondear(pagoRenta + datos.cuota)
        const poner = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = dinero(v) }
        poner('r-alimentos', alimentos); poner('r-precio', precio); poner('r-pago-renta', pagoRenta)
        poner('r-hoy', hoy); poner('r-saldo', precio - pagoRenta)
        cajaPago.dataset.monto = hoy
        cajaPago.actualizar()
    }

    // armar los alimentos
    if (datos.con_alimentos) {
        const selProducto = document.getElementById('al-producto')
        const selTamano = document.getElementById('al-tamano'), selEstilo = document.getElementById('al-estilo')
        const llenar = () => {
            const p = datos.menu.find(m => m.id === Number(selProducto.value))
            selTamano.innerHTML = p.tamanos.map(t => `<option value="${t.id}">${t.nombre} · ${dinero(t.precio)}</option>`).join('')
            selEstilo.innerHTML = p.estilos.map(e => `<option value="${e.id}">${e.nombre}${e.precio_extra > 0 ? ' +' + dinero(e.precio_extra) : ''}</option>`).join('')
            document.getElementById('al-col-tamano').classList.toggle('invisible', !p.tamanos.length)
            document.getElementById('al-col-estilo').classList.toggle('invisible', !p.estilos.length)
        }
        selProducto.addEventListener('change', llenar)
        llenar()
        const cuerpo = document.getElementById('lineas-alimentos')
        const pintar = () => {
            cuerpo.innerHTML = lineas.length ? '' : '<tr><td colspan="5" class="text-body-secondary">Agrega al menos un platillo.</td></tr>'
            lineas.forEach((l, i) => {
                const tr = document.createElement('tr')
                tr.innerHTML = `<td></td><td class="text-end">${l.cantidad}</td><td class="text-end">${dinero(l.precio)}</td>
                    <td class="text-end">${dinero(l.precio * l.cantidad)}</td>
                    <td class="text-end"><button type="button" class="btn btn-sm btn-link text-danger" aria-label="Quitar"><i class="bi bi-x-lg"></i></button></td>`
                tr.firstChild.textContent = l.descripcion
                tr.querySelector('button').addEventListener('click', () => { lineas.splice(i, 1); pintar() })
                cuerpo.appendChild(tr)
            })
            recalcular()
        }
        document.getElementById('al-agregar').addEventListener('click', () => {
            const p = datos.menu.find(m => m.id === Number(selProducto.value))
            const t = p.tamanos.find(x => x.id === Number(selTamano.value))
            const e = p.estilos.find(x => x.id === Number(selEstilo.value))
            const cantidad = Number(document.getElementById('al-cantidad').value)
            if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 500) return Swal.fire({ icon: 'warning', text: 'La cantidad va de 1 a 500.' })
            const precio = (t ? t.precio : p.precio_base) + (e ? e.precio_extra : 0)
            const descripcion = [p.nombre + (t ? ' ' + t.nombre : ''), e && e.nombre, !t && !e && 'con todo'].filter(Boolean).join(' · ')
            const igual = lineas.find(l => l.producto_id === p.id && l.tamano_id === (t ? t.id : null) && l.estilo_id === (e ? e.id : null))
            if (igual) igual.cantidad = Math.min(500, igual.cantidad + cantidad)
            else lineas.push({ producto_id: p.id, tamano_id: t ? t.id : null, estilo_id: e ? e.id : null, cantidad, precio, descripcion })
            document.getElementById('al-cantidad').value = 1
            pintar()
        })
    }

    // Responsable
    const mismo = document.getElementById('resp-mismo')
    mismo.addEventListener('change', () => form.querySelectorAll('.solo-otro').forEach(el => el.classList.toggle('d-none', mismo.checked)))

    //firma dibujada con el dedo o el mouse 
    const lienzo = document.getElementById('firma')
    const ctx = lienzo.getContext('2d')
    let trazos = 0, dibujando = false
    function ajustar() {
        const escala = window.devicePixelRatio || 1
        const ancho = lienzo.clientWidth
        lienzo.width = ancho * escala; lienzo.height = 180 * escala
        ctx.scale(escala, escala)
        ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b3d91'
        trazos = 0
    }
    ajustar()
    const punto = e => { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    lienzo.addEventListener('pointerdown', e => {
        dibujando = true; lienzo.setPointerCapture(e.pointerId)
        const p = punto(e); ctx.beginPath(); ctx.moveTo(p.x, p.y)
    })
    lienzo.addEventListener('pointermove', e => {
        if (!dibujando) return
        const p = punto(e); ctx.lineTo(p.x, p.y); ctx.stroke()
    })
    const soltar = () => { if (dibujando) trazos++; dibujando = false }
    lienzo.addEventListener('pointerup', soltar)
    lienzo.addEventListener('pointercancel', soltar)
    document.getElementById('firma-borrar').addEventListener('click', () => { ctx.clearRect(0, 0, lienzo.width, lienzo.height); trazos = 0 })

    // Enviar
    const valor = id => document.getElementById(id).value.trim()
    const cajaErrores = document.getElementById('errores-reserva')
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
        if (datos.con_alimentos && !lineas.length) faltan.push('Agrega al menos un platillo del menú de eventos.')
        if (valor('cli-nombre').length < 3) faltan.push('Escribe el nombre de quien renta y paga.')
        if (!mismo.checked && valor('resp-nombre').length < 3) faltan.push('Escribe el nombre del responsable.')
        if (valor('resp-ine').replace(/\s/g, '').length !== 18) faltan.push('La clave de elector del INE tiene 18 caracteres.')
        if (!valor('resp-nacimiento')) faltan.push('Escribe la fecha de nacimiento del responsable.')
        if (!document.getElementById('acepta').checked) faltan.push('El responsable debe aceptar los términos y condiciones.')
        if (!trazos) faltan.push('Falta la firma del responsable.')
        if (faltan.length) return mostrarErrores(faltan)
        cajaErrores.classList.add('d-none')

        const cuerpo = {
            salon_id: datos.salon_id, fecha: datos.fecha, personas: datos.personas, con_alimentos: datos.con_alimentos ? '1' : '0',
            fiesta_menores: document.getElementById('fiesta_menores').checked ? '1' : '0',
            brincolines: casillas.filter(c => c.checked).map(c => Number(c.value)),
            alimentos: lineas.map(({ producto_id, tamano_id, estilo_id, cantidad }) => ({ producto_id, tamano_id, estilo_id, cantidad })),
            cliente: { nombre: valor('cli-nombre'), telefono: valor('cli-telefono'), correo: valor('cli-correo') },
            responsable: { es_cliente: mismo.checked ? '1' : '0', nombre: valor('resp-nombre'), celular: valor('resp-celular'),
                ine: valor('resp-ine'), fecha_nacimiento: valor('resp-nacimiento'), direccion: valor('resp-direccion') },
            acepta_terminos: '1', firma: lienzo.toDataURL('image/png'),
            pago: { medio: pago.medio(), recibido: pago.recibido.value, referencia: pago.referencia.value }
        }
        const boton = document.getElementById('btn-reservar')
        boton.disabled = true
        try {
            const r = await fetch('/salones/reservas', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(cuerpo) })
            const j = await r.json().catch(() => ({}))
            if (r.status === 401) return mostrarErrores(['Tu sesión terminó: vuelve a iniciar sesión.'])
            if (!r.ok) return mostrarErrores(j.errores || [j.error || 'No se pudo guardar la reserva.'])
            await Swal.fire({ icon: 'success', title: `Reserva ${j.folio}`,
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
