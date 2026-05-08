# PROJECT BRIEF: ระบบจำลองการจัดการพลังงานสำหรับการชาร์จยานยนต์ไฟฟ้า

## สำหรับ Claude Code
อ่านไฟล์นี้ทั้งหมดก่อนเริ่มทำงาน ไฟล์นี้คือ spec ที่ตกลงกันไว้แล้วทั้งหมด ห้ามเปลี่ยนแปลง concept หลักโดยไม่ถามก่อน

---

## 1. ภาพรวมโปรเจค

### ปัญหา
เมื่อมีรถ EV มาชาร์จพร้อมกันมากๆ หม้อแปลงรับภาระไม่ไหว -> Overload -> ไฟดับ/หม้อแปลงเสียหาย

### วิธีแก้
ระบบอัจฉริยะที่ตรวจจับ Overload แล้วลดกระแสชาร์จแต่ละตู้ลงอัตโนมัติ เพื่อไม่ให้เกินขีดจำกัดของหม้อแปลง

### สิ่งที่ระบบทำ
1. ผู้ใช้อัพโหลด CSV 2 ไฟล์ (ข้อมูลตู้ชาร์จ + ข้อมูลโหลดช่วงเวลา) -> preview -> บันทึกลง Supabase
2. Dashboard กด Play -> Backend อ่านจาก Supabase ทีละ record ทุก 2 วินาที -> คำนวณ load, ตรวจ overload
3. ถ้า overload -> คำนวณว่าต้องลดกระแสแต่ละตู้เท่าไหร่ -> คำนวณ PWM
4. แสดงผลบน Dashboard แบบ real-time (กราฟ + ตาราง + ค่า PWM)
5. (Phase 2) ส่ง PWM ไป Arduino จำลอง hardware

---

## 2. Technology Stack

| ส่วน | เลือกใช้ | npm package |
|------|---------|-------------|
| Runtime | Node.js / Express.js | express |
| Frontend | HTML / CSS / JS | - |
| กราฟ | Chart.js | chart.js (CDN) |
| Real-time | WebSocket | socket.io (มีแล้ว) |
| File Upload | multer | multer |
| Database | Supabase (PostgreSQL cloud) | @supabase/supabase-js |
| CSV Parse | csv-parse | csv-parse (มีแล้ว) |
| Dev Tools | nodemon + morgan | (มีแล้ว) |
| Arduino (Phase 2) | USB Serial | serialport |

---

## 3. CSV Design (2 ไฟล์ที่ต้อง upload)

### ไฟล์ 1: chargers.csv - ทะเบียนตู้ชาร์จ
```csv
charger_kW,total_units
50,300
150,50
```

### ไฟล์ 2: load_pattern.csv - ข้อมูลจำลอง 24 ชม.
```csv
time,base_load_percent,active_50kW,active_150kW
00:00,35,10,3
00:05,34,12,5
06:00,55,45,10
12:00,60,135,30
18:00,75,200,45
23:55,40,15,4
```

- time -> เวลา HH:MM ทุก 5 นาที (288 records ต่อวัน)
- base_load_percent -> ภาระพื้นฐาน (%) เปลี่ยนตามเวลา (กลางคืน 30-40%, เย็น 70-80%)
- active_[ขนาด]kW -> จำนวนตู้ที่มีรถชาร์จ ณ เวลานั้น
- Backend อ่าน 1 record ทุก 2 วินาที -> demo ยาว ~10 นาที

---

## 4. Database (Supabase)

### Table: chargers
| column | type | description |
|--------|------|-------------|
| id | serial PK | auto |
| charger_kw | integer | ขนาดตู้ kW |
| total_units | integer | จำนวนตู้ |
| uploaded_at | timestamp | เวลา upload |

### Table: load_patterns
| column | type | description |
|--------|------|-------------|
| id | serial PK | auto |
| time_slot | varchar | เวลา HH:MM |
| base_load_percent | decimal | ภาระพื้นฐาน % |
| charger_data | jsonb | {"active_50kW": 200, "active_150kW": 45} |
| uploaded_at | timestamp | เวลา upload |

### Flow
Upload CSV -> Node.js parse -> ล้างข้อมูลเก่า -> INSERT ลง Supabase
Dashboard กด Play -> SELECT ทีละ record ORDER BY time_slot

---

## 5. Frontend (2 หน้า)

### หน้าที่ 1: Upload CSV + ตั้งค่า

**ส่วนตั้งค่าหม้อแปลง:**
- พิกัดหม้อแปลง (MVA) -> default 50 MVA (ปรับได้)
- ขีดจำกัด (%) -> default 80% (ปรับได้)

**ส่วน Upload:**
- Upload chargers.csv -> แสดง preview ตาราง (column + ข้อมูล)
- Upload load_pattern.csv -> แสดง preview ตาราง (column + ข้อมูล)
- กด Confirm -> parse + INSERT ลง Supabase
- กด Clear -> ล้างข้อมูลใน Supabase

**Design:** สวย เรียบง่าย ใช้งานง่าย

### หน้าที่ 2: Dashboard (หน้าหลัก)

**ค่าที่แสดง:**
- เวลาปัจจุบัน (จาก record)
- ภาระพื้นฐาน (kW, %)
- ภาระ EV รวม (kW) แยกตามขนาดตู้
- ภาระรวมทั้งหมด (kW, %)
- สถานะ: NORMAL (เขียว) / WARNING (เหลือง) / OVERLOAD (แดง)
- กำลังที่เกิน (kW) ถ้า overload
- กำลังที่ถูกลดต่อตู้ (kW) ถ้า overload

