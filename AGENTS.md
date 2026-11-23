# PROJECT BRIEF: ระบบจำลองการจัดการพลังงานสำหรับสถานีชาร์จ EV

## สำหรับ Codex
อ่านไฟล์นี้ทั้งหมดก่อนเริ่มทำงาน ไฟล์นี้คือ spec ที่ตกลงกันไว้แล้วทั้งหมด ห้ามเปลี่ยน concept หลักโดยไม่ถามก่อน

---

## 1. ภาพรวมโปรเจค

### ปัญหา
เมื่อมีรถ EV เข้ามาชาร์จพร้อมกันจำนวนมาก โหลดรวมของสถานีชาร์จอาจทำให้หม้อแปลงไฟฟ้ากำลังรับภาระเกินขีดจำกัด เกิดภาวะ Overload และเสี่ยงต่อการจ่ายไฟไม่เสถียรหรือความเสียหายของหม้อแปลง

### แนวทางของระบบ
ระบบจำลอง Energy Management สำหรับหลายสถานีชาร์จ EV ในพื้นที่ที่ใช้หม้อแปลงใหญ่ร่วมกัน จะอ่านข้อมูลโหลดรายช่วงเวลา ตรวจสอบภาระรวมของหม้อแปลง และเมื่อเกิด Overload จะคำนวณการลดกำลังชาร์จของตู้ที่กำลังใช้งาน พร้อมแสดงกำลังต่อหัวและเปอร์เซ็นต์กำลังที่เหลือของแต่ละขนาดตู้บน Dashboard แบบ Realtime

### สิ่งที่ระบบทำใน Phase ปัจจุบัน
1. ผู้ใช้อัปโหลด CSV 2 ไฟล์ผ่านหน้าเว็บ: `chargers.csv` และ `load_pattern.csv`
2. Frontend แสดง preview ข้อมูลทั้งหมดก่อนบันทึก
3. Backend parse/validate CSV แล้วล้างข้อมูลเก่าและบันทึกข้อมูลใหม่ลง Supabase
4. Dashboard เลือกเวลาจากข้อมูล Supabase เพื่อดูผลและพัก หรือเริ่มจำลองต่อทีละ record ได้ทันที
5. Backend คำนวณ Base load, EV load, Total load, สถานะระบบ และการลดกำลังต่อหัวแยกตามขนาดตู้
6. Dashboard แสดงผล Realtime ผ่าน socket.io: metric cards, stacked chart และตารางกำลังตู้ชาร์จก่อน/หลังปรับ
7. หน้า /circuit ทดลองวงจรทีละเวลา และโหมด MATLAB บน Dashboard ทดลองตู้ตัวแทน 50 kW ตาม load profile พร้อมเก็บผลในเครื่อง (รายละเอียดหัวข้อ 17–18)

### Phase ถัดไป
ทบทวนการตอบสนองของวงจรและแยก AC/DC, PF และประสิทธิภาพ ก่อนพัฒนาตัวควบคุมกำลังป้อนกลับหรือ SOC ต่อเนื่อง ปัจจุบันเชื่อม MATLAB แบบทดลองอิสระทีละรอบและแบบชุดแล้ว ยุติการใช้งาน PWM/ESP32 ตั้งแต่ 14 พฤศจิกายน 2026; `HARDWARE.md` และโฟลเดอร์ `hardware/` เป็นประวัติการทดลองเดิม

---

## 2. Technology Stack ปัจจุบัน

| ส่วน | ใช้จริงตอนนี้ | หมายเหตุ |
|---|---|---|
| Runtime | Node.js / Express.js | ใช้ ES Module ทั้งโปรเจค |
| Frontend | HTML / CSS / JavaScript | serve static ผ่าน Express |
| Chart | Chart.js 4.6.1 ผ่าน npm | เสิร์ฟ local bundle; stacked area chart พร้อม tooltip/animation |
| Realtime | socket.io | ส่ง `simulation:update` |
| File Upload | multer | รับ CSV 2 ไฟล์ |
| CSV Parse | csv-parse | parse + validate |
| Database | Supabase PostgreSQL | ใช้ service role key เฉพาะ backend |
| Dev tools | nodemon, morgan | `npm run p` สำหรับ dev |
| Circuit experiment | MATLAB/Simulink + Python/Flask | ทดลอง local ผ่าน /circuit และโหมด /dashboard?mode=matlab |

---

## 3. CSV Design ที่ใช้จริง

โปรเจคนี้ให้ผู้ใช้เก็บไฟล์ CSV ข้อมูลใช้งานจริงนอก repo แล้วอัปโหลดผ่านหน้าเว็บ ส่วน `src/public/templates/` เก็บ template สำหรับดาวน์โหลด ไม่ใช่ข้อมูล fallback

### ไฟล์ 1: `chargers.csv`
ทะเบียนจำนวนตู้ชาร์จตามขนาดกำลัง

```csv
charger_kW,total_units
50,120
150,60
```

หมายเหตุ:
- `charger_kW` คือ rated power ของตู้ชาร์จ หน่วย kW
- `total_units` คือจำนวนตู้ทั้งหมดของขนาดนั้น
- รองรับหลายขนาด เช่น 50, 100, 120, 150, 180, 200 kW
- ชื่อไฟล์ในเครื่องไม่จำเป็นต้องเป็น `chargers.csv` เสมอ แต่ header ต้องมี `charger_kW,total_units` และต้องเลือกไฟล์นี้ในช่องอัปโหลด `chargers.csv`

### ไฟล์ 2: `load_pattern.csv`
ข้อมูลจำลองโหลด 24 ชั่วโมง โดย 1 แถวเท่ากับ 1 time slot

```csv
time,base_load_percent,active_50kW,active_150kW
00:00,35.00,8,0
00:05,34.92,9,1
18:00,74.00,80,50
23:55,35.00,8,0
```

