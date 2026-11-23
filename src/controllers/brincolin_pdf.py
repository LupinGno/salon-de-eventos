"""
Contrato y comprobante de renta de brincolín 
"""
import base64
import json
import sys
from io import BytesIO

from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer

from salon_pdf import CENTRO, CHICO, MEDIOS, NORMAL, SECCION, TITULO, dinero, esc, pares, pie, tabla


def documento(d):
    contrato = d['tipo'] == 'contrato'
    h = [Paragraph(esc(d['negocio']), TITULO), Paragraph('El futuro que se te prometió', CHICO), Spacer(1, 4 * mm)]
    titulo = 'Contrato de renta de brincolín' if contrato else 'Comprobante de renta de brincolín'
    h.append(Paragraph(f"<b>{titulo}</b> &nbsp;·&nbsp; Folio {esc(d['folio'])}", ParagraphStyle('x', parent=NORMAL, fontSize=12, leading=16)))
    h.append(Paragraph(f"Emitido: {esc(d['emitido'])} &nbsp;·&nbsp; Atendió: {esc(d['encargado'])}"
                       + ('' if contrato else f" &nbsp;·&nbsp; Estado: {esc(d['estado'])}"), CHICO))

    b = d['brincolin']
    h.append(Paragraph('Renta', SECCION))
    h.append(pares([
        ('Brincolín', f"{b['nombre']} ({b['largo']} × {b['ancho']} × {b['alto']} m)"),
        ('Día de renta', d['fecha']),
        ('Se recoge', f"{d['recoger']}, en el mismo lugar"),
        ('Domicilio', d['direccion']),
        ('Referencias', d.get('referencias') or '—'),
        ('Espacio libre declarado', d['espacio']),
    ]))

    c = d['cliente']
    h.append(Paragraph('Quién renta y paga', SECCION))
    h.append(pares([('Nombre', c['nombre']), ('Teléfono', c['telefono']), ('Correo', c.get('correo') or '—')]))

    i = d['importes']
    h.append(Paragraph('Importes', SECCION))
    h.append(tabla([['Concepto', 'Importe'], ['Renta del día', dinero(i['precio'])],
                    ['Garantía (se devuelve si regresa en condiciones)', dinero(i['garantia'])],
                    ['Total pagado al reservar', dinero(i['precio'] + i['garantia'])]], [120 * mm, 50 * mm], alinear_derecha=(1,)))
    h.append(Paragraph(f"Medio de pago: <b>{MEDIOS.get(d['medio'], d['medio'])}</b>. Las devoluciones se hacen por ese mismo medio y solo a quien pagó.", CHICO))

    if not contrato:
        h.append(Paragraph('Pagos y devoluciones', SECCION))
        filas = [['Fecha', 'Concepto', 'Persona', 'Medio', 'Monto']]
        for p in d['pagos']:
            filas.append([p['fecha'], Paragraph(esc(p['concepto']), NORMAL), Paragraph(esc(p['persona']), NORMAL),
                          MEDIOS.get(p['medio'], p['medio']), dinero(p['monto'])])
        h.append(tabla(filas, [28 * mm, 45 * mm, 47 * mm, 25 * mm, 25 * mm], alinear_derecha=(4,)))

    h.append(Paragraph('Términos y condiciones', SECCION))
    for n, t in enumerate(d['terminos'], 1):
        h.append(Paragraph(f"{n}. {esc(t)}", NORMAL))
        h.append(Spacer(1, 1.2 * mm))

    if contrato:
        firma = []
        if d.get('firma'):
            datos = base64.b64decode(d['firma'].split(',', 1)[1])
            ancho, alto = ImageReader(BytesIO(datos)).getSize()
            escala = min(70 * mm / ancho, 28 * mm / alto)
            firma.append(Image(BytesIO(datos), width=ancho * escala, height=alto * escala))
        firma.append(Paragraph('_______________________________________', CENTRO))
        firma.append(Paragraph(f"<b>{esc(c['nombre'])}</b>", CENTRO))
        firma.append(Paragraph('Cliente. Leyó y aceptó los términos y condiciones.', ParagraphStyle('f', parent=CHICO, alignment=TA_CENTER)))
        h.append(Spacer(1, 6 * mm))
        h.append(KeepTogether(firma))
    return h


def main():
    datos = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    salida = BytesIO()
    doc = SimpleDocTemplate(salida, pagesize=letter, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=15 * mm, bottomMargin=18 * mm,
                            title=f"{'Contrato' if datos['tipo'] == 'contrato' else 'Comprobante'} {datos['folio']}", author=datos['negocio'])
    doc.build(documento(datos), onFirstPage=pie, onLaterPages=pie)
    sys.stdout.buffer.write(salida.getvalue())


if __name__ == '__main__':
    main()
