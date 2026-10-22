// Validación en el navegador 
(() => {
    'use strict'

    // verificacion de contraseñas
    document.querySelectorAll('[data-confirmar]').forEach(confirmar => {
        const original = document.getElementById(confirmar.dataset.confirmar)
        const opcional = !original.required // modificar contraseña es opcional; si escriben en alguno de los dos, ambos se vuelven obligatorios
        const revisar = () => {
            const distinto = confirmar.value !== original.value
            confirmar.setCustomValidity(distinto ? 'Las contraseñas no coinciden' : '')
            if (opcional) {
                const escribio = original.value.length > 0 || confirmar.value.length > 0
                original.required = escribio
                confirmar.required = escribio
            }
        }
        original.addEventListener('input', revisar)
        confirmar.addEventListener('input', revisar)
    })

    // Estilos de Bootstrap 
    document.querySelectorAll('form.needs-validation').forEach(form => {
        form.addEventListener('submit', evento => {
            if (!form.checkValidity()) {
                evento.preventDefault()
                evento.stopPropagation()
            }
            form.classList.add('was-validated')
        })
    })

    const confirmar = (titulo, texto) => Swal.fire({
        title: titulo, text: texto, icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, continuar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc3545'
    }).then(r => r.isConfirmed)

    // Confirmación genérica
    document.querySelectorAll('form.form-confirmar').forEach(form => {
        form.addEventListener('submit', evento => {
            evento.preventDefault()
            confirmar(form.dataset.titulo || '¿Seguro?', form.dataset.texto || 'Esta acción no se puede deshacer.')
                .then(ok => { if (ok) form.submit() })
        })
    })

    // Botón con formaction que pide confirmación
    document.querySelectorAll('button[data-pregunta]').forEach(boton => {
        boton.addEventListener('click', evento => {
            evento.preventDefault()
            confirmar(boton.dataset.pregunta, 'Esta acción no se puede deshacer.').then(ok => {
                if (!ok) return
                const form = boton.form
                form.action = boton.formAction
                form.submit()
            })
        })
    })

    // Recetas: filas dinámicas de ingredientes y extras
    document.querySelectorAll('[data-agregar]').forEach(boton => {
        const tipo = boton.dataset.agregar
        const plantilla = document.getElementById(`tpl-${tipo}`)
        const destino = document.getElementById(tipo === 'ingrediente' ? 'lista-ingredientes' : 'lista-extras')
        boton.addEventListener('click', () => {
            destino.appendChild(plantilla.content.cloneNode(true))
            ajustarCategoria()
        })
    })
    document.addEventListener('click', evento => {
        const quitar = evento.target.closest('.quitar-fila')
        if (quitar) quitar.closest('.fila-dinamica').remove()
    })

    // En pizza y alitas no se quitan ingredientes: se avisa y se fuerza "Fijo"
    const categoria = document.getElementById('categoria_id')
    function ajustarCategoria() {
        if (!categoria) return
        const opcion = categoria.selectedOptions[0]
        const noQuitar = opcion && opcion.dataset.quitar === '0'
        const aviso = document.getElementById('aviso-no-quitar')
        if (aviso) aviso.classList.toggle('d-none', !noQuitar)
        document.querySelectorAll('select[name="ing_tipo"]').forEach(s => {
            if (noQuitar) s.value = 'fijo'
            s.querySelector('option[value="movil"]').disabled = noQuitar
        })
    }
    if (categoria) { categoria.addEventListener('change', ajustarCategoria); ajustarCategoria() }

    // Confirmación antes de eliminar un usuario
    document.querySelectorAll('form.form-eliminar').forEach(form => {
        form.addEventListener('submit', evento => {
            evento.preventDefault()
            Swal.fire({
                title: '¿Eliminar usuario?',
                text: `Se eliminará a "${form.dataset.nombre}". Esta acción no se puede deshacer.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#dc3545'
            }).then(resultado => {
                if (resultado.isConfirmed) form.submit()
            })
        })
    })
})()
