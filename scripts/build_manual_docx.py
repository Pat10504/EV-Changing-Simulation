from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "ev_charging_simulation_manual.docx"
POWER_TRIANGLE = ROOT / "src" / "public" / "assets" / "power-triangle.jpg"

FONT = "Tahoma"
BLUE = RGBColor(46, 116, 181)
DARK_BLUE = RGBColor(31, 77, 120)
INK = RGBColor(30, 38, 48)
MUTED = RGBColor(92, 103, 115)
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F2F4F7"
PALE_YELLOW = "FFF7D6"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(table, top=80, start=120, bottom=80, end=120):
    tbl_pr = table._tbl.tblPr
    tbl_cell_mar = tbl_pr.find(qn("w:tblCellMar"))
    if tbl_cell_mar is None:
        tbl_cell_mar = OxmlElement("w:tblCellMar")
        tbl_pr.append(tbl_cell_mar)
    for m, v in {"top": top, "start": start, "bottom": bottom, "end": end}.items():
        node = tbl_cell_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tbl_cell_mar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_table_width(table, widths):
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for row in table.rows:
        for idx, width in enumerate(widths):
            if idx < len(row.cells):
                row.cells[idx].width = Inches(width)
                row.cells[idx].vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    tbl = table._tbl
    tbl_pr = tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), "9360")
    tbl_w.set(qn("w:type"), "dxa")
    set_cell_margins(table)


def set_run_font(run, size=None, color=None, bold=None):
    run.font.name = FONT
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    run._element.rPr.rFonts.set(qn("w:cs"), FONT)
    if size:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    if bold is not None:
        run.bold = bold


def paragraph(doc, text="", style=None, size=11, color=INK, bold=False, after=6, align=None):
    p = doc.add_paragraph(style=style)
    if align:
        p.alignment = align
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.25
    if text:
        r = p.add_run(text)
        set_run_font(r, size=size, color=color, bold=bold)
    return p


def heading(doc, text, level=1):
    p = doc.add_paragraph(style=f"Heading {level}")
    p.paragraph_format.space_before = Pt(18 if level == 1 else 12)
    p.paragraph_format.space_after = Pt(8 if level == 1 else 6)
    r = p.add_run(text)
    set_run_font(r, size=16 if level == 1 else 13, color=BLUE if level == 1 else DARK_BLUE, bold=True)
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(0.375)
    p.paragraph_format.first_line_indent = Inches(-0.188)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.25
    r = p.add_run(text)
    set_run_font(r, size=11, color=INK)
    return p


def number(doc, text):
    p = doc.add_paragraph(style="List Number")
    p.paragraph_format.left_indent = Inches(0.375)
    p.paragraph_format.first_line_indent = Inches(-0.188)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.25
    r = p.add_run(text)
    set_run_font(r, size=11, color=INK)
    return p


def callout(doc, title, body, fill=PALE_YELLOW):
    table = doc.add_table(rows=1, cols=1)
    table.style = "Table Grid"
    set_table_width(table, [6.5])
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(title)
    set_run_font(r, 11, DARK_BLUE, True)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.25
    r2 = p2.add_run(body)
    set_run_font(r2, 10.5, INK)
    paragraph(doc, "", after=4)


def simple_table(doc, headers, rows, widths, header_fill=LIGHT_BLUE):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    set_table_width(table, widths)
    for idx, text in enumerate(headers):
        cell = table.cell(0, idx)
        set_cell_shading(cell, header_fill)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(text)
        set_run_font(r, 10.5, DARK_BLUE, True)
    for row in rows:
        cells = table.add_row().cells
        for idx, text in enumerate(row):
            p = cells[idx].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.15
            if idx == 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(text)
            set_run_font(r, 10, INK)
    set_table_width(table, widths)
    paragraph(doc, "", after=4)
    return table


def set_doc_styles(doc):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    normal._element.rPr.rFonts.set(qn("w:cs"), FONT)
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.25

    for style_name in ["Heading 1", "Heading 2", "Heading 3", "Title", "List Bullet", "List Number"]:
        style = doc.styles[style_name]
        style.font.name = FONT
        style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        style._element.rPr.rFonts.set(qn("w:cs"), FONT)

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = footer.add_run("EV Charging Simulation Manual")
    set_run_font(r, 9, MUTED)


