"""Contrato y comprobante de renta de salón"""
import base64
import json
import sys
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (Image, KeepTogether, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

AZUL = colors.HexColor('#0b6fb8')
CIELO = colors.HexColor('#e8f4fc')
GRIS = colors.HexColor('#5b6b7a')
MEDIOS = {'efectivo': 'Efectivo', 'tarjeta': 'Tarjeta', 'transferencia': 'Transferencia', None: '—'}
TAMANOS = {'chico': 'Chico', 'mediano': 'Mediano', 'grande': 'Grande'}

estilos = getSampleStyleSheet()
NORMAL = ParagraphStyle('n', parent=estilos['Normal'], fontName='Helvetica', fontSize=9.5, leading=13)
CHICO = ParagraphStyle('c', parent=NORMAL, fontSize=8.5, leading=11, textColor=GRIS)
TITULO = ParagraphStyle('t', parent=NORMAL, fontName='Helvetica-Bold', fontSize=16, leading=20, textColor=AZUL)
SECCION = ParagraphStyle('s', parent=NORMAL, fontName='Helvetica-Bold', fontSize=11, leading=15, textColor=AZUL, spaceBefore=8, spaceAfter=3)
CENTRO = ParagraphStyle('ce', parent=NORMAL, alignment=TA_CENTER)


def dinero(valor):
    v = float(valor or 0)
    signo = '−' if v < 0 else ''
    return f"{signo}${abs(v):,.2f}"


def esc(texto):
    return str(texto if texto is not None else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def tabla(filas, anchos, encabezado=True, alinear_derecha=()):
    t = Table(filas, colWidths=anchos, hAlign='LEFT')
    estilo = [
        ('FONT', (0, 0), (-1, -1), 'Helvetica', 9),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -1), 0.25, colors.HexColor('#c9dceb')),
        ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]
    if encabezado:
        estilo += [('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 9), ('BACKGROUND', (0, 0), (-1, 0), CIELO)]
    for col in alinear_derecha:
        estilo.append(('ALIGN', (col, 0), (col, -1), 'RIGHT'))
    t.setStyle(TableStyle(estilo))
    return t


def pares(filas):
    """Tabla de dos columnas: etiqueta en negritas y valor."""
    datos = [[Paragraph(f"<b>{esc(a)}</b>", NORMAL), Paragraph(esc(b), NORMAL)] for a, b in filas]
    t = Table(datos, colWidths=[45 * mm, 125 * mm], hAlign='LEFT')
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1)]))
    return t