**ตารางตู้ชาร์จ (รายประเภท):**
- แต่ละขนาด: เช่น 50kW ใช้ 200/300 ตู้, 150kW ใช้ 45/50 ตู้
- กำลังเต็ม / กำลังที่ถูกลด
- Design สวย ดูง่าย

**ค่า PWM (แสดงบนเว็บ):**
- PWM (0-255), แรงดันจำลอง (0-5V), กำลังจำลอง (kW)
- แสดงเป็น gauge หรือ bar

**กราฟ (Chart.js):**
- กราฟภาระรวม 24 ชม. + เส้นขีดจำกัด 80% + ตำแหน่งปัจจุบัน
- กราฟกำลังไฟฟ้า (kW) / กระแส (A) / แรงดัน (V)

**ควบคุม:**
- Play / Pause / Reset
- ความเร็ว: 1x (2 วิ) / 2x (1 วิ) / 5x (0.4 วิ)

---

## 6. Backend Logic

### การคำนวณ (ทุก record)
```
transformer_kW = transformer_MVA x 1000
base_load_kW = transformer_kW x (base_load_percent / 100)
load_limit_kW = transformer_kW x (limit_percent / 100)
ev_load_kW = sum(active_[size] x size) ทุกขนาด
total_load_kW = base_load_kW + ev_load_kW
total_load_percent = (total_load_kW / transformer_kW) x 100

if total_load_percent > 80 -> OVERLOAD
if total_load_percent > 70 -> WARNING
else -> NORMAL
```

### เมื่อ Overload
```
over_limit_kW = total_load_kW - load_limit_kW
reduce_per_charger = over_limit_kW / total_active_chargers
new_power = original_power - reduce_per_charger
```

### คำนวณ PWM
```
pwm = (new_power / original_power) x 255
voltage = (pwm / 255) x 5V
watt_sim = (pwm / 255) x original_power_kW
```

---

## 7. โครงสร้างโฟลเดอร์
```
ev-charging-simulation/
├── CLAUDE.md
├── package.json
├── .env                              ← SUPABASE_URL, SUPABASE_KEY
├── .gitignore
├── src/
│   ├── app.js                        ← Express + socket.io setup
│   ├── server.js                     ← เปิด port, start server
│   ├── routes/
│   │   ├── index.js
│   │   ├── upload.routes.js
│   │   └── simulation.routes.js
│   ├── controllers/
│   │   ├── upload.controller.js
│   │   └── simulation.controller.js
│   ├── services/
│   │   ├── db.service.js             ← Supabase client + CRUD
│   │   ├── csv.service.js
│   │   ├── calculation.service.js
│   │   └── simulation.service.js
│   ├── middleware/
│   │   ├── errorHandler.js
│   │   └── validate.js
│   ├── config/
│   │   └── index.js
│   └── public/
│       ├── upload.html
│       ├── dashboard.html
│       ├── css/style.css
│       └── js/
│           ├── upload.js
│           └── dashboard.js
├── data/
│   ├── sample_chargers.csv
│   └── sample_load_pattern.csv
└── arduino/                          ← Phase 2
    └── ev_pwm_controller.ino
```

---

## 8. ลำดับการทำงาน

### Phase 1: Software + แสดง PWM บนเว็บ
```
Step 1: ✅ Setup โปรเจค + Express server
Step 2: ✅ Local CSV + อ่านข้อมูลได้
Step 3: ✅ Calculation logic
Step 4: Setup Supabase + สร้าง tables
Step 5: หน้า Upload CSV (upload -> preview -> save ลง Supabase)
Step 6: WebSocket ส่งข้อมูล real-time
Step 7: Dashboard แสดงผล (กราฟ + ตาราง + ค่า PWM)
Step 8: Deploy (Railway/Render)
```

### Phase 2: Hardware (ทำทีหลัง)
```
Step 9: Arduino sketch รับ PWM
Step 10: เชื่อม Node.js -> serialport -> Arduino
Step 11: ออกแบบ hardware (LED Bar, OLED, ฯลฯ)
```

---

## 9. สถานะปัจจุบัน

### ✅ เสร็จแล้ว
- ES Module ตลอดทั้งโปรเจค ("type": "module")
- Express + socket.io + middleware + routes
- config/index.js อ่าน .env
- csv.service.js อ่าน CSV + parse
- calculation.service.js คำนวณ load/overload/PWM (dynamic ทุกขนาดตู้)
- เกณฑ์: >80% = OVERLOAD, >70% = WARNING
- Packages: express, socket.io, dotenv, csv-parse, nodemon, morgan
- คำสั่งรัน: npm run p

### ⬜ ต้องทำต่อ
Step 4-8 (Phase 1)

---

## 10. ข้อตกลงการทำงานร่วมกัน
- ทำทีละ step ไม่กระโดด
- อธิบายสั้นๆ ว่าโค้ดทำอะไร ทำไม
- ทำเสร็จ -> ทดสอบ -> ไปต่อ
- ไม่แน่ใจ -> ถามก่อน
- ตกลงอะไรได้ -> เพิ่มลง CLAUDE.md
- เจ้าของสั่ง AI ทำเป็นหลัก เน้นเสร็จทัน deadline
- Frontend ให้ออกแบบสวย ดู professional

---

## 11. GitHub Repository
https://github.com/Pat10504/EV-Changing-Simulation.git