หมายเหตุ:
- `time` เป็นเวลา `HH:MM` ทุก 5 นาที รวม 288 records ต่อวัน
- `base_load_percent` คือโหลดพื้นฐานของพื้นที่ เช่น บ้านพักอาศัย อาคารพาณิชย์ หรือโหลดอื่นที่ใช้หม้อแปลงร่วมกัน
- `active_[ขนาด]kW` คือจำนวนตู้ขนาดนั้นที่กำลังมีรถชาร์จในเวลานั้น
- จำนวน active ต้องไม่เกิน `total_units` ที่อัปโหลดใน `chargers.csv`
- ทุก column `active_[ขนาด]kW` ต้องมีขนาดตู้ตรงกับ `charger_kW` ใน `chargers.csv` เช่น `charger_kW=120` ต้องใช้ column `active_120kW`
- ชื่อไฟล์ในเครื่องไม่จำเป็นต้องเป็น `load_pattern.csv` เสมอ แต่ header ต้องมี `time,base_load_percent` และ active columns ตามรูปแบบ `active_[ขนาด]kW`

---

## 4. Database: Supabase

### Table: `chargers`
| column | type | description |
|---|---|---|
| id | bigint identity primary key | auto |
| charger_kw | integer | rated power ของตู้ชาร์จ |
| total_units | integer | จำนวนตู้ทั้งหมด |
| uploaded_at | timestamptz | เวลา upload |

### Table: `load_patterns`
| column | type | description |
|---|---|---|
| id | bigint identity primary key | auto |
| time_slot | varchar(5) | เวลา HH:MM |
| base_load_percent | numeric(5,2) | โหลดพื้นฐานเป็น % ของพิกัดหม้อแปลง |
| charger_data | jsonb | เช่น `{"active_50kW": 80, "active_150kW": 50}` |
| uploaded_at | timestamptz | เวลา upload |

### Flow ข้อมูล
Upload CSV -> validate -> clear old rows -> insert Supabase -> Dashboard start -> select records order by `time_slot` -> calculate -> emit realtime

---

## 5. Frontend ปัจจุบัน

### หน้า `upload.html`
- ตั้งค่า transformer MVA และ load limit
- อัปโหลด `chargers.csv`
- อัปโหลด `load_pattern.csv`
- preview ตารางแบบ scroll ดูข้อมูลทั้งหมดได้
- ปุ่มยืนยันและบันทึกลง Supabase
- ปุ่มล้างข้อมูลใน Database

### หน้า `dashboard.html`
- Header ใช้ชื่อโครงงาน: `ระบบจำลองการจัดการพลังงานสำหรับสถานีชาร์จ EV`
- แสดงโลโก้มหาวิทยาลัยศรีปทุม
- แสดงรายชื่อนักศึกษาและอาจารย์ที่ปรึกษา
- Control: transformer MVA, load limit, power factor, speed, เลือกเวลา/ดูช่วงนี้, start/pause/reset
- เลือกเวลาได้จากข้อมูลจริง ปุ่มดูช่วงนี้แสดงผลและพักทันที; เล่นต่อเดินจากแถวถัดไป มีปุ่มลัด 12:30 / 18:35 / 20:55 เมื่อมีข้อมูล
- Metric: เวลา, โหลดรวมเป็น kVA, โหลดพื้นฐานเป็น kVA, สถานะระบบ
- Chart: stacked area chart
  - Base load เป็นพื้นที่สีน้ำเงิน และ EV หลังควบคุมเป็นพื้นที่สีเขียวซ้อนด้านบน
  - ผลรวมพื้นที่คือโหลดรวมหลังควบคุม เทียบกับเส้นสีม่วงที่แสดงโหลดรวมก่อนควบคุม
  - เส้น limit เป็นเส้นประสีแดง; ทุกชุดใช้ % ของพิกัดหม้อแปลง
  - Tooltip แสดง % และ kVA พร้อมเส้นชี้เวลา; อัปเดตด้วย animation สั้นและคงเส้นตรงระหว่างข้อมูล
  - กราฟภาพรวมแสดงทุกแถวรายวันในทั้งสองโหมด คลิกเวลาหรือเลือกจากรายการเพื่ออ่านผลจัดสรรและประวัติวงจรโดยคิวยังเดินต่อ กดตามเวลาจำลองเพื่อกลับสู่แถวปัจจุบัน
  - รีเฟรชเว็บคืนผลล่าสุดจากเซิร์ฟเวอร์ได้ แต่ไม่เก็บตำแหน่งการเล่นข้ามการรีสตาร์ตเซิร์ฟเวอร์
- การ์ดโหลดรวมก่อน/หลังควบคุม โหลดพื้นฐาน และงบ EV; แถบสถานะผลหลังควบคุมแยกจากสถานะก่อนควบคุม
- ตารางแสดง active/ติดตั้ง โหลดก่อน ผลลด % รอบแรก กำลังสุดท้าย % ลดไป % เหลือ และเหตุผลที่ชนขั้นต่ำ/รับการลดเพิ่ม
- สรุปงบและการกระจาย พร้อมข้อความเมื่อควบคุมไม่สำเร็จ ไม่มี PWM card

### หน้า `formulas.html`
- อธิบายสูตร P, Q, S และ Power Factor
- อธิบายการแปลง EV load จาก kW เป็น kVA
- อธิบายการตรวจ Overload ของหม้อแปลงด้วย apparent power
- อธิบายการลดกำลังต่อหัวและเปอร์เซ็นต์กำลังที่เหลือ

---

## 6. วิธีคำนวณทางวิศวกรรมที่ใช้ในโปรเจค

### หลักสำคัญ
หม้อแปลงไฟฟ้ากำลังระบุพิกัดเป็น apparent power หน่วย MVA/kVA ดังนั้นการตรวจ Overload ต้องเทียบกับ `S` ไม่ใช่ `P` อย่างเดียว ส่วนตู้ EV Charger ยังใช้ rated power เป็น active power หน่วย kW ได้ตามปกติ

