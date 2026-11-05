"""
Ticket PDF de la barra de snacks (US-28) — Sprint 4.

Node.js (ticketPdf.js) ejecuta este script, le manda los datos del ticket
como JSON por la entrada estándar y recibe el PDF por la salida estándar.

Requisitos (una sola vez):  pip install reportlab
Prueba a mano:  python ticket_pdf.py < ejemplo.json > ticket.pdf
"""
import json
import sys
from io import BytesIO

from reportlab.lib.pagesizes import mm
from reportlab.pdfgen import canvas

ANCHO = 80 * mm          # rollo de impresora de tickets
MARGEN = 5 * mm
RENGLON = 4.2 * mm
ESTADOS = {
    'entregada': 'Entregado',
    'pendiente': 'Pendiente (cocina)',
    'en_preparacion': 'En preparación',
    'lista': 'Listo para entregar',
    'cancelada': 'CANCELADO',
}
MEDIOS = {'efectivo': 'Efectivo', 'tarjeta': 'Tarjeta', 'transferencia': 'Transferencia'}


def dinero(valor):
    return f"${float(valor or 0):,.2f}"


def cortar(texto, maximo):
    """Parte un texto largo en renglones de máximo `maximo` caracteres."""
    palabras, renglones, actual = str(texto).split(), [], ''
    for palabra in palabras:
        if len(actual) + len(palabra) + 1 > maximo and actual:
            renglones.append(actual)
            actual = palabra
        else:
            actual = f"{actual} {palabra}".strip()
    if actual:
        renglones.append(actual)
    return renglones or ['']


def renglones_del_ticket(t):
    """Arma la lista de renglones: (texto_izquierda, texto_derecha, estilo)."""
    r = []
    agregar = lambda izq='', der='', estilo='normal': r.append((izq, der, estilo))

    agregar(t['negocio'], '', 'titulo')
    agregar('El futuro que se te prometió', '', 'centro')
    agregar('', '', 'linea')
    agregar(f"Ticket No. {t['ticket']}", f"Comanda No. {t['comanda']}", 'negrita')
    agregar(t['caja'])
    agregar(f"Fecha: {t['fecha']}")
    agregar(f"Atendió: {t['atendio']}")
    agregar(t['destino'], '', 'grande')
    agregar(f"Cliente: {t['cliente']}")
    agregar('', '', 'linea')

    for a in t['articulos']:
        nombre = f"{a['cantidad']} x {a['descripcion']}"
        primeras = cortar(nombre, 30)
        agregar(primeras[0], dinero(a['importe']), 'negrita' if a['estado'] != 'cancelada' else 'tachado')
        for extra in primeras[1:]:
            agregar('   ' + extra)
        if a.get('piezas'):
            agregar(f"   {a['piezas']} piezas por orden", '', 'chico')
        for cambio in a['cambios']:
            precio = f"+{dinero(cambio['importe'])} c/u" if cambio['importe'] else ''
            agregar(f"   {cambio['texto']}", precio, 'chico')
        agregar(f"   Estado: {ESTADOS.get(a['estado'], a['estado'])}", '', 'chico')

    agregar('', '', 'linea')
    agregar('TOTAL', dinero(t['total']), 'grande')
    agregar(f"Pago: {MEDIOS.get(t['medio'], t['medio'])}", '')
    if t['medio'] == 'efectivo':
        agregar('Recibido', dinero(t['recibido']))
        agregar('Cambio', dinero(t['cambio']), 'negrita')
    elif t.get('referencia'):
        agregar(f"Referencia: {t['referencia']}")
    if t.get('cuenta'):
        agregar('', '', 'linea')
        agregar(f"Cuenta de la mesa: {t['cuenta']['comandas']} comandas", dinero(t['cuenta']['total']), 'negrita')
    if t.get('estado') == 'cancelada':
        agregar('COMANDA CANCELADA — sin reembolso', '', 'negrita')
    agregar('', '', 'linea')
    agregar('Pagado al ordenar. Los alimentos no tienen reembolso.', '', 'centro_chico')
    agregar('¡Gracias por tu visita!', '', 'centro')
    return r


def generar(t):
    renglones = renglones_del_ticket(t)
    alto = MARGEN * 2 + RENGLON * (len(renglones) + 2)
    salida = BytesIO()
    c = canvas.Canvas(salida, pagesize=(ANCHO, alto))
    c.setTitle(f"Ticket {t['ticket']}")
    y = alto - MARGEN - RENGLON

    for izq, der, estilo in renglones:
        if estilo == 'linea':
            c.setDash(1, 2)
            c.line(MARGEN, y + RENGLON / 2, ANCHO - MARGEN, y + RENGLON / 2)
            c.setDash()
        elif estilo in ('titulo', 'centro', 'centro_chico'):
            fuente, tam = {'titulo': ('Helvetica-Bold', 11), 'centro': ('Helvetica-Oblique', 8),
                           'centro_chico': ('Helvetica', 6.5)}[estilo]
            c.setFont(fuente, tam)
            c.drawCentredString(ANCHO / 2, y, izq)
        else:
            fuente, tam = {'negrita': ('Helvetica-Bold', 8), 'grande': ('Helvetica-Bold', 10),
                           'chico': ('Helvetica', 7), 'tachado': ('Helvetica', 8)}.get(estilo, ('Helvetica', 8))
            c.setFont(fuente, tam)
            c.drawString(MARGEN, y, izq)
            if der:
                c.drawRightString(ANCHO - MARGEN, y, der)
            if estilo == 'tachado':
                c.line(MARGEN, y + 1, ANCHO - MARGEN, y + 1)
        y -= RENGLON

    c.showPage()
    c.save()
    return salida.getvalue()


if __name__ == '__main__':
    datos = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    sys.stdout.buffer.write(generar(datos))