def add_title_page(doc):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("คู่มือใช้งานระบบจำลองการจัดการพลังงาน\nสำหรับสถานีชาร์จ EV")
    set_run_font(r, 20, RGBColor(11, 37, 69), True)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(14)
    r = p.add_run("EV Charging Energy Management Simulation")
    set_run_font(r, 12, MUTED, False)

    callout(
        doc,
        "วัตถุประสงค์",
        "เอกสารนี้สรุปวิธีเตรียมข้อมูล CSV, อัปโหลดข้อมูล, เริ่มจำลองบน Dashboard, อ่านผลโหลด/PWM และเชื่อมต่อ ESP32 สำหรับ demo แสดงผลบน LCD 16x2 I2C",
        LIGHT_GRAY,
    )

    heading(doc, "ภาพรวมระบบ", 1)
    paragraph(
        doc,
        "ระบบจำลองนี้ใช้ตรวจสอบภาระรวมของหม้อแปลงเมื่อมีรถ EV เข้ามาชาร์จพร้อมกันหลายตู้ "
        "ถ้าโหลดเกิน limit ที่ตั้งไว้ ระบบจะคำนวณการลดกำลังชาร์จต่อหัว และแปลงผลเป็นค่า PWM สำหรับแสดงบน Dashboard หรืออุปกรณ์ ESP32",
    )

    simple_table(
        doc,
        ["ส่วน", "หน้าที่หลัก"],
        [
            ["Upload", "รับไฟล์ chargers.csv และ load_pattern.csv, แสดง preview, validate และบันทึกลง Supabase"],
            ["Dashboard", "อ่านข้อมูลตามเวลา คำนวณโหลดรวม สถานะระบบ การลดกำลัง และค่า PWM แบบ realtime"],
            ["Formulas", "อธิบายสูตร P, Q, S, Power Factor, Overload และ PWM simulation"],
            ["Hardware", "ESP32 ดึงค่า latest ผ่าน HTTP แล้วแสดงบน LCD 16x2 I2C"],
        ],
        [1.35, 5.15],
    )

    heading(doc, "ไฟล์ที่ต้องเตรียม", 1)
    bullet(doc, "chargers.csv ต้องมี header: charger_kW,total_units เช่น 50,120 และ 150,60")
    bullet(doc, "load_pattern.csv ต้องมี header: time,base_load_percent และ active_[ขนาด]kW ตามขนาดตู้ที่มีจริง")
    bullet(doc, "เวลาใน load_pattern.csv ใช้รูปแบบ HH:MM โดยทั่วไปคือทุก 5 นาที รวม 288 records ต่อวัน")
    bullet(doc, "จำนวน active charger ต้องไม่เกิน total_units ของแต่ละขนาดตู้")


def add_usage_page(doc):
    doc.add_section(WD_SECTION_START.NEW_PAGE)
    heading(doc, "ขั้นตอนใช้งาน Demo", 1)
    number(doc, "เปิด server ด้วยคำสั่ง npm run p แล้วเข้า http://localhost:3000/upload")
    number(doc, "ตั้งค่า Transformer MVA และ Load limit ตามโจทย์ demo เช่น 50 MVA และ 80%")
    number(doc, "เลือกไฟล์ chargers.csv และ load_pattern.csv จากเครื่อง จากนั้นตรวจ preview ให้ครบก่อนบันทึก")
    number(doc, "กดบันทึกลง Supabase แล้วเปิด http://localhost:3000/dashboard")
    number(doc, "ตั้งค่า Power Factor, Speed และกด Start เพื่อเริ่มจำลองแบบ realtime")
    number(doc, "สังเกต metric cards, stacked chart, ตาราง charger และ PWM card เมื่อเข้าสู่ช่วง Overload")

    callout(
        doc,
        "จุดที่ควรโชว์ให้อาจารย์ดู",
        "ก่อนเริ่ม demo ให้เตรียม load_pattern.csv ที่มีช่วงเย็นหรือช่วง peak load จน total_load_percent เกิน limit เพื่อให้เห็นสถานะ OVERLOAD และค่า PWM ลดลงอย่างชัดเจน",
    )

    heading(doc, "การอ่านผลบน Dashboard", 1)
    simple_table(
        doc,
        ["ตัวชี้วัด", "ความหมาย"],
        [
            ["Total load", "โหลดรวมของหม้อแปลงในหน่วย kVA ใช้ apparent power สำหรับตรวจ overload"],
            ["Base load", "โหลดพื้นฐานจาก CSV คิดเป็นเปอร์เซ็นต์ของพิกัดหม้อแปลง"],
            ["EV load", "โหลดจากจำนวนตู้ที่กำลังชาร์จ คำนวณจาก kW แล้วแปลงเป็น kVA ด้วย PF"],
            ["System status", "NORMAL, WARNING หรือ OVERLOAD โดย OVERLOAD อ้างอิง limit ที่ผู้ใช้ตั้ง"],
            ["PWM", "ค่าจำลอง 0-255 สำหรับส่งต่อ hardware display และแปลงกลับเป็น voltage/simulated kW"],
        ],
        [1.35, 5.15],
    )

    heading(doc, "สูตรหลักที่ใช้คำนวณ", 1)
    paragraph(doc, "หม้อแปลงใช้พิกัด apparent power จึงตรวจ overload ด้วย S หน่วย kVA ไม่ใช่ P หน่วย kW อย่างเดียว")
    bullet(doc, "transformer_kVA = transformer_MVA x 1000")
    bullet(doc, "load_limit_kVA = transformer_kVA x (limit_percent / 100)")
    bullet(doc, "ev_load_kVA = ev_load_kW / power_factor")
    bullet(doc, "total_S_kVA = sqrt(total_P_kW^2 + total_Q_kVAr^2)")
    bullet(doc, "pwm = round((new_power_kW / original_power_kW) x 255)")

    if POWER_TRIANGLE.exists():
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run()
        run.add_picture(str(POWER_TRIANGLE), width=Inches(4.0))
        caption = doc.add_paragraph()
        caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = caption.add_run("ภาพประกอบความสัมพันธ์ P, Q, S และ Power Factor")
        set_run_font(r, 9.5, MUTED)