```text
S^2 = P^2 + Q^2
PF = cos(phi) = P / S
P = S x PF
Q = S x sin(phi)
sin(phi) = sqrt(1 - PF^2)
```

### ค่าหม้อแปลงและ Power Factor

```text
transformer_kVA = transformer_MVA x 1000
transformer_kW = transformer_kVA x power_factor
transformer_kVAr = transformer_kVA x sin(phi)
load_limit_kVA = transformer_kVA x (limit_percent / 100)
```

ตัวอย่าง 50 MVA, PF = 0.90:

```text
transformer_kVA = 50,000 kVA
transformer_kW = 50,000 x 0.90 = 45,000 kW
```

### โหลดพื้นฐาน
`base_load_percent` ใน CSV หมายถึง apparent loading ของโหลดพื้นฐานเทียบกับพิกัดหม้อแปลง

```text
base_load_kVA = transformer_kVA x (base_load_percent / 100)
base_load_kW = base_load_kVA x power_factor
base_load_kVAr = base_load_kVA x sin(phi)
```

### โหลดของ EV Charger
ตู้ EV แสดง rated power เป็น kW แต่เมื่อตรวจหม้อแปลงต้องแปลงเป็น kVA ด้วย PF

```text
ev_load_kW = sum(active_[size] x size_kW)
ev_load_kVA = ev_load_kW / power_factor
ev_load_kVAr = ev_load_kVA x sin(phi)
```

ตัวอย่าง:
```text
active_50kW = 80
active_150kW = 50
ev_load_kW = (80 x 50) + (50 x 150)
ev_load_kW = 4,000 + 7,500 = 11,500 kW
ถ้า PF = 0.90
ev_load_kVA = 11,500 / 0.90 = 12,777.78 kVA
```

### โหลดรวมของหม้อแปลง
```text
total_P_kW = base_load_kW + ev_load_kW
total_Q_kVAr = base_load_kVAr + ev_load_kVAr
total_S_kVA = sqrt(total_P_kW^2 + total_Q_kVAr^2)
total_load_percent = (total_S_kVA / transformer_kVA) x 100
```

### เกณฑ์สถานะระบบ
```text
if total_load_percent > limit_percent -> OVERLOAD
else if total_load_percent > 70 -> WARNING
else -> NORMAL
```

หมายเหตุ:
- `OVERLOAD` อ้างอิงจาก limit ที่ผู้ใช้ตั้ง ไม่ hard-code ที่ 80 เสมอ
- `WARNING` ใช้ 70% เป็นเกณฑ์แจ้งเตือนล่วงหน้า

### การลดกำลังเมื่อ Overload — สัดส่วนเดียวกันและขั้นต่ำ 12 kW

ขั้นแรกคำนวณงบ EV จากส่วนที่เหลือของขีดจำกัดหม้อแปลง ภายใต้สมมติฐาน PF ร่วมและยังไม่คิดการสูญเสียตู้ (η = 1):

```text
B = max(0, (load_limit_kVA - base_load_kVA) × PF)   # kW ที่จัดสรรให้ EV ได้
D = Σ(active_i × rated_i)                          # ความต้องการก่อนควบคุม
r0 = min(1, B / D)                                # ถ้า D = 0 ใช้ r0 = 1
initial_remaining_percent = 100 × r0
initial_reduction_percent = 100 × (1 - r0)
proportional_power_i = rated_i × r0                # ผลรอบแรก ยังไม่ใช้ขั้นต่ำ
```

1. ลดทุกขนาดเป็นเปอร์เซ็นต์เท่ากันในรอบแรก โดยถ้าไม่เกินงบจะจ่ายตามพิกัด
2. ถ้ากลุ่มใดคำนวณได้ต่ำกว่า 12 kW/ตู้ ให้ตรึงกลุ่มนั้นที่ 12 kW แล้วหักกำลังรวมของกลุ่มออกจากงบ
3. ใช้งบที่เหลือคำนวณสัดส่วนใหม่เฉพาะกลุ่มที่ยังลดได้: `r = remaining_budget / Σ(active_i × rated_i)`
4. ทำซ้ำจนไม่มีตู้กลุ่มใหม่ชนขั้นต่ำ การกระจายรอบถัดไปยังอิงสัดส่วนพิกัด ไม่ใช่ลบ kW เท่ากันทุกตู้
5. ถ้างบไม่พอแม้ทุกตู้จ่ายขั้นต่ำ ให้คงขั้นต่ำและรายงาน `control_limited = true` พร้อมกำลังที่ยังลดไม่ได้ ระบบไม่เปลี่ยน active หรือสั่งพักตู้เอง

เมื่อจัดสรรได้ ผลเทียบเท่ากับ `power_i = max(12, r × rated_i)` โดยเลือก r ให้ผลรวมไม่เกิน B และไม่เกินพิกัดตู้ หาก B มากกว่าความต้องการจะใช้กำลังตามพิกัด ไม่ใช้ B จนหมด

```text
all_active_minimum_kW = Σ(active_i × 12)
ถ้า B < all_active_minimum_kW → ไม่สามารถรักษาทั้งขั้นต่ำและขีดจำกัดได้
remaining_percent_i = power_i / rated_i × 100
reduction_percent_i = 100 - remaining_percent_i
```

