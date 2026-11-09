# PROJECT BRIEF: ระบบจำลองการจัดการพลังงานสำหรับสถานีชาร์จ EV

## สำหรับ Claude Code
อ่านไฟล์นี้ทั้งหมดก่อนเริ่มทำงาน ไฟล์นี้คือ spec ที่ตกลงกันไว้แล้วทั้งหมด ห้ามเปลี่ยน concept หลักโดยไม่ถามก่อน

---

## 1. ภาพรวมโปรเจค

### ปัญหา
เมื่อมีรถ EV เข้ามาชาร์จพร้อมกันจำนวนมาก โหลดรวมของสถานีชาร์จอาจทำให้หม้อแปลงไฟฟ้ากำลังรับภาระเกินขีดจำกัด เกิดภาวะ Overload และเสี่ยงต่อการจ่ายไฟไม่เสถียรหรือความเสียหายของหม้อแปลง

### แนวทางของระบบ
ระบบจำลอง Energy Management สำหรับสถานีชาร์จ EV จะอ่านข้อมูลโหลดรายช่วงเวลา ตรวจสอบภาระรวมของหม้อแปลง และเมื่อเกิด Overload จะคำนวณการลดกำลังชาร์จของตู้ที่กำลังใช้งาน พร้อมแปลงเป็นค่า PWM สำหรับแสดงผลบน Dashboard แบบ Realtime

### สิ่งที่ระบบทำใน Phase ปัจจุบัน
1. ผู้ใช้อัปโหลด CSV 2 ไฟล์ผ่านหน้าเว็บ: `chargers.csv` และ `load_pattern.csv`
2. Frontend แสดง preview ข้อมูลทั้งหมดก่อนบันทึก
3. Backend parse/validate CSV แล้วล้างข้อมูลเก่าและบันทึกข้อมูลใหม่ลง Supabase
4. Dashboard กดเริ่มจำลอง แล้ว Backend อ่านข้อมูลจาก Supabase ทีละ record ตามเวลา
5. Backend คำนวณ Base load, EV load, Total load, สถานะระบบ, การลดกำลัง และ PWM
6. Dashboard แสดงผล Realtime ผ่าน socket.io: metric cards, stacked chart, ตารางตู้ชาร์จ, ค่า PWM

### Phase ถัดไป
เชื่อมต่อ ESP32 ผ่าน Wi-Fi เพื่อดึงค่าล่าสุดจาก Backend แล้วแสดงสถานะโหลดและค่า PWM บนจอ LCD 16x2 I2C สำหรับ demo ให้อาจารย์ดู รายละเอียดอยู่ใน `HARDWARE.md`

---

## 2. Technology Stack ปัจจุบัน

| ส่วน | ใช้จริงตอนนี้ | หมายเหตุ |
|---|---|---|
| Runtime | Node.js / Express.js | ใช้ ES Module ทั้งโปรเจค |
| Frontend | HTML / CSS / JavaScript | serve static ผ่าน Express |
| Chart | Chart.js CDN | ใช้ stacked area chart |
| Realtime | socket.io | ส่ง `simulation:update` |
| File Upload | multer | รับ CSV 2 ไฟล์ |
| CSV Parse | csv-parse | parse + validate |
| Database | Supabase PostgreSQL | ใช้ service role key เฉพาะ backend |
| Dev tools | nodemon, morgan | `npm run p` สำหรับ dev |
| Hardware demo | ESP32 DevKit + LCD 16x2 I2C | ใช้ Wi-Fi ดึงข้อมูลจาก backend ผ่าน HTTP polling |

---

## 3. CSV Design ที่ใช้จริง

โปรเจคนี้ใช้วิธีให้ผู้ใช้มีไฟล์ CSV ในเครื่อง แล้วอัปโหลดผ่านหน้าเว็บ ไม่เก็บไฟล์ CSV ไว้ใน repo

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
- Control: transformer MVA, load limit, power factor, speed, start/pause/reset
- Metric: เวลา, โหลดรวมเป็น kVA, โหลดพื้นฐานเป็น kVA, สถานะระบบ
- Chart: stacked area chart
  - Base load เป็นพื้นที่สีน้ำเงิน
  - EV load เป็นพื้นที่สีแดงที่ต่อขึ้นจาก base load
  - เส้น limit เป็นเส้นประสีแดง
  - ไม่มีเส้นโหลดรวมแยก เพราะพื้นที่ซ้อนกันแสดงโหลดรวมโดยธรรมชาติแล้ว
- PWM card แสดง PWM, voltage, simulated kW
- ตารางโหลดตู้ชาร์จแยกตามประเภท

### หน้า `formulas.html`
- อธิบายสูตร P, Q, S และ Power Factor
- อธิบายการแปลง EV load จาก kW เป็น kVA
- อธิบายการตรวจ Overload ของหม้อแปลงด้วย apparent power
- อธิบายการลดกำลังและ PWM simulation

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

