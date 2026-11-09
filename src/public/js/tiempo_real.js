// tiempo real
(() => {
    'use strict'
    if (typeof io !== 'function') return
    const socket = io({ reconnectionDelayMax: 5000 })
    window.tiempoReal = { conectado: false }

    function pintarEstado(conectado) {
        window.tiempoReal.conectado = conectado
        document.querySelectorAll('[data-estado-conexion]').forEach(el => {
            el.classList.toggle('en-vivo', conectado)
            el.classList.toggle('sin-conexion', !conectado)
            el.innerHTML = conectado
                ? '<i class="bi bi-circle-fill"></i> En vivo'
                : '<i class="bi bi-circle-fill"></i> Sin conexión: se actualiza cada 8 s'
        })
    }
    const avisarPagina = (tipo, datos) => window.dispatchEvent(new CustomEvent('tiempo-real', { detail: { tipo, datos } }))

    socket.on('connect', () => { pintarEstado(true); avisarPagina('conectado') })
    socket.on('disconnect', () => pintarEstado(false))
    socket.on('connect_error', () => pintarEstado(false))

    let audio
    function campana(veces = 2) {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)()
            for (let i = 0; i < veces; i++) {
                const o = audio.createOscillator(), g = audio.createGain()
                o.frequency.value = 880
                g.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.25)
                g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + i * 0.25 + 0.02)
                g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.25 + 0.2)
                o.connect(g).connect(audio.destination)
                o.start(audio.currentTime + i * 0.25)
                o.stop(audio.currentTime + i * 0.25 + 0.22)
            }
        } catch (e) { }
    }

    const pila = document.createElement('div')
    pila.className = 'pila-avisos'
    pila.setAttribute('aria-live', 'assertive')
    pila.setAttribute('role', 'region')
    pila.setAttribute('aria-label', 'Avisos de cocina')
    document.body.appendChild(pila)
    const mostrados = new Set()

    function contador() {
        const el = document.getElementById('contador-avisos')
        if (!el) return
        const n = pila.querySelectorAll('.aviso-recepcion').length
        el.textContent = n
        el.classList.toggle('d-none', n === 0)
    }

    const escapar = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

    function mostrarAviso(a, sonar) {
        if (mostrados.has(a.id)) return
        mostrados.add(a.id)
        const hora = String(a.creado_en || '').slice(11, 16)
        const tarjeta = document.createElement('div')
        tarjeta.className = 'card shadow aviso-recepcion'
        tarjeta.dataset.id = a.id
        tarjeta.innerHTML = `
          <div class="card-body p-3">
            <div class="d-flex align-items-center gap-2 mb-1">
              <i class="bi bi-bell-fill text-warning fs-5"></i>
              <strong class="fs-5">Comanda #${escapar(a.folio)}</strong>
              <span class="badge ${a.destino === 'PARA LLEVAR' ? 'text-bg-primary' : 'text-bg-light border'}">${escapar(a.destino)}</span>
              <span class="ms-auto small text-body-secondary">${escapar(hora)}</span>
            </div>
            <div class="small mb-2">Listo: ${escapar(a.contenido)}</div>
            ${a.parcial ? '<div class="small text-warning-emphasis mb-2"><i class="bi bi-hourglass-split"></i> Entrega parcial: aún hay cosas en cocina</div>' : ''}
            <div class="d-flex gap-2">
              <a class="btn btn-sm btn-marca" href="/caja/entregas"><i class="bi bi-box-arrow-up-right"></i> Ver para entregar</a>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-visto><i class="bi bi-check2"></i> Enterado</button>
            </div>
          </div>`
        tarjeta.querySelector('[data-visto]').addEventListener('click', async () => {
            await fetch(`/caja/avisos/${a.id}/visto`, { method: 'POST', headers: { Accept: 'application/json' } }).catch(() => {})
            quitarAviso(a.id)
        })
        pila.appendChild(tarjeta)
        contador()
        if (sonar) campana()
    }
    function quitarAviso(id) {
        const t = pila.querySelector(`.aviso-recepcion[data-id="${id}"]`)
        if (t) t.remove()
        contador()
    }

    socket.on('listo', async ({ salas }) => {
        if (!salas.includes('recepcion')) return
        try {
            const r = await fetch('/caja/avisos', { headers: { Accept: 'application/json' } })
            if (r.ok) (await r.json()).avisos.forEach(a => mostrarAviso(a, false))
        } catch (e) {  }
    })
    socket.on('recepcion:aviso', a => { mostrarAviso(a, true); avisarPagina('recepcion:aviso', a) })
    socket.on('recepcion:visto', ({ id }) => quitarAviso(id))
    socket.on('recepcion:cambio', d => avisarPagina('recepcion:cambio', d))

    //Cocina 
    socket.on('cocina:nueva', d => {
        avisarPagina('cocina:nueva', d)
        if (document.querySelector('[data-autorefresh^="/cocina"]')) {
            campana(1)
            if (window.Swal) Swal.fire({ toast: true, position: 'top-end', timer: 4000, showConfirmButton: false, icon: 'info',
                                         title: `Nueva comanda #${d.folio}`, text: `${d.articulos} artículo(s) a cocina` })
        }
    })
    socket.on('cocina:cambio', d => avisarPagina('cocina:cambio', d))
})()