ข้อควรรู้:
- ขั้นต่ำ 12 kW เป็นกติกาการทดลองที่ตกลงกัน ไม่ใช่มาตรฐานขั้นต่ำสากลของรถหรือตู้ทุกยี่ห้อ
- ข้อมูลช่วงพีกตั้งใจให้ผลรอบแรกต่ำกว่า 12 kW ได้ เพื่อทดสอบการตรึงขั้นต่ำและการกระจายกำลัง
- เมื่อมีตู้ชนขั้นต่ำ เปอร์เซ็นต์ที่ลดสุดท้ายของแต่ละขนาดจะต่างกัน
- ตู้ active = 0 ไม่ร่วมจัดสรร กำลังรวมและกำลังที่จัดสรรเป็น 0; UI แสดงขีดแทนกำลังต่อตู้
- สำหรับข้อมูลที่มีพิกัดต่ำกว่า 12 kW ระบบจำกัดขั้นต่ำที่ `min(12, rated)` เพื่อไม่จ่ายเกินพิกัด พร้อมแจ้ง `minimum_supported = false` และ `below_minimum_rating = true` จึงไม่รับรองขั้นต่ำ 12 kW สำหรับกลุ่มนั้น
- `status` เป็นสถานะก่อนควบคุม; `control_status` เป็น `NOT_NEEDED`, `ADJUSTED` หรือ `LIMITED` แยกผลหลังควบคุม
- เก็บความละเอียดเต็มในการคำนวณ แล้วปัด 2 ตำแหน่งตอนส่งผล ดังนั้นการคูณตัวเลขต่อตู้ที่ปัดแล้วอาจต่างจากยอดรวมเล็กน้อย ใช้ tolerance 0.000001 ในการตัดสินผลคลาดเคลื่อนเชิงตัวเลข

### ตัวอย่างตรวจสอบจากข้อมูล Supabase วันที่ 14 พฤศจิกายน 2026

ตั้งค่า 50 MVA, limit 80%, PF 0.9; ไม่ปรับข้อมูลโหลดในฐานข้อมูลในขั้นเปลี่ยนสูตร

| เวลา | Base % | Active 50 / 150 kW | งบ EV (kW) | ผลรอบแรก 50 / 150 (kW/ตู้) | ผลสุดท้าย 50 / 150 (kW/ตู้) | ผลควบคุม |
|---|---:|---:|---:|---:|---:|---|
| 18:00 | 73.50 | 76 / 49 | 2,925 | 13.12 / 39.35 | 13.12 / 39.35 | อยู่ในขีดจำกัด |
| 18:55 | 74.88 | 84 / 53 | 2,304 | 9.48 / 28.44 | 12 / 24.45 | อยู่ในขีดจำกัด |
| 20:55 | 77.88 | 68 / 43 | 954 | 4.84 / 14.53 | 12 / 12 | ยังเกิน 420 kVA |

ที่ 18:55 ตู้เล็กใช้ `84 × 12 = 1,008 kW` เหลือ `2,304 - 1,008 = 1,296 kW` ให้ตู้ใหญ่ 53 ตู้ จึงได้ `1,296 / 53 ≈ 24.45 kW/ตู้`

จาก 288 แถว ผลรอบแรกของตู้เล็กต่ำกว่า 12 kW จำนวน 35 แถว: กระจายต่อได้ 25 แถว และยังเกินขีดจำกัด 10 แถวที่ 20:15–21:00 ตัวเลขนี้เป็นผลของข้อมูลและค่าตั้งดังกล่าว ไม่ใช่คุณสมบัติคงที่ของระบบ และไม่ใช่ผลจาก MATLAB

### ผลลัพธ์การจัดสรรกำลังและการเตรียมเชื่อม MATLAB

ผลปัจจุบันรายขนาดตู้อยู่ใน `charger_adjusted`: `proportional_power_kW` คือผลรอบแรก, `new_power_kW` คือกำลังต่อหัวสุดท้าย, `reduction_percent` คือเปอร์เซ็นต์ที่ลด และ `new_power_percent` คือเปอร์เซ็นต์ที่เหลือ ส่วน `redistributed_extra_kW` คือกำลังที่ลดเพิ่มเติมจากผลรอบแรก (รายตู้ใน `charger_adjusted`, ผลรวมทุกตู้ในระดับบน)

เลิกส่ง `reduce_per_charger_kW` เพราะไม่มีการลด kW เท่ากันต่อหัวแล้ว ใช้ `initial_reduction_percent` และ `initial_remaining_percent` แทน

```text
remaining_percent = new_power_kW / original_kW x 100
reduction_percent = 100 - remaining_percent
```

ถอด PWM, voltage จำลอง และ `GET /api/hardware/latest` แล้ว ไม่มีการสั่งฮาร์ดแวร์ภายนอก

ขั้นต่อไปต้องแยกกำลังฝั่ง AC/DC, Power Factor และประสิทธิภาพตู้ก่อนกำหนดสัญญาณเข้า MATLAB การทดลองเดิมใช้กระแสหน่วย A; ห้ามนำค่า kW หรือเปอร์เซ็นต์ไปใส่เป็น A โดยตรง ยังไม่สำรวจหรือแก้ตัวควบคุมในวงจรในขั้นเปลี่ยนสูตรนี้

---

## 7. โครงสร้างโฟลเดอร์ปัจจุบัน

```text
ev-charging-simulation/
├── README.md                        # วิธีรันและสูตรปัจจุบันสำหรับผู้ใช้
├── CLAUDE.md
├── AGENTS.md
├── HARDWARE.md                       # ประวัติ hardware demo ที่ยุติแล้ว
├── package.json
├── package-lock.json
├── .env                              # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
├── .env.example
├── .gitignore
├── test/                            # ทดสอบสูตร การเล่น/ข้ามเวลา และการแสดงผล Dashboard
├── supabase/
│   └── schema.sql                    # SQL สำหรับสร้าง tables
└── src/
    ├── app.js                        # Express + socket.io + static files
    ├── server.js                     # start server
    ├── config/
    │   ├── index.js                  # อ่าน .env
    │   ├── constants.js
    │   └── paths.js                  # path ของ public files
    ├── routes/
    │   ├── index.js
    │   ├── page.routes.js            # /, /dashboard, /upload, /formulas
    │   ├── health.routes.js          # /api/health
    │   ├── upload.routes.js
    │   └── simulation.routes.js
    ├── controllers/
    │   ├── page.controller.js        # ส่ง HTML pages
    │   ├── health.controller.js
    │   ├── upload.controller.js
    │   └── simulation.controller.js
    ├── middleware/
    │   └── errorHandler.js
    ├── services/
    │   ├── db.service.js             # Supabase CRUD
    │   ├── csv.service.js            # parse/validate CSV upload
    │   ├── calculation.service.js    # load/overload calculation
    │   └── simulation.service.js     # realtime loop, seek และประวัติกราฟ
    └── public/
        ├── upload.html
        ├── dashboard.html
        ├── formulas.html
        ├── assets/
        │   └── spu-logo.svg
        ├── css/
        │   └── style.css
        └── js/
            ├── upload.js
            └── dashboard.js
```

