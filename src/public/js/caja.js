// Punto de venta 
(() => {
    'use strict'
    const datos = JSON.parse(document.getElementById('datos-caja').textContent)
    const productos = new Map(datos.productos.map(p => [p.id, p]))
    const cuentas = datos.cuentas

    const $ = id => document.getElementById(id)
    const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

    // Filtro del menú 
    let categoria = '', texto = ''
    const filtrar = () => document.querySelectorAll('[data-producto-tarjeta]').forEach(t => {
        const ok = (!categoria || t.dataset.categoria === categoria) && (!texto || t.dataset.nombre.includes(texto))
        t.classList.toggle('d-none', !ok)
    })
    $('filtro-categorias').addEventListener('click', e => {
        const b = e.target.closest('[data-categoria]')
        if (!b) return
        categoria = b.dataset.categoria
        $('filtro-categorias').querySelectorAll('.nav-link').forEach(x => x.classList.toggle('active', x === b))
        filtrar()
    })
    $('buscar-producto').addEventListener('input', e => { texto = e.target.value.trim().toLowerCase(); filtrar() })

    // Precio de una unidad 
    function precioUnidad(p, u) {
        const tam = p.tamanos.find(t => t.id === u.tamano_id)
        const estilo = p.estilos.find(e => e.id === u.estilo_id)
        let precio = tam ? tam.precio : p.precio_base
        if (estilo) precio += estilo.precio_extra
        p.extras.forEach(x => { if (u.extras.has(x.id)) precio += x.precio })
        return Math.round(precio * 100) / 100
    }
    function descripcion(p, u) {
        const tam = p.tamanos.find(t => t.id === u.tamano_id)
        const estilo = p.estilos.find(e => e.id === u.estilo_id)
        return [p.nombre + (tam ? ` ${tam.nombre}` : ''), estilo && estilo.nombre].filter(Boolean).join(' · ')
    }
    // El platillo viene con todo por defecto 
    const unidadNueva = p => ({
        cantidad: 1,
        tamano_id: p.tamanos.length ? p.tamanos[0].id : null,
        estilo_id: p.estilos.length ? p.estilos[0].id : null,
        quitar: new Set(), extras: new Set()
    })

    const modalProducto = new bootstrap.Modal($('modal-producto'))
    let actual = null        
    let unidades = []          

    document.addEventListener('click', e => {
        const b = e.target.closest('[data-abrir-producto]')
        if (!b) return
        actual = productos.get(Number(b.dataset.abrirProducto))
        unidades = [unidadNueva(actual)]
        $('modal-producto-titulo').textContent = actual.nombre
        const info = [actual.descripcion, actual.piezas ? `${actual.piezas} piezas por orden` : '',
            actual.va_a_cocina ? 'Se prepara en cocina' : 'Se entrega al momento'].filter(Boolean)
        $('modal-producto-info').textContent = info.join(' · ')
        const img = $('modal-producto-imagen')
        img.classList.toggle('d-none', !actual.imagen)
        if (actual.imagen) img.src = actual.imagen
        $('otra-unidad').querySelector('span').textContent = `Agregar otra ${actual.nombre.toLowerCase()} con cambios distintos`
        dibujarUnidades()
        modalProducto.show()
    })

    function dibujarUnidades() {
        const p = actual
        $('unidades').innerHTML = unidades.map((u, i) => {
            const opciones = (lista, elegido, nombre, etiqueta) => lista.length ? `
              <div class="mb-2"><div class="small fw-semibold mb-1">${etiqueta}</div>
                <div class="d-flex flex-wrap gap-1">${lista.map(o => `
                  <input type="radio" class="btn-check" name="${nombre}-${i}" id="${nombre}-${i}-${o.id}" value="${o.id}" data-u="${i}" data-campo="${nombre}" ${o.id === elegido ? 'checked' : ''}>
                  <label class="btn btn-sm btn-outline-primary" for="${nombre}-${i}-${o.id}">${esc(o.nombre)}${o.extra ? ` <small>${o.extra}</small>` : ''}</label>`).join('')}
                </div></div>` : ''
            const tamanos = opciones(p.tamanos.map(t => ({ id: t.id, nombre: t.nombre, extra: dinero(t.precio) })), u.tamano_id, 'tamano', 'Tamaño')
            const estilos = opciones(p.estilos.map(e => ({ id: e.id, nombre: e.nombre, extra: e.precio_extra > 0 ? '+' + dinero(e.precio_extra) : '' })), u.estilo_id,
                'estilo', p.categoria === 'Bebidas' ? 'Sabor' : 'Estilo')

            const fijos = p.fijos.map(ing => `<span class="badge chip-fijo" title="Ingrediente básico: no se puede quitar"><i class="bi bi-lock-fill"></i> ${esc(ing.nombre)}</span>`).join(' ')
            const moviles = p.permite_quitar
                ? p.moviles.map(ing => `
                    <input type="checkbox" class="btn-check" id="mov-${i}-${ing.id}" data-u="${i}" data-quitar="${ing.id}" ${u.quitar.has(ing.id) ? '' : 'checked'}>
                    <label class="btn btn-sm chip-toggle" for="mov-${i}-${ing.id}" title="Toca para quitarlo (no cambia el precio)">${esc(ing.nombre)}</label>`).join('')
                : p.moviles.map(ing => `<span class="badge chip-movil">${esc(ing.nombre)}</span>`).join(' ')
            const extras = p.extras.map(x => `
                <input type="checkbox" class="btn-check" id="ext-${i}-${x.id}" data-u="${i}" data-extra="${x.id}" ${u.extras.has(x.id) ? 'checked' : ''}>
                <label class="btn btn-sm chip-toggle-extra" for="ext-${i}-${x.id}">+ ${esc(x.nombre)} <small>${dinero(x.precio)}</small></label>`).join('')

            return `
            <div class="unidad-pos mb-3">
              <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <span class="fw-semibold">${unidades.length > 1 ? `${esc(p.nombre)} ${i + 1}` : esc(p.nombre)}</span>
                <span class="ms-auto d-flex align-items-center gap-1">
                  <label class="small text-body-secondary" for="cant-${i}">Cantidad iguales</label>
                  <input id="cant-${i}" type="number" min="1" max="50" value="${u.cantidad}" data-u="${i}" data-cantidad class="form-control form-control-sm" style="width:70px">
                  ${unidades.length > 1 ? `<button type="button" class="btn btn-sm btn-outline-danger" data-quitar-unidad="${i}" aria-label="Quitar esta"><i class="bi bi-x-lg"></i></button>` : ''}
                </span>
              </div>
              ${tamanos}${estilos}
              ${(p.fijos.length || p.moviles.length) ? `<div class="mb-2"><div class="small fw-semibold mb-1">Ingredientes ${p.permite_quitar && p.moviles.length ? '<span class="fw-normal text-body-secondary">(toca para quitar)</span>' : p.permite_quitar ? '' : `<span class="fw-normal text-body-secondary">(en ${esc(p.categoria)} no se quitan ingredientes)</span>`}</div>
                <div class="d-flex flex-wrap gap-1 align-items-center">${fijos} ${moviles}</div></div>` : ''}
              ${extras ? `<div class="mb-1"><div class="small fw-semibold mb-1">Extras <span class="fw-normal text-body-secondary">(se cobran)</span></div><div class="d-flex flex-wrap gap-1">${extras}</div></div>` : ''}
              <div class="text-end small">Precio c/u <strong>${dinero(precioUnidad(p, u))}</strong>${u.cantidad > 1 ? ` · ${u.cantidad} × = <strong>${dinero(precioUnidad(p, u) * u.cantidad)}</strong>` : ''}</div>
            </div>`
        }).join('')
        $('total-modal').textContent = dinero(unidades.reduce((s, u) => s + precioUnidad(actual, u) * u.cantidad, 0))
    }

    $('unidades').addEventListener('change', e => {
        const t = e.target, u = unidades[Number(t.dataset.u)]
        if (!u) return
        if (t.dataset.campo === 'tamano') u.tamano_id = Number(t.value)
        if (t.dataset.campo === 'estilo') u.estilo_id = Number(t.value)
        if (t.dataset.quitar) { const id = Number(t.dataset.quitar); t.checked ? u.quitar.delete(id) : u.quitar.add(id) }
        if (t.dataset.extra) { const id = Number(t.dataset.extra); t.checked ? u.extras.add(id) : u.extras.delete(id) }
        if ('cantidad' in t.dataset) u.cantidad = Math.min(50, Math.max(1, parseInt(t.value, 10) || 1))
        dibujarUnidades()
    })
    $('unidades').addEventListener('click', e => {
        const b = e.target.closest('[data-quitar-unidad]')
        if (!b) return
        unidades.splice(Number(b.dataset.quitarUnidad), 1)
        dibujarUnidades()
    })
    $('otra-unidad').addEventListener('click', () => {
        unidades.push(unidadNueva(actual))
        dibujarUnidades()
        $('unidades').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })

    //Pedido
    let pedido = []
    let siguiente = 1

    $('agregar-al-pedido').addEventListener('click', () => {
        const p = actual
        unidades.forEach(u => {
            const cambios = [
                ...p.moviles.filter(i => u.quitar.has(i.id)).map(i => ({ texto: `Sin ${i.nombre}`, importe: 0 })),
                ...p.extras.filter(x => u.extras.has(x.id)).map(x => ({ texto: `+ ${x.nombre}`, importe: x.precio }))
            ]
            pedido.push({
                uid: siguiente++, producto_id: p.id, estilo_id: u.estilo_id, tamano_id: u.tamano_id,
                quitar: [...u.quitar], extras: [...u.extras], cantidad: u.cantidad,
                descripcion: descripcion(p, u), precio: precioUnidad(p, u), cambios,
                piezas: p.piezas, va_a_cocina: p.va_a_cocina
            })
        })
        modalProducto.hide()
        dibujarPedido()
    })

    function totalPedido() { return Math.round(pedido.reduce((s, l) => s + l.precio * l.cantidad, 0) * 100) / 100 }

    function dibujarPedido() {
        const lista = $('lineas-pedido')
        lista.querySelectorAll('[data-linea]').forEach(li => li.remove())
        $('pedido-vacio').classList.toggle('d-none', pedido.length > 0)
        pedido.forEach(l => {
            const li = document.createElement('li')
            li.className = 'list-group-item bg-transparent px-0'
            li.dataset.linea = l.uid
            li.innerHTML = `
              <div class="d-flex gap-2">
                <div class="flex-grow-1">
                  <div class="fw-semibold">${l.cantidad} × ${esc(l.descripcion)}</div>
                  ${l.piezas ? `<div class="small text-body-secondary">${l.piezas} piezas por orden</div>` : ''}
                  ${l.cambios.map(c => `<div class="small ${c.importe ? 'text-success-emphasis' : 'text-danger-emphasis'}">${esc(c.texto)}${c.importe ? ' ' + dinero(c.importe) : ''}</div>`).join('')}
                  <div class="small">${l.va_a_cocina
                    ? '<span class="badge text-bg-warning-subtle text-warning-emphasis"><i class="bi bi-fire"></i> A cocina</span>'
                    : '<span class="badge text-bg-success-subtle text-success-emphasis"><i class="bi bi-lightning-fill"></i> Se entrega al momento</span>'}</div>
                </div>
                <div class="text-end">
                  <div class="fw-semibold">${dinero(l.precio * l.cantidad)}</div>
                  <button type="button" class="btn btn-sm btn-link text-danger p-0" data-borrar-linea="${l.uid}" aria-label="Quitar del pedido"><i class="bi bi-x-circle"></i></button>
                </div>
              </div>`
            lista.appendChild(li)
        })
        const total = totalPedido()
        $('total-pedido').textContent = dinero(total)
        const unidadesTotales = pedido.reduce((s, l) => s + l.cantidad, 0)
        const aCocina = pedido.filter(l => l.va_a_cocina).reduce((s, l) => s + l.cantidad, 0)
        $('resumen-cocina').textContent = pedido.length
            ? `${unidadesTotales} artículo(s): ${aCocina} a cocina, ${unidadesTotales - aCocina} se entregan al momento.` : ''
        $('cobrar').disabled = !pedido.length
        $('vaciar-pedido').disabled = !pedido.length
    }

    $('lineas-pedido').addEventListener('click', e => {
        const b = e.target.closest('[data-borrar-linea]')
        if (!b) return
        pedido = pedido.filter(l => l.uid !== Number(b.dataset.borrarLinea))
        dibujarPedido()
    })
    $('vaciar-pedido').addEventListener('click', () => { pedido = []; dibujarPedido() })

    //Mesa o para llevar
    const paraLlevar = () => $('destino-llevar').checked
    function revisarDestino() {
        $('campo-mesa').classList.toggle('d-none', paraLlevar())
        const aviso = $('aviso-cuenta')
        const cuenta = !paraLlevar() && cuentas.find(c => c.mesa_id === Number($('mesa').value))
        aviso.classList.toggle('d-none', !cuenta)
        if (cuenta) {
            aviso.innerHTML = `<i class="bi bi-info-circle"></i> La <strong>mesa ${esc(cuenta.mesa)}</strong> tiene cuenta abierta de <strong>${esc(cuenta.cliente_nombre)}</strong>
                (${cuenta.comandas} comanda(s), ${dinero(cuenta.total)}). Este pedido se sumará a esa cuenta.`
            if (!$('cliente').value.trim()) $('cliente').value = cuenta.cliente_nombre
        }
    }
    document.querySelectorAll('input[name="destino"]').forEach(r => r.addEventListener('change', revisarDestino))
    $('mesa').addEventListener('change', revisarDestino)

    //Cobro 
    const modalCobro = new bootstrap.Modal($('modal-cobro'))
    const medio = () => document.querySelector('input[name="medio"]:checked').value

    function alerta(texto) { Swal.fire({ icon: 'warning', title: 'Falta algo', text: texto, confirmButtonColor: '#1b9ad6' }) }

    $('cobrar').addEventListener('click', () => {
        if (!pedido.length) return alerta('El pedido está vacío.')
        if (!paraLlevar() && !$('mesa').value) return alerta('Elige la mesa o marca "Para llevar".')
        if ($('cliente').value.trim().length < 2) { $('cliente').focus(); return alerta('Escribe el nombre del cliente.') }
        const total = totalPedido()
        const mesaTexto = paraLlevar() ? 'Para llevar' : $('mesa').selectedOptions[0].textContent.split(' · ')[0]
        $('cobro-destino').textContent = `${mesaTexto} · ${$('cliente').value.trim()}`
        $('cobro-total').textContent = dinero(total)
        $('recibido').value = ''
        $('referencia').value = ''
        $('error-cobro').classList.add('d-none')
        // Billetes sugeridos
        const sugeridos = [...new Set([total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, 100, 200, 500, 1000]
            .filter(v => v >= total))].sort((a, b) => a - b).slice(0, 5)
        $('billetes').innerHTML = sugeridos.map(v => `<button type="button" class="btn btn-sm btn-outline-secondary" data-billete="${v}">${v === total ? 'Exacto' : dinero(v)}</button>`).join('')
        actualizarCambio()
        revisarMedio()
        modalCobro.show()
    })
    $('modal-cobro').addEventListener('shown.bs.modal', () => { if (medio() === 'efectivo') $('recibido').focus() })
    $('billetes').addEventListener('click', e => {
        const b = e.target.closest('[data-billete]')
        if (!b) return
        $('recibido').value = b.dataset.billete
        actualizarCambio()
    })
    function actualizarCambio() {
        const recibido = Number($('recibido').value)
        const cambio = recibido - totalPedido()
        $('cambio').textContent = recibido ? (cambio >= 0 ? dinero(cambio) : `Faltan ${dinero(-cambio)}`) : '$0.00'
        $('cambio').classList.toggle('text-danger', recibido > 0 && cambio < 0)
    }
    $('recibido').addEventListener('input', actualizarCambio)
    function revisarMedio() {
        $('campos-efectivo').classList.toggle('d-none', medio() !== 'efectivo')
        $('campos-referencia').classList.toggle('d-none', medio() === 'efectivo')
    }
    document.querySelectorAll('input[name="medio"]').forEach(r => r.addEventListener('change', revisarMedio))

    $('confirmar-cobro').addEventListener('click', async () => {
        const boton = $('confirmar-cobro')
        const error = $('error-cobro')
        error.classList.add('d-none')
        if (medio() === 'efectivo' && Number($('recibido').value) < totalPedido()) {
            error.textContent = 'El efectivo recibido no alcanza para el total.'
            return error.classList.remove('d-none')
        }
        const cuerpo = {
            para_llevar: paraLlevar(),
            mesa_id: paraLlevar() ? null : Number($('mesa').value),
            cliente: $('cliente').value.trim(),
            articulos: pedido.map(l => ({
                producto_id: l.producto_id, estilo_id: l.estilo_id, tamano_id: l.tamano_id,
                quitar: l.quitar, extras: l.extras, cantidad: l.cantidad
            })),
            pago: { medio: medio(), recibido: Number($('recibido').value) || null, referencia: $('referencia').value.trim() }
        }
        boton.disabled = true
        try {
            const r = await fetch('/caja/comandas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(cuerpo)
            })
            const respuesta = await r.json().catch(() => ({ error: 'Tu sesión terminó. Vuelve a iniciar sesión.' }))
            if (!r.ok) {
                error.textContent = respuesta.error || 'No se pudo registrar la comanda.'
                error.classList.remove('d-none')
                return
            }
            modalCobro.hide()
            const resultado = await Swal.fire({
                icon: 'success',
                title: `Comanda ${respuesta.folio} registrada`,
                html: `${respuesta.cambio > 0 ? `<div class="fs-3 fw-bold">Cambio: ${dinero(respuesta.cambio)}</div>` : ''}
                       <div>${respuesta.a_cocina} artículo(s) a cocina · ${respuesta.unidades - respuesta.a_cocina} entregado(s) al momento</div>
                       ${respuesta.cuenta_nueva ? '' : '<div class="small mt-2">Se sumó a la cuenta abierta de la mesa.</div>'}`,
                showCancelButton: true,
                confirmButtonText: '<i class="bi bi-printer"></i> Ver ticket',
                cancelButtonText: 'Nuevo pedido',
                confirmButtonColor: '#1b9ad6'
            })
            if (resultado.isConfirmed) window.open(`/caja/tickets/${respuesta.ticket_id}`, '_blank')
            location.reload()   // nuevo pedido con las mesas y cuentas al día
        } catch (e) {
            error.textContent = 'No hay conexión con el servidor.'
            error.classList.remove('d-none')
        } finally {
            boton.disabled = false
        }
    })

    revisarDestino()
    dibujarPedido()
})()