def add_hardware_page(doc):
    doc.add_section(WD_SECTION_START.NEW_PAGE)
    heading(doc, "เชื่อมต่อ Hardware Demo", 1)
    paragraph(
        doc,
        "Phase hardware ใช้ ESP32 เป็นตัวอ่านค่าล่าสุดจาก backend ผ่าน Wi-Fi แล้วแสดงผลบนจอ LCD 16x2 I2C "
        "ยังไม่ควบคุมกระแสจริงและยังไม่ต่อวงจรกำลัง เหมาะสำหรับ demo ว่าระบบ backend สามารถส่งสถานะและ PWM ออกไปยังอุปกรณ์ได้",
    )

    simple_table(
        doc,
        ["LCD I2C", "ESP32", "หมายเหตุ"],
        [
            ["GND", "GND", "ต่อ ground ร่วมกัน"],
            ["VCC", "3V3", "เริ่มจาก 3.3V ก่อนเพื่อความปลอดภัย"],
            ["SDA", "GPIO21 / D21", "I2C data"],
            ["SCL", "GPIO22 / D22", "I2C clock"],
        ],
        [1.25, 1.7, 3.55],
    )

    heading(doc, "Endpoint สำหรับ ESP32", 1)
    paragraph(doc, "ให้ ESP32 polling ทุกประมาณ 1 วินาที:")
    paragraph(doc, "GET http://<computer-ip>:3000/api/hardware/latest", size=10.5, color=DARK_BLUE, bold=True)
    paragraph(doc, "ตัวอย่างค่าที่ใช้แสดงบน LCD: status, pwm, total_load_percent, total_load_kVA, ev_load_kW และ base_load_kVA")

    callout(
        doc,
        "ข้อควรระวัง",
        "ห้ามจ่าย 9V เข้า 3V3 หรือ GPIO ของ ESP32 โดยตรง ถ้าต้องใช้ adapter ให้จ่ายเข้าช่อง VIN/ช่องรับไฟที่บอร์ดรองรับเท่านั้น สำหรับ demo แนะนำใช้ USB-C จากคอมพิวเตอร์หรือ power bank 5V จะปลอดภัยกว่า",
    )

    heading(doc, "Checklist ก่อนนำเสนอ", 1)
    bullet(doc, "Supabase มีตาราง chargers และ load_patterns ตาม schema.sql แล้ว")
    bullet(doc, "อัปโหลด CSV สำเร็จและ preview แสดงจำนวน active charger ถูกต้อง")
    bullet(doc, "Dashboard แสดงช่วง NORMAL, WARNING และ OVERLOAD ได้ครบ")
    bullet(doc, "เมื่อ OVERLOAD ค่า PWM ต้องลดลง และตาราง charger แสดง new power kW")
    bullet(doc, "ถ้าใช้ ESP32 ให้ตรวจ I2C address ของ LCD เป็น 0x27 หรือ 0x3F และตั้ง server URL เป็น IP ของเครื่องที่รัน backend")


def build():
    doc = Document()
    set_doc_styles(doc)
    add_title_page(doc)
    add_usage_page(doc)
    add_hardware_page(doc)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    build()
