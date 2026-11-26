"""Reportes de caja y corte de turno en PDF"""
import json
import sys
from io import BytesIO

from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from salon_pdf import CHICO, GRIS, MEDIOS, NORMAL, SECCION, TITULO, dinero, esc, pares, tabla

CELDA = ParagraphStyle('celda', parent=NORMAL, fontSize=8, leading=10)
CELDA_GRIS = ParagraphStyle('celda_gris', parent=CELDA, textColor=GRIS)


def p(texto, estilo=CELDA):
    return Paragraph(esc(texto), estilo)


def concepto(m):
    return Paragraph(f"{esc(m['concepto'])}<br/><font color='#5b6b7a'>{esc(m['referencia'])}</font>", CELDA)


def tabla_movimientos(filas, ancho_total, con_caja=True):
    encabezado = ['Fecha', 'Caja', 'Tipo', 'Concepto', 'Persona', 'Medio', 'Atendió', 'Monto'] if con_caja else \
                 ['Hora', 'Tipo', 'Concepto', 'Persona', 'Medio', 'Atendió', 'Monto']
    datos = [encabezado]
    for m in filas:
        fila = [p(m['fecha'])] + ([p(m['caja'])] if con_caja else []) + \
               [p(m['tipo']), concepto(m), p(m['persona']), p(MEDIOS.get(m['medio'], m['medio'])), p(m['usuario']), dinero(m['monto'])]
        datos.append(fila)
    if con_caja:
        anchos = [26, 18, 20, 62, 40, 26, 30, 24]
    else:
        anchos = [14, 20, 58, 36, 26, 28, 24]
    escala = ancho_total / sum(anchos)
    return tabla(datos, [a * escala * mm for a in anchos], alinear_derecha=(len(encabezado) - 1,))


def por_medio(t):
    return [['Medio', 'Monto']] + [[MEDIOS[k], dinero(t.get(k, 0))] for k in ('efectivo', 'tarjeta', 'transferencia')]


def reporte(d):
    h = [Paragraph(esc(d['negocio']), TITULO),
         Paragraph(f"<b>{esc(d['titulo'])}</b>", ParagraphStyle('x', parent=NORMAL, fontSize=12, leading=16)),
         Paragraph(f"{esc(d['filtros_texto'])} &nbsp;·&nbsp; Emitido: {esc(d['emitido'])} por {esc(d['usuario'])}", CHICO),
         Spacer(1, 3 * mm)]
    t = d['totales']
    h.append(Paragraph('Resumen', SECCION))
    h.append(tabla([['Movimientos', 'Entradas', 'Salidas', 'Neto', 'Efectivo', 'Tarjeta', 'Transferencia'],
                    [str(t['n']), dinero(t['entradas']), dinero(t['salidas']), dinero(t['neto']),
                     dinero(t['porMedio']['efectivo']), dinero(t['porMedio']['tarjeta']), dinero(t['porMedio']['transferencia'])]],
                   [28 * mm, 34 * mm, 34 * mm, 34 * mm, 34 * mm, 34 * mm, 34 * mm], alinear_derecha=(1, 2, 3, 4, 5, 6)))
    if len(d['porCaja']) > 1:
        h.append(Paragraph('Por caja', SECCION))
        h.append(tabla([['Caja', 'Entradas', 'Salidas', 'Neto']] +
                       [[c['caja'], dinero(c['entradas']), dinero(c['salidas']), dinero(c['neto'])] for c in d['porCaja']],
                       [80 * mm, 36 * mm, 36 * mm, 36 * mm], alinear_derecha=(1, 2, 3)))
    h.append(Paragraph('Movimientos', SECCION))
    if d['filas']:
        h.append(tabla_movimientos(d['filas'], 240))
        if d.get('recortado'):
            h.append(Paragraph('Se muestran los movimientos más recientes; los totales sí incluyen todo el periodo.', CHICO))
    else:
        h.append(Paragraph('No hay movimientos con esos filtros.', NORMAL))
    return h