def documento(d):
    contrato = d['tipo'] == 'contrato'
    h = []
    h.append(Paragraph(esc(d['negocio']), TITULO))
    h.append(Paragraph('El futuro que se te prometió', CHICO))
    h.append(Spacer(1, 4 * mm))
    titulo = 'Contrato de renta de salón' if contrato else 'Comprobante de renta de salón'
    h.append(Paragraph(f"<b>{titulo}</b> &nbsp;·&nbsp; Folio {esc(d['folio'])}", ParagraphStyle('x', parent=NORMAL, fontSize=12, leading=16)))
    h.append(Paragraph(f"Emitido: {esc(d['emitido'])} &nbsp;·&nbsp; Atendió: {esc(d['encargado'])}"
                       + ('' if contrato else f" &nbsp;·&nbsp; Estado: {esc(d['estado'])}"), CHICO))

    # Evento
    h.append(Paragraph('Evento', SECCION))
    m = d['mobiliario']
    mobiliario = f"{m['sillas']} sillas, {m['mesas']} mesas, {m['manteles']} manteles blancos y 1 bocina sin música"
    if m['desechables']:
        mobiliario += f"; {m['desechables']} juegos de desechables"
    h.append(pares([
        ('Salón', f"{d['salon']} ({TAMANOS.get(d['tamano'], d['tamano'])}, aforo máximo {d['aforo']} personas)"),
        ('Fecha', d['fecha']),
        ('Personas', str(d['personas'])),
        ('Tipo de renta', 'Con alimentos' if d['con_alimentos'] else 'Sin alimentos (el cliente trae su comida)'),
        ('Fiesta de menores', 'Sí' if d['fiesta_menores'] else 'No'),
        ('Mobiliario incluido', mobiliario),
        ('Brincolines incluidos', ', '.join(d['brincolines']) or 'Ninguno'),
    ]))

    if d['alimentos']:
        h.append(Paragraph('Alimentos del evento', SECCION))
        filas = [['Platillo', 'Cantidad', 'Precio', 'Importe']]
        for a in d['alimentos']:
            nombre = a['descripcion'] + (' (CANCELADO)' if a['estado'] == 'cancelado' else '')
            filas.append([Paragraph(esc(nombre), NORMAL), str(a['cantidad']), dinero(a['precio']), dinero(a['precio'] * a['cantidad'])])
        h.append(tabla(filas, [90 * mm, 22 * mm, 28 * mm, 30 * mm], alinear_derecha=(1, 2, 3)))

    # Personas 
    h.append(Paragraph('Quién renta y quién responde', SECCION))
    c, r = d['cliente'], d['responsable']
    h.append(pares([
        ('Renta y paga', f"{c['nombre']} · Tel. {c['telefono']}" + (f" · {c['correo']}" if c.get('correo') else '')),
        ('Responsable', r['nombre']),
        ('INE (clave de elector)', r['ine']),
        ('Fecha de nacimiento', '/'.join(reversed(r['nacimiento'].split('-')))),
        ('Celular', r['celular']),
        ('Dirección', r['direccion']),
    ]))

    # Importes 
    i = d['importes']
    h.append(Paragraph('Importes', SECCION))
    filas = [['Concepto', 'Importe'], ['Renta del salón', dinero(i['renta'])]]
    if i['alimentos']:
        filas.append(['Alimentos', dinero(i['alimentos'])])
    filas += [['Total de la renta', dinero(i['precio'])],
              ['Pagado de la renta', dinero(i['pagado'])],
              ['Saldo por liquidar', dinero(i['saldo']) + (f"  (a más tardar el {i['fecha_limite']})" if i['saldo'] > 0 else '')],
              ['Cuota de garantía (se devuelve si se entrega limpio)', dinero(i['cuota'])]]
    h.append(tabla(filas, [120 * mm, 50 * mm], alinear_derecha=(1,)))
    h.append(Paragraph(f"Medio de pago del apartado y la cuota: <b>{MEDIOS.get(d['medio'], d['medio'])}</b>. "
                       "Las devoluciones se hacen por ese mismo medio y solo a quien pagó.", CHICO))

    if not contrato:
        h.append(Paragraph('Pagos y devoluciones', SECCION))
        filas = [['Fecha', 'Concepto', 'Persona', 'Medio', 'Monto']]
        for p in d['pagos']:
            filas.append([p['fecha'], Paragraph(esc(p['concepto']), NORMAL), Paragraph(esc(p['persona']), NORMAL),
                          MEDIOS.get(p['medio'], p['medio']), dinero(p['monto'])])
        h.append(tabla(filas, [28 * mm, 45 * mm, 47 * mm, 25 * mm, 25 * mm], alinear_derecha=(4,)))

    # Términos
    h.append(Paragraph('Términos y condiciones', SECCION))
    for n, t in enumerate(d['terminos'], 1):
        h.append(Paragraph(f"{n}. {esc(t)}", NORMAL))
        h.append(Spacer(1, 1.2 * mm))

    if contrato:
        firma = []
        if d.get('firma'):
            datos = base64.b64decode(d['firma'].split(',', 1)[1])
            lector = ImageReader(BytesIO(datos))
            ancho, alto = lector.getSize()
            escala = min(70 * mm / ancho, 28 * mm / alto)
            firma.append(Image(BytesIO(datos), width=ancho * escala, height=alto * escala))
        firma.append(Paragraph('_______________________________________', CENTRO))
        firma.append(Paragraph(f"<b>{esc(r['nombre'])}</b>", CENTRO))
        firma.append(Paragraph('Responsable del evento. Leyó y aceptó los términos y condiciones.', ParagraphStyle('f', parent=CHICO, alignment=TA_CENTER)))
        h.append(Spacer(1, 6 * mm))
        h.append(KeepTogether(firma))
    return h


def pie(lienzo, doc):
    lienzo.saveState()
    lienzo.setFont('Helvetica', 7.5)
    lienzo.setFillColor(GRIS)
    lienzo.drawString(18 * mm, 10 * mm, 'Salón de Eventos y Snacks · Yuriria, Gto.')
    lienzo.drawRightString(letter[0] - 18 * mm, 10 * mm, f"Página {doc.page}")
    lienzo.restoreState()


def main():
    datos = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    salida = BytesIO()
    doc = SimpleDocTemplate(salida, pagesize=letter, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=15 * mm, bottomMargin=18 * mm,
                            title=f"{'Contrato' if datos['tipo'] == 'contrato' else 'Comprobante'} {datos['folio']}", author=datos['negocio'])
    doc.build(documento(datos), onFirstPage=pie, onLaterPages=pie)
    sys.stdout.buffer.write(salida.getvalue())


if __name__ == '__main__':
    main()