ไม่มี `data/` ใน repo แล้ว เพราะ workflow จริงคืออัปโหลด CSV จากเครื่องผู้ใช้

---

## 8. สถานะปัจจุบัน

### เสร็จแล้ว
- Express server + socket.io
- Supabase schema และ backend CRUD
- CSV upload + preview + validation
- Dashboard realtime จาก Supabase จริง
- Calculation logic dynamic ตามขนาดตู้: ลดตามสัดส่วน มีขั้นต่ำ 12 kW และกระจายไปยังตู้ที่ยังลดได้
- Power Factor input ปรับได้บน Dashboard และใช้คำนวณ kW/kVA/kVAr
- ถอดการคำนวณและการแสดง PWM รวมถึง API ฮาร์ดแวร์ออกแล้ว (14 พฤศจิกายน 2026)
- UI ภาษาไทยแบบ minimal พร้อมโลโก้ SPU และข้อมูลโครงงาน
- Chart แบบ stacked Base load + EV หลังควบคุม พร้อมเส้นโหลดรวมก่อนควบคุมและเส้น limit
- Dashboard ฉบับออกแบบใหม่ แสดงผลรอบแรกเทียบผลสุดท้าย พร้อมสถานะเมื่อยังเกินหลังควบคุม
- หน้า formulas อธิบายสูตร P, Q, S, PF, Overload และการปรับลดกำลัง
- เก็บ `HARDWARE.md` และ firmware ESP32 เป็นประวัติ; ระบบปัจจุบันไม่เปิด endpoint ให้ firmware เดิม
- Clear database แล้ว simulation cache ถูก reset
- ไม่มี local CSV fallback ใน production flow

### ต้องทำต่อ
1. ให้ผู้ใช้ทบทวนการออกแบบ Dashboard ฉบับแรก และตรวจผลจากตัวอย่าง 18:00 / 18:55 / 20:55
2. ตกลงขอบเขตกำลังตู้ว่าเป็น DC output และเพิ่มประสิทธิภาพตู้ η โดยแยกจาก PF
3. ออกแบบข้อมูลโหลดจำลองชุดใหม่หากต้องการให้ทุกช่วงเวลารักษาขั้นต่ำ 12 kW และอยู่ใน limit พร้อมกัน; ข้อมูลเดิมยังเกินหลังควบคุม 10 แถวที่ค่าตั้ง 50 MVA / 80% / PF 0.9
4. สำรวจโมเดล MATLAB เพื่อระบุค่าเข้าและการวัดแรงดัน/กระแส/กำลังที่ใช้ตรวจผลจริง
5. เชื่อมค่าเป้าหมายกับ MATLAB หลังตรวจวงจรและหน่วยแล้ว; ปัจจุบันเว็บ Flask ยังทดลองแยก
6. เตรียมชุด CSV สำหรับนำเสนอให้อาจารย์ แยกเก็บนอก repo
7. ตรวจความเหมาะสมของจำนวน active และโหลดพื้นฐานด้วยข้อมูลอ้างอิงในพื้นที่จริงก่อนอ้างความสมจริง
8. Deploy บน Railway/Render เมื่อพร้อม

---

## 9. คำสั่งใช้งาน

```bash
npm install
npm run p
npm test # ทดสอบสูตร กรณีขอบเขต การเลือกเวลา และ Dashboard
```

เปิดเว็บ:
- Dashboard: `http://localhost:3000/dashboard`
- Upload: `http://localhost:3000/upload`
- สูตรคำนวณ: `http://localhost:3000/formulas`

รองรับ URL แบบไฟล์เดิมด้วย:
- `http://localhost:3000/dashboard.html`
- `http://localhost:3000/upload.html`
- `http://localhost:3000/formulas.html`

ถ้า port 3000 ถูกใช้อยู่ ให้ปิด process เดิมก่อน หรือรันด้วย port อื่น:

```bash
PORT=3001 npm run p
```

---

## 10. Environment