def corte(d):
    h = [Paragraph(esc(d['negocio']), TITULO),
         Paragraph(f"<b>Corte de caja</b> &nbsp;·&nbsp; {esc(d['caja'])} &nbsp;·&nbsp; Turno {esc(d['folio'])}",
                   ParagraphStyle('x', parent=NORMAL, fontSize=12, leading=16)),
         Paragraph(f"Emitido: {esc(d['emitido'])}", CHICO), Spacer(1, 3 * mm)]
    h.append(pares([('Cajero', d['cajero']), ('Abrió', d['abierto']), ('Cerró', f"{d['cerrado']} por {d['cerro']}"),
                    ('Fondo inicial', dinero(d['fondo']))]))
    h.append(Paragraph('Arqueo del efectivo (US-70)', SECCION))
    dif = float(d['diferencia'])
    estado = 'Cuadra' if dif == 0 else ('Sobrante' if dif > 0 else 'Faltante')
    h.append(tabla([['Esperado (sistema)', 'Contado', 'Diferencia', 'Resultado'],
                    [dinero(d['esperado']), dinero(d['contado']), dinero(dif), estado]],
                   [42 * mm, 42 * mm, 42 * mm, 42 * mm], alinear_derecha=(0, 1, 2)))
    if d.get('observaciones'):
        h.append(Paragraph(f"Observaciones: {esc(d['observaciones'])}", CHICO))
    h.append(Paragraph('Corte por medio (US-71)', SECCION))
    h.append(tabla(por_medio(d['porMedio']), [60 * mm, 40 * mm], alinear_derecha=(1,)))
    h.append(Paragraph('Por tipo de movimiento', SECCION))
    h.append(tabla([['Tipo', 'Monto']] + [[a, dinero(b)] for a, b in d['porTipo']], [60 * mm, 40 * mm], alinear_derecha=(1,)))
    h.append(Paragraph('Por cajero', SECCION))
    h.append(tabla([['Quién', 'Efectivo', 'Tarjeta', 'Transferencia', 'Total']] +
                   [[u['usuario'], dinero(u['efectivo']), dinero(u['tarjeta']), dinero(u['transferencia']), dinero(u['total'])] for u in d['porUsuario']],
                   [50 * mm, 30 * mm, 30 * mm, 30 * mm, 30 * mm], alinear_derecha=(1, 2, 3, 4)))
    if d['arqueos']:
        h.append(Paragraph('Arqueos del turno', SECCION))
        h.append(tabla([['Hora', 'Tipo', 'Contó', 'Esperado', 'Contado', 'Diferencia']] +
                       [[a['hora'], a['tipo'], a['usuario'], dinero(a['esperado']), dinero(a['contado']), dinero(a['diferencia'])] for a in d['arqueos']],
                       [22 * mm, 22 * mm, 40 * mm, 28 * mm, 28 * mm, 28 * mm], alinear_derecha=(3, 4, 5)))
    h.append(Paragraph('Movimientos del turno', SECCION))
    if d['filas']:
        h.append(tabla_movimientos(d['filas'], 178, con_caja=False))
    else:
        h.append(Paragraph('No hubo movimientos.', NORMAL))
    h.append(Spacer(1, 14 * mm))
    h.append(tabla([['_______________________________', '_______________________________'],
                    ['Firma del cajero', 'Firma de quien recibe el corte']], [85 * mm, 85 * mm], encabezado=False))
    return h


def pie(lienzo, doc):
    lienzo.saveState()
    lienzo.setFont('Helvetica', 7.5)
    lienzo.setFillColor(GRIS)
    lienzo.drawString(15 * mm, 9 * mm, 'Salón de Eventos y Snacks · Yuriria, Gto.')
    lienzo.drawRightString(doc.pagesize[0] - 15 * mm, 9 * mm, f"Página {doc.page}")
    lienzo.restoreState()


def main():
    d = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    salida = BytesIO()
    es_corte = d['tipo'] == 'corte'
    tamano = letter if es_corte else landscape(letter)
    doc = SimpleDocTemplate(salida, pagesize=tamano, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=13 * mm, bottomMargin=16 * mm,
                            title=f"Corte {d['folio']}" if es_corte else d['titulo'], author=d['negocio'])
    doc.build(corte(d) if es_corte else reporte(d), onFirstPage=pie, onLaterPages=pie)
    sys.stdout.buffer.write(salida.getvalue())


if __name__ == '__main__':
    main()