### การลดกำลังเมื่อ Overload
เมื่อโหลดรวมเกินขีดจำกัด ระบบจะคำนวณกำลังที่ต้องลดรวม:

```text
over_limit_kVA = total_S_kVA - load_limit_kVA
over_limit_kW = over_limit_kVA x power_factor
total_active_chargers = sum(active ทุกขนาด)
reduce_per_charger_kW = over_limit_kW / total_active_chargers
```

จากนั้นลดกำลังของตู้แต่ละขนาดเท่ากันเป็น kW ต่อหัว:

```text
min_charger_power_kW = 20
new_power_kW = max(min_charger_power_kW, original_power_kW - reduce_per_charger_kW)
new_power_percent = (new_power_kW / original_power_kW) x 100
```

ข้อควรรู้:
- วิธีนี้เป็น equal kW reduction ต่อ active charger
- ตู้ EV Charger ที่ยังเปิดชาร์จต้องไม่ถูกลดต่ำกว่า 20 kW เพราะต่ำกว่านี้ถือว่าไฟไม่เข้ารถในโมเดล demo
- ถ้าตู้ขนาดเล็กชนขั้นต่ำ 20 kW ก่อน ระบบจะกระจายส่วนที่ลดไม่ได้ไปยังตู้ขนาดใหญ่ที่ยังมี headroom ต่อ
- ถ้าลดจนทุกตู้ถึงขั้นต่ำ 20 kW แล้วยังไม่พอ ระบบจึงรายงาน `control_limited` และส่วนที่ยังลดไม่ได้ (`unmet_reduction_kW`)
- เป็นโมเดลจำลองที่เข้าใจง่าย ไม่ใช่ optimal load allocation
- ในอนาคตอาจปรับเป็น proportional reduction ตามขนาดตู้, priority-based control หรือแยก PF ของโหลดแต่ละประเภทได้

### PWM สำหรับจำลอง hardware
ระบบจำลองเลือกตู้ 50 kW เป็นแหล่งอ้างอิงหลัก หากไม่มีจะใช้ตู้ขนาดแรกที่พบ

```text
pwm = round((new_power_kW / original_power_kW) x 255)
voltage = (pwm / 255) x 5
watt_sim_kW = (pwm / 255) x original_power_kW
```

ตัวอย่าง:
```text
original_power = 50 kW
new_power = 31.5 kW
pwm = (31.5 / 50) x 255 = 161
voltage = (161 / 255) x 5 = 3.16 V
```

---

## 7. โครงสร้างโฟลเดอร์ปัจจุบัน

```text
ev-charging-simulation/
├── CLAUDE.md
├── AGENTS.md
├── HARDWARE.md                       # แผน hardware demo จากอุปกรณ์จริง
├── package.json
├── package-lock.json
├── .env                              # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
├── .env.example
├── .gitignore
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
    │   ├── pwm.service.js            # PWM calculation
    │   └── simulation.service.js     # realtime loop
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
- Calculation logic dynamic ตามขนาดตู้
- Power Factor input ปรับได้บน Dashboard และใช้คำนวณ kW/kVA/kVAr
- PWM simulation บนเว็บ
- UI ภาษาไทยแบบ minimal พร้อมโลโก้ SPU และข้อมูลโครงงาน
- Chart แบบ stacked Base load + EV load พร้อมเส้น limit
- หน้า formulas อธิบายสูตร P, Q, S, PF, Overload และ PWM
- เพิ่ม `HARDWARE.md` สำหรับ Phase hardware demo ด้วย ESP32 + LCD 16x2 I2C
- Clear database แล้ว simulation cache ถูก reset
- ไม่มี local CSV fallback ใน production flow

### ต้องทำต่อ
1. ทดสอบ demo flow แบบเต็มตั้งแต่ upload -> start simulation -> overload -> PWM ลดลง
2. เตรียมชุด CSV สำหรับนำเสนอให้อาจารย์ แยกเก็บนอก repo
3. เพิ่ม validation เชิงลึก: active chargers ต้องไม่เกิน total units
4. เพิ่ม message บน Dashboard เมื่อยังไม่มีข้อมูลใน Supabase
5. Deploy บน Railway/Render
6. Phase hardware demo: เพิ่ม endpoint `GET /api/hardware/latest` สำหรับให้ ESP32 อ่านค่าล่าสุด
7. เขียน firmware ESP32: เชื่อม Wi-Fi, HTTP polling, parse JSON, แสดงผลบน LCD 16x2 I2C
8. ทดสอบ I2C address ของ LCD (`0x27` หรือ `0x3F`) และทดสอบไฟเลี้ยง 3.3V/5V อย่างระวัง
9. ถ้าต้องการความแม่นยำเชิงไฟฟ้าเพิ่ม: เพิ่ม voltage level, current calculation, PF แยกตามโหลด และ control strategy แบบ proportional/priority

---

## 9. คำสั่งใช้งาน

```bash
npm install
npm run p
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