`.env` ต้องมี:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
PORT=3000
TRANSFORMER_MVA=50
LIMIT_PERCENT=80
POWER_FACTOR=0.90
SIMULATION_INTERVAL_MS=2000
```

หมายเหตุ:
- `SUPABASE_SERVICE_ROLE_KEY` ใช้เฉพาะฝั่ง backend ห้ามเอาไปใช้ใน frontend
- Tables ต้องถูกสร้างด้วย `supabase/schema.sql` ก่อนใช้งาน upload
- ค่าจริงของ ESP32 (`WIFI_SSID`, `WIFI_PASSWORD`, `API_URL`) อยู่ใน `hardware/esp32_dashboard_lcd/secrets.h` ซึ่ง Git ไม่ติดตาม ใช้ `secrets.example.h` เป็นตัวอย่างสำหรับเครื่องใหม่

---

## 11. ข้อตกลงการทำงานร่วมกัน

- ทำทีละ step ไม่กระโดด
- อธิบายสั้นๆ ว่าโค้ดทำอะไรและทำไม
- ทำเสร็จแล้วทดสอบก่อนค่อยไปต่อ
- ถ้าไม่แน่ใจหรือกระทบ concept หลัก ให้ถามก่อน
- อัปเดต `CLAUDE.md` และ `AGENTS.md` เมื่อมีข้อตกลงสำคัญใหม่
- Frontend ต้องดู professional, minimal, สะอาดตา
- เน้นทำให้ demo ส่งอาจารย์ได้จริง

---

## 12. GitHub Repository

https://github.com/Pat10504/EV-Changing-Simulation.git

---

## 13. การทดลอง MATLAB/Python แบบ local — 7 พฤศจิกายน 2026

- พื้นที่ทดลองคือ `experiments/python-matlab-engine/` แยกจาก Dashboard และระบบจัดการพลังงานหลัก
- ขอบเขตปัจจุบัน: HTML รับกระแสเป้าหมายจำนวนเต็ม 20–100 A → Flask → MATLAB Engine → จำลอง `DCFastCharger` → แสดงกระแสตัวอย่างสุดท้ายบนเว็บเดิม
- ใช้ MATLAB R2026b session ที่เปิดและแชร์ชื่อ `EVChargingLab`, Python 3.13.18 ใน `.venv`, Engine 26.2 และ Flask 3.1.3
- “บันทึกและรัน” เก็บค่าใน MATLAB Workspace สำหรับการจำลองรอบนั้น ไม่มีการเก็บประวัติลงฐานข้อมูล
- มีหลักฐานผู้ใช้รันผ่าน Python และเว็บ local ที่เป้าหมาย 40 A ได้ 39.46074956936718 A ตรงกัน ค่านี้เป็นตัวอย่างสุดท้าย ไม่ใช่ค่าเฉลี่ยหรือการรับรองวงจรจริง
- สอนให้ผู้ใช้ลงมือทีละขั้นและตรวจผลจริงก่อนขยายงาน เมื่อผู้ใช้มอบหมายให้ agent ทำ ให้ทำภายในขอบเขตที่อนุมัติ
- ไม่เก็บ `.venv`, Python cache, `slprj` หรือ `.slxc` ใน Git ดูวิธีรันและบทบาทไฟล์ใน `experiments/python-matlab-engine/README.md`

---

## 14. ยุติ PWM และทบทวนสูตร — 14 พฤศจิกายน 2026

- ผู้ใช้ให้ถอด PWM เพราะไม่สั่งฮาร์ดแวร์แล้ว; ถอด service, UI, signal metadata และ hardware API จากระบบที่รันจริง
- เก็บ firmware, `HARDWARE.md`, คู่มือ `docs/ev_charging_simulation_manual.docx` และตัวสร้างคู่มือ `scripts/build_manual_docx.py` เป็นเอกสาร/การทดลองรุ่นเก่า ซึ่งยังกล่าวถึง PWM และไม่ใช่คู่มือระบบปัจจุบัน
- ในขั้นถอด PWM คงผลคำนวณเดิมไว้ก่อน ต่อมาเปลี่ยนเป็นสูตรสัดส่วน + ขั้นต่ำ 12 kW ตามหัวข้อ 15; ยังไม่เพิ่มการเชื่อม MATLAB
- โค้ดเดิมใช้ PF ร่วมสำหรับโหลดพื้นฐานและ EV, รวม P/Q, ลด kW เท่ากันต่อหัวก่อนกระจายส่วนที่เหลือ และจำกัดขั้นต่ำ 20 kW
- โค้ดเดิมใช้ `active_*kW` จากแต่ละ time slot หาขนาดและจำนวนตู้ ส่วน `chargers` ใช้ตรวจจำนวนและแสดงทะเบียน; ยังไม่มีข้อมูลรถรายคัน/SOC/แรงดันแบตเตอรี่
- ภาพอ้างอิงล่าสุดใช้ η=0.95, ลดเป็นสัดส่วนเดียวกันและไม่มีขั้นต่ำ เป็นคนละสมมติฐานกับโค้ดเดิม
- ภาพเขียน 50 MVA เป็น 50,000 kW ซึ่งใช้ได้เมื่อสมมติ PF=1; หากใช้ PF=0.9 ต้องรักษาหน่วย kVA และแยก η จาก PF
- การอ่าน Supabase ณ วันที่ตรวจ: 50 kW จำนวน 120 ตู้, 150 kW จำนวน 60 ตู้, โหลด 288 แถว 00:00–23:55 ทุก 5 นาที
- ตัวอย่างข้อมูลจริง 18:00: base 73.5%, active 50/150 kW = 76/49; ที่ 50 MVA, limit 80%, PF 0.9 สูตรเดิมให้ก่อน 49,138.89 kVA หลัง 40,000 kVA; กำลังต่อหัว 20 และประมาณ 28.67 kW
- ตัวเลขนี้เป็นผลจากฟังก์ชันคำนวณเดิมกับข้อมูล Supabase ไม่ใช่ผลจำลองวงจร MATLAB และไม่ใช่การรับรองการทำงานของตู้จริง

---

## 15. ลดเป็นเปอร์เซ็นต์และขั้นต่ำ 12 kW — 14 พฤศจิกายน 2026

- ใช้สูตรในหัวข้อ 6 แทนการลด kW เท่ากันและขั้นต่ำ 20 kW เดิม พร้อมแยกผลรอบแรกและผลสุดท้าย
- กรณีงบไม่พอคงขั้นต่ำและรายงานส่วนเกินอย่างตรงไปตรงมา ไม่แอบลด active หรือแก้ข้อมูลใน Supabase
- เปลี่ยน Dashboard และหน้า formulas ให้ตรงกับสูตรใหม่ ส่วนการออกแบบหน้าจอเป็นฉบับแรกสำหรับให้ผู้ใช้ทบทวน
- คงสมมติฐาน PF ร่วม, η = 1 และความต้องการเริ่มต้นเต็มพิกัดสำหรับทุกตู้ active ไม่มีข้อมูล SOC หรือการยอมรับกำลังของรถรายคัน
- มี `npm test` ตรวจตัวอย่างที่คุยกัน การกระจายหลายขนาด กรณีไม่มี active โหลดพื้นฐานเกิน limit และขอบเขตขั้นต่ำ
- ขอบเขต MATLAB/Python ยังเป็นการทดลองแยก ไม่มีการส่งค่า kW หรือ % ไปใส่กระแส A โดยตรง


---

## 16. เลือกเวลาจำลองและปรับกราฟ — 14 พฤศจิกายน 2026

- ใช้ Chart.js 4.6.1 จาก npm ผ่าน `/vendor/chart.umd.js` แทน CDN; ปรับสี Tooltip และ animation โดยไม่เปลี่ยนสูตรจัดสรรหรือข้อมูล Supabase
- `POST /api/simulation/start` รับ `start_time` เพิ่มได้; ไม่ส่งจะเล่นต่อแถวถัดไป และเมื่อครบวันวนกลับแถวแรก
- `POST /api/simulation/seek` ต้องส่ง `start_time` ที่มีจริงในข้อมูล แสดงผลทันทีแล้วพัก; ตรวจรูปแบบ HH:MM และค่าตั้งก่อนเปลี่ยนสถานะ
- `GET /api/simulation/state` คืน `availableTimes` และ `lastResult` พร้อม `chartHistory` เพื่อคืนหน้าจอหลังรีเฟรช
- ประวัติกราฟคำนวณรายแถวจากข้อมูลด้วยค่า transformer/limit/PF ของรอบปัจจุบัน ไม่ใช่การจำลองวงจร MATLAB และไม่ต้องรอเล่นจาก 00:00
- ปุ่มดูช่วงนี้ที่ 18:35 แล้วเล่นต่อจะไป 18:40; รีเซ็ตล้างผลและเริ่มใหม่ที่แถวแรก ตำแหน่งการเล่นอยู่ในหน่วยความจำเซิร์ฟเวอร์
- ทดสอบเวลาเริ่ม/ข้าม/พัก/เล่นต่อ การเปลี่ยนค่าตั้ง ประวัติกราฟ ข้อมูลว่าง เวลาที่ไม่มีจริง และการยกเลิกคำสั่งที่กำลังรอข้อมูล


---

## 17. ตัวอย่างเชื่อมวงจรจากเวลาที่เลือก — 14 พฤศจิกายน 2026

- Dashboard ต้องพักก่อนสร้างรอบทดลองตู้ตัวแทน 50 kW เซิร์ฟเวอร์จับเวลา/กำลัง/จำนวน active/ค่าตั้งจากผลล่าสุด พร้อมตรวจ updatedAt ไม่รับกำลังเป้าหมายจาก client โดยตรง
- หน้า `/circuit?id=...` แยกจากกราฟรายวัน ล็อกเงื่อนไขของรอบไว้ และรัน MATLAB เฉพาะเมื่อผู้ใช้กดรัน ไม่สั่งตามทุก tick ของ Dashboard
- Express `/api/circuit` เชื่อม Flask บน 127.0.0.1:5050 เท่านั้น; MATLAB ต้องแชร์ session `EVChargingLab` งานมี UUID และรับทีละงาน ป้องกันการส่งซ้ำ
- ช่วงทดลอง: เป้าหมาย >0 ถึง 50 kW, แรงดันอ้างอิง 200–1,000 V, กระแสคำสั่งไม่เกิน 125 A, SOC 5–95%, เวลาวงจร 0.2–2 s เป็นข้อจำกัดซอฟต์แวร์ ไม่ใช่พิกัดฮาร์ดแวร์ที่รับรองแล้ว
- ใช้กระแสคงที่ I_ref=P_target*1000/V_reference วงจรเดิมยังไม่มีการจำกัดกำลัง 50 kW; ผลกำลังขึ้นกับแรงดันจริง ต้องแยกค่าอ้างอิงกับค่า Vbat ที่วัดได้
- `run_dashboard_experiment.m` โหลดค่าจาก mlx ใน function workspace ใช้ SimulationInput สำหรับตัวแปรเฉพาะรอบ Variant expression ที่ต้องอยู่ base workspace ถูกคืนค่าเมื่อจบ ไม่บันทึกทับ slx/mlx และไม่เขียนทับ battery ของผู้ใช้
- อ่าน Ibat, Vbat และ DC bus ผ่าน Simscape logging คำนวณ P(t) ด้วยข้อมูลที่ตรงเวลากัน สรุปค่าเฉลี่ยถ่วงเวลาช่วงท้าย 20% พร้อมเกณฑ์ความนิ่งเบื้องต้น และคืนกราฟย่อไม่เกิน 1,200 จุด
- แต่ละรอบเริ่ม SOC ใหม่ ไม่ใช่การจำลอง SOC ต่อเนื่องทั้งวัน ไม่ใช้ผลนี้แทนโหลด AC ของหม้อแปลงโดยตรง และไม่เปลี่ยนสูตรจัดสรรขั้นต่ำ 12 kW
- ผลและ snapshot เก็บในหน่วยความจำ Node/Python จำกัดจำนวน ไม่บันทึกฐานข้อมูล รีสตาร์ตเซิร์ฟเวอร์แล้วต้องเริ่มรอบใหม่ ไม่มีผลวัด fallback


---

## 18. ทดลองตาม load profile บน Dashboard — ปรับปรุง 21 พฤศจิกายน 2026

- ผู้ใช้อนุมัติให้พัฒนาระบบอัตโนมัติหลังสำรองเวอร์ชัน manual ที่ commit `54f6780`
- ที่ `/dashboard?mode=matlab` เลือกเวลาเริ่ม–สิ้นสุด แล้วกดเริ่มครั้งเดียว ระบบอ่านข้อมูลและรันทุกแถวที่มีตู้ตัวแทน active แม้กำลังเป้าหมายคงเดิม ลิงก์หน้าอัตโนมัติเดิมส่งต่อมาที่ Dashboard
- ชุดใหม่เก็บโหลดรายวันพร้อมค่าตั้ง ชุดเก่าเก็บข้อมูลเฉพาะเวลาทดลองและใช้โหลดปัจจุบันประกอบเวลานอกชุดโดยระบุแหล่งที่มา
- คิวเป็นตัวกำหนดเวลา การ์ดโหลด กราฟ และผลวัดใช้ข้อมูลของชุดที่บันทึกไว้ Socket.IO แจ้งเมื่อเปลี่ยนแถวหรือได้รับผล รีเฟรชเว็บแล้วอ่านชุดเดิมได้ โหมดดูโหลดตามเวลายังคงใช้ timer เดิม
- Node อ่านข้อมูล Supabase และเก็บสำเนาโหลด ทะเบียนตู้ และ config ของชุด ใช้สูตรจัดสรรเดิม (สัดส่วน + ขั้นต่ำ 12 kW) ส่งกำลังสุดท้ายของตู้ตัวแทน 50 kW ไม่แก้ข้อมูล Supabaseหรือจำนวน active
- ตัวจัดลำดับงานรอ MATLAB เสร็จก่อนส่งงานถัดไป แยกจาก timer ของ Dashboard ไม่จำลองหลายตู้หรือหลายงานพร้อมกัน ไม่ต้องเปิดหน้าเว็บค้าง
- ยังคงเป็น independent snapshots: ทุกเวลาตั้ง SOC และสถานะวงจรเริ่มต้นใหม่ คำสั่ง I=P×1000/Vref ไม่ใช่การชาร์จต่อเนื่องทั้งวันหรือ power feedback control
- ค่าเริ่มต้นเวลาวงจรในหน้าอัตโนมัติคือ 0.5 s เลือกได้ 0.2–2 s; ไม่เท่ากับช่วงโหลด 5 นาที ไม่ใช้คำนวณ SOC/พลังงานสะสมของทั้งวัน
- เพิ่มสถานะชุด/รายแถว, พักหลังจบรอบ, ทำต่อ, หยุดหลังจบรอบ, กราฟเปรียบเทียบเป้าหมาย/ผล, กราฟ P/V/I รายรอบ และ CSV export
- ข้ามช่วงไม่มี active โดยไม่รันวงจร คงสถานะ LIMITED และส่วนเกินหม้อแปลงไว้แม้วงจรรันสำเร็จ; ความนิ่งช่วงท้ายไม่ใช่เงื่อนไขที่ปกปิดผลหรือการรับรองวงจร
- ผลชุดอัตโนมัติเก็บถาวรในเครื่อง `runtime-data/circuit-batches/` เป็น JSON ใน `.snapshot` (ไม่อยู่ใน Git) ต่างจากหน้า manual ที่เก็บผลชั่วคราวในหน่วยความจำ
- เมื่อ Node รีสตาร์ต ชุดที่ค้างจะพักและตรวจรหัสงานเดิมเมื่อกดทำต่อ หากไม่พบงานเดิมใน Python จะไม่รันซ้ำอัตโนมัติ; รอบที่ยืนยันว่าล้มเหลวจะคงสถานะนั้นและข้ามเมื่อผู้ใช้กดทำต่อ
- ความผิดพลาด/เครือข่ายหลุดทำให้คิวพัก ไม่มีผลวัด fallback; กรณีรอนานเกิน 10 นาทีพักโดยไม่ส่งงานใหม่และตรวจงานเดิมเมื่อทำต่อ
- ยังไม่เปลี่ยนวงจรเป็น power feedback, ไม่เพิ่ม physical 50 kW limiter, ไม่ส่ง DC power กลับไปแทน AC load และไม่แก้ PF/η ในงานนี้
- ควรพักชุดให้จบรอบก่อนแก้ slx/mlx และสร้างชุดใหม่เมื่อเปลี่ยนค่าตั้งวงจร เพื่อไม่ผสมผลจากคนละสภาพวงจร
- `npm test` ครอบคลุมลำดับงาน พัก/ทำต่อ/หยุด ข้าม inactive ขอบเขต inputs การกู้หลังรีสตาร์ต ผลผิดพลาด และการตอบกลับสูญหายโดยไม่ส่งซ้ำ

## ห้องทดลองอุณหภูมิหม้อแปลง

หน้า `/thermal` ทดลองสถานการณ์ A–D ของ Daihen PP0827A01 ตาม Thermal_Simulation_Scenarios แยกจาก Dashboard รายวัน ผู้ใช้กำหนดอากาศ ภาระ และขั้นระบายความร้อนในหน้านี้ ใช้ Chart.js และคำนวณในเบราว์เซอร์ แบบจำลองไม่อ่าน load profile, CSV ผลทดลองตู้ หรือเรียก MATLAB และไม่ส่งผลกลับไปที่ตัวจัดสรรกำลัง

## บัญชีสำหรับเข้าสู่ระบบ

ผู้ใช้ทุกคนใช้บัญชีร่วมหนึ่งบัญชีและใช้ทุกฟังก์ชันได้หลังเข้าสู่ระบบที่ `/login` ตั้ง `APP_USERNAME` และ `APP_PASSWORD` ในไฟล์ .env บนเครื่อง หรือใน Variables ของ Railway ก่อน deploy รุ่นที่มี Login เก็บรหัสผ่านเฉพาะฝั่งเซิร์ฟเวอร์ เซสชันสิ้นสุดเมื่อออกจากระบบ ครบ 8 ชั่วโมง หรือเซิร์ฟเวอร์รีสตาร์ต การสาธิตใช้เซิร์ฟเวอร์หนึ่ง instance
