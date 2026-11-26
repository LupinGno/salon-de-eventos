// Cajas y finanzas
(() => {
    'use strict'
    const zonas = () => [...document.querySelectorAll('[data-en-vivo][id]')]
    let espera = null, trabajando = false

    async function refrescar() {
        if (trabajando || !zonas().length) return
        trabajando = true
        try {
            const r = await fetch(location.href, { headers: { Accept: 'text/html' } })
            if (!r.ok) return
            const nuevo = new DOMParser().parseFromString(await r.text(), 'text/html')
            zonas().forEach(z => {
                const n = nuevo.getElementById(z.id)
                if (n && n.innerHTML !== z.innerHTML) {
                    z.innerHTML = n.innerHTML
                    z.classList.remove('destello'); void z.offsetWidth; z.classList.add('destello')
                }
            })
        } catch (e) { } finally { trabajando = false }
    }
    const pronto = () => { clearTimeout(espera); espera = setTimeout(refrescar, 300) }
    window.addEventListener('tiempo-real', e => { if (e.detail.tipo === 'cajas:cambio' || e.detail.tipo === 'conectado') pronto() })
    setInterval(() => { if (!(window.tiempoReal && window.tiempoReal.conectado)) refrescar() }, 8000)

    // Confirmar antes de cerrar el turno o resolver una salida
    document.querySelectorAll('form[data-preguntar]').forEach(f => f.addEventListener('submit', async e => {
        if (f.dataset.confirmado || !window.Swal) return
        e.preventDefault()
        const r = await Swal.fire({ title: '¿Confirmas?', text: f.dataset.preguntar, icon: 'question', showCancelButton: true,
            confirmButtonText: 'Sí, continuar', cancelButtonText: 'Regresar', confirmButtonColor: '#1b9ad6' })
        if (r.isConfirmed) { f.dataset.confirmado = '1'; f.requestSubmit() }
    }))

    // Formularios de conteo
    document.querySelectorAll('[data-esperado]').forEach(form => {
        const esperado = Number(form.dataset.esperado)
        const campo = form.querySelector('[name=contado]'), aviso = form.querySelector('.texto-diferencia')
        if (!campo || !aviso) return
        const dinero = n => '$' + Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        campo.addEventListener('input', () => {
            if (campo.value === '') { aviso.textContent = ''; return }
            const d = Math.round((Number(campo.value) - esperado) * 100) / 100
            aviso.className = 'small mt-1 texto-diferencia ' + (d === 0 ? 'text-success' : 'text-danger')
            aviso.textContent = d === 0 ? 'Cuadra con el sistema.' : `${d < 0 ? 'Faltante' : 'Sobrante'} de ${dinero(d)}: explica qué pasó.`
        })
    })

    //gráficas 
    const datos = document.getElementById('datos-graficas')
    if (datos && window.Chart) {
        const d = JSON.parse(datos.textContent)
        const colores = ['#0b6fb8', '#7c3aed', '#db2777']
        const nombre = c => c.nombre.split('—').pop().trim()
        const dinero = v => '$' + Number(v).toLocaleString('es-MX', { maximumFractionDigits: 0 })
        const etiqueta = p => d.filtros.agrupar === 'mes' ? p : p.slice(8, 10) + '/' + p.slice(5, 7)
        Chart.defaults.font.family = getComputedStyle(document.body).fontFamily
        const ejes = { y: { beginAtZero: true, ticks: { callback: dinero } } }
        const tip = { callbacks: { label: x => `${x.dataset.label || x.label}: ${dinero(x.parsed.y ?? x.parsed)}` } }
        new Chart(document.getElementById('g-servicio'), {
            type: 'bar',
            data: { labels: d.porServicio.map(s => nombre({ nombre: s.caja })),
                    datasets: [{ label: 'Ventas', data: d.porServicio.map(s => s.ventas), backgroundColor: colores },
                               { label: 'Devoluciones', data: d.porServicio.map(s => s.devoluciones), backgroundColor: '#f59e0b' }] },
            options: { responsive: true, maintainAspectRatio: false, scales: ejes, plugins: { tooltip: tip } }
        })
        new Chart(document.getElementById('g-periodo'), {
            type: 'line',
            data: { labels: d.periodos.map(etiqueta),
                    datasets: d.cajas.map((c, i) => ({ label: nombre(c), data: d.ventas[c.id], borderColor: colores[i % 3], backgroundColor: colores[i % 3], cubicInterpolationMode: 'monotone', pointRadius: 2 })) },
            options: { responsive: true, maintainAspectRatio: false, scales: ejes, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: tip } }
        })
        new Chart(document.getElementById('g-devoluciones'), {
            type: 'bar',
            data: { labels: d.periodos.map(etiqueta),
                    datasets: d.cajas.map((c, i) => ({ label: nombre(c), data: d.devoluciones[c.id], backgroundColor: colores[i % 3] })) },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { ...ejes.y, stacked: true } }, plugins: { tooltip: tip } }
        })
    }
})()
