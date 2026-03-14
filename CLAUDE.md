# PROJECT BRIEF: ระบบจำลองการจัดการพลังงานสำหรับการชาร์จยานยนต์ไฟฟ้า

## สำหรับ Claude Code
อ่านไฟล์นี้ทั้งหมดก่อนเริ่มทำงาน ไฟล์นี้คือ spec ที่ตกลงกันไว้แล้วทั้งหมด ห้ามเปลี่ยนแปลง concept หลักโดยไม่ถามก่อน

---

## 1. ภาพรวมโปรเจค

### ปัญหา
เมื่อมีรถ EV มาชาร์จพร้อมกันมากๆ หม้อแปลงรับภาระไม่ไหว → Overload → ไฟดับ/หม้อแปลงเสียหาย

### วิธีแก้
ระบบอัจฉริยะที่ตรวจจับ Overload แล้วลดกระแสชาร์จแต่ละตู้ลงอัตโนมัติ เพื่อไม่ให้เกินขีดจำกัดของหม้อแปลง

### สิ่งที่ระบบทำ
1. ผู้ใช้ตั้งค่าตู้ชาร์จ (จำนวน, ขนาด, ช่วงเวลาใช้งาน) ผ่าน frontend → save ลง CSV บน Google Sheets
2. Dashboard อ่าน CSV ทีละ record ทุก 2 วินาที → คำนวณ load, ตรวจ overload
3. ถ้า overload → คำนวณว่าต้องลดกระแสแต่ละตู้เท่าไหร่
4. แสดงผลบน Dashboard + ส่ง PWM ไป Arduino จำลอง hardware

---

## 2. Technology Stack

### ตัดสินใจแล้ว
- **Backend + Server:** Node.js / Express.js (ไม่ใช่ Python)
- **Frontend:** HTML/CSS/JS (serve ผ่าน Express)
- **Data Storage:** CSV บน Google Sheets (publish เป็น CSV URL)
- **Real-time:** WebSocket (socket.io)
- **Hardware Communication:** serialport npm package → Arduino ผ่าน USB Serial
- **Hardware:** Arduino (ไม่ใช่ ESP32 หรือ Raspberry Pi)
- **Deploy:** Railway หรือ Render (ส่วน web), Local (ส่วน Arduino)

### ทำไมเลือก Node.js/Express แทน Python/Flask
- เจ้าของโปรเจคกำลังเรียน Node.js/Express อยู่
- socket.io เหมาะกับ real-time dashboard
- serialport npm ใช้คุยกับ Arduino ได้

---

## 3. CSV Design

### ไฟล์เดียวบน Google Sheets
ผู้ใช้สร้างจาก frontend ทั้งหมด ไม่ได้ generate จาก script

### โครงสร้าง CSV (1 แถว = 1 time slot)

```csv
time, active_50kW, active_150kW
00:00, 10, 3
00:05, 12, 5
00:10, 8, 2
...
19:00, 200, 45
...
23:55, 15, 4
```

- **time** → เวลา HH:MM ทุก 5 นาที
- **active_[ขนาด]kW** → จำนวนตู้ที่มีรถชาร์จ ณ เวลานั้น ของแต่ละขนาด
- คอลัมน์จะเพิ่ม/ลดตามขนาดตู้ที่ผู้ใช้ตั้ง เช่น ถ้าเพิ่มตู้ 100kW → เพิ่มคอลัมน์ active_100kW
- **288 records** ต่อวัน (24 ชม. × 12 records/ชม.)
- backend อ่าน **1 record ทุก 2 วินาที** → demo ยาว ~10 นาที

### การจัดการ CSV
- **เพิ่ม:** ผู้ใช้ตั้งค่าบน frontend → กด Save → insert records ลง CSV
- **ลบ/ล้าง:** ผู้ใช้กด Clear → ล้าง CSV ทั้งไฟล์
- **แก้ไข:** ตั้งค่าใหม่ → ล้างของเก่า → save ใหม่
- **Fallback:** ถ้า fetch Google Sheets ไม่ได้ → อ่าน local CSV แทน

---

## 4. Frontend (2 หน้า)

### หน้าที่ 1: ตั้งค่า (Configuration Page)

**ส่วนตั้งค่าหม้อแปลง:**
- พิกัดหม้อแปลง (MVA) → default 50 MVA
- ภาระพื้นฐาน (%) → default 65% (ปรับได้ เช่น 50-70%)
- ขีดจำกัด (%) → default 80%

**ส่วนจัดการตู้ชาร์จ:**
- เพิ่มตู้: เลือกขนาด (dropdown: 50 / 100 / 120 / 150 / 200 kW) + จำนวนตู้
- ขนาดตู้ DC Fast Charger ที่มีจริงในไทย: 25, 50, 100, 120, 150, 180, 200 kW
- แสดงรายการตู้ที่เพิ่มแล้ว ลบได้

**ส่วนตั้งค่า usage pattern:**
- ตั้งเป็นช่วง เช่น "50kW ช่วง 18:00-21:00 ใช้ 200 ตู้จาก 300 ตู้"
- ระบบ generate records ทุก 5 นาทีให้อัตโนมัติ
- ต้องตั้งให้ครบ 24 ชม. (288 records) ก่อน save

**ปุ่ม:**
- Save → บันทึกลง CSV บน Google Sheets
- Clear → ล้าง CSV
- ไปหน้า Dashboard

### หน้าที่ 2: Dashboard (Simulation Page)

**ค่าที่แสดง:**
- เวลาปัจจุบัน (จาก CSV)
- ภาระพื้นฐาน (kW)
- ภาระ EV รวม (kW) แยกตามขนาดตู้
- ภาระรวมทั้งหมด (kW และ %)
- สถานะ: NORMAL (เขียว) / WARNING (เหลือง) / OVERLOAD (แดง)
- กำลังที่เกินขีดจำกัด (kW) ถ้า overload
- กำลังที่ถูกลดต่อตู้ (kW) ถ้า overload
- ค่า PWM ที่ส่งไป Arduino

**กราฟ:**
- กราฟภาระรวมตลอด 24 ชม. (แสดงเส้นขีดจำกัด 80%)
- เส้นแสดงตำแหน่งปัจจุบัน

**ควบคุม:**
- ปุ่ม Play / Pause / Reset
- ปรับความเร็ว: 1x (2 วิ) / 2x (1 วิ) / 5x (0.4 วิ)
- Skip ไปช่วง Peak ได้

---

## 5. Backend Logic (Node.js/Express)

### การอ่าน CSV
```
ทุก 2 วินาที:
1. อ่าน 1 record จาก CSV (1 แถว = 1 time slot)
2. แยกค่า active ของแต่ละขนาดตู้
```

### การคำนวณ (ทุก record)
```
// ค่าจาก frontend config
transformer_kW = transformer_MVA × 1000        // เช่น 50 × 1000 = 50,000 kW
base_load_kW = transformer_kW × base_load_%    // เช่น 50,000 × 0.65 = 32,500 kW
load_limit_kW = transformer_kW × limit_%       // เช่น 50,000 × 0.80 = 40,000 kW

// คำนวณจาก CSV record
ev_load_kW = sum(active_[size] × size) สำหรับทุกขนาดตู้
// เช่น (200 × 50) + (45 × 150) = 10,000 + 6,750 = 16,750 kW

total_load_kW = base_load_kW + ev_load_kW
total_load_% = (total_load_kW ÷ transformer_kW) × 100

// ตรวจสถานะ
if total_load_% > 90 → OVERLOAD
if total_load_% > 80 → WARNING
else → NORMAL
```

### การคำนวณเมื่อ Overload
```
over_limit_kW = total_load_kW - load_limit_kW
total_active = sum(active ทุกขนาด)
reduce_per_charger_kW = over_limit_kW ÷ total_active

// สำหรับแต่ละขนาดตู้
new_power_kW = original_power_kW - reduce_per_charger_kW
new_power_% = (new_power_kW ÷ original_power_kW) × 100
```

### การคำนวณ PWM (สำหรับ Arduino จำลอง 1 ตู้)
```
// สมมติจำลองตู้ 50 kW
if NORMAL:
    pwm = 255                        // เต็มที่
else if OVERLOAD:
    pwm = (new_power_kW ÷ 50) × 255 // ลดลงตามสัดส่วน

voltage = (pwm ÷ 255) × 5V          // แรงดันจำลอง
watt_sim = (pwm ÷ 255) × 50kW       // กำลังจำลอง
```

### การส่ง PWM ไป Arduino
```javascript
const { SerialPort } = require('serialport');
const port = new SerialPort({ path: 'COM3', baudRate: 9600 }); // หรือ /dev/ttyUSB0 บน Mac

// ส่งค่า PWM
port.write(`${pwm}\n`);
```

---

## 6. Arduino Code (รับ PWM แสดงผล)

```cpp
int ledPin = 9;  // PWM pin

void setup() {
    Serial.begin(9600);
    pinMode(ledPin, OUTPUT);
}

void loop() {
    if (Serial.available() > 0) {
        int pwm = Serial.parseInt();
        analogWrite(ledPin, pwm);     // LED แสดงสัดส่วนกำลัง
    }
}
```

### การเทียบสัดส่วน (Down Scale)
```
ระบบจริง          สัดส่วน    Arduino จำลอง
50 kW (100%)  →   100%   →   5V / PWM 255
31.5 kW (63%) →   63%    →   3.15V / PWM 161
25 kW (50%)   →   50%    →   2.5V / PWM 128
```

---

## 7. Google Sheets Setup

### วิธีใช้
1. สร้าง Google Sheets
2. File → Share → Publish to web → เลือก CSV → ได้ URL
3. Node.js fetch URL นั้นตรงๆ

### Fallback
ถ้า internet มีปัญหา → อ่าน local CSV ใน /data/ folder แทนอัตโนมัติ

---

## 8. Deploy Plan

```
Cloud (Railway/Render):          เครื่อง Local (ตอน demo):
├── Node.js/Express              ├── Node.js script
├── อ่าน Google Sheets CSV       ├── ดึงข้อมูลจาก server
├── คำนวณ load/overload          ├── ส่ง PWM ผ่าน Serial
├── API + WebSocket              └── Arduino รับ → LED
└── Dashboard หน้าเว็บ
    ↓
เปิดดูผ่าน URL ได้
```

---

## 9. โครงสร้างโฟลเดอร์ (เบื้องต้น)

```
ev-charging-simulation/
├── BRIEF.md                    ← ไฟล์นี้
├── package.json
├── .env                        ← Google Sheets URL, Serial port
├── src/
│   ├── app.js                  ← Express server หลัก
│   ├── routes/
│   │   ├── config.js           ← API สำหรับหน้าตั้งค่า
│   │   └── dashboard.js        ← API สำหรับ dashboard
│   ├── services/
│   │   ├── csvService.js       ← อ่าน/เขียน CSV (Google Sheets + local fallback)
│   │   ├── calculationService.js ← คำนวณ load, overload, PWM
│   │   └── serialService.js    ← คุยกับ Arduino ผ่าน Serial
│   └── public/
│       ├── index.html          ← หน้าตั้งค่า
│       ├── dashboard.html      ← หน้า Dashboard
│       ├── css/
│       └── js/
├── data/
│   └── ev_charging_backup.csv  ← local CSV fallback
└── arduino/
    └── ev_pwm_controller.ino   ← Arduino sketch
```

---

## 10. ลำดับการทำงาน (Priority)

1. **ตั้ง Google Sheets + CSV structure** → ทดสอบ fetch ได้
2. **หน้าตั้งค่า** → เพิ่มตู้, ตั้ง pattern, save ลง CSV
3. **Backend calculation** → อ่าน CSV, คำนวณ load/overload
4. **Dashboard** → แสดงผล real-time ด้วย WebSocket
5. **Arduino Serial** → ส่ง PWM จำลอง hardware
6. **Deploy** → ขึ้น Railway/Render

---

## 11. ข้อมูลอ้างอิง

### ขนาดตู้ DC Fast Charger ที่มีจริงในไทย
- Delta: 25, 50, 100, 150, 200 kW
- Teison: 30, 120 kW
- Wallbox Supernova: 60-150 kW
- EA Anywhere / Shell: 180 kW
- ต่างประเทศ: สูงสุด 350 kW (Electrify America Hyper-Fast)

### หม้อแปลง
- โปรเจคนี้ใช้ 50 MVA = 50,000 kW
- ขีดจำกัด default 80% = 40,000 kW
- ภาระพื้นฐาน default 65% = 32,500 kW (บ้าน, โรงงาน, อื่นๆ ในพื้นที่)

### PWM
- Arduino 8-bit: 0-255
- 0 = ปิด, 255 = เต็มที่
- แรงดัน output: 0-5V
- สูตร: PWM = (กำลังใหม่ ÷ กำลังเต็ม) × 255

---

## 12. หมายเหตุสำคัญ

- **โปรเจคนี้เจ้าของสั่ง AI ทำเป็นหลัก** ไม่ต้องสอน syntax ทีละบรรทัด แต่อธิบายสั้นๆ ว่าแต่ละส่วนทำอะไร ทำไม พอ present ได้
- **เจ้าของโปรเจคมีพื้นฐาน:** BA ทำ web systems ให้หน่วยงานรัฐ, เขียน SQL, กำลังเรียน Node.js/Express, มีพื้นฐาน Arduino
- **ต้องมี deadline ส่ง** → เน้นทำให้เสร็จ ไม่ต้อง perfect
- **ถ้าไม่แน่ใจอะไร ให้ถามก่อนทำ**

---

## 13. ข้อตกลงการทำงานร่วมกัน (Working Agreement)

### แนวทาง
- ทำทีละ step เล็กๆ ไม่กระโดด
- อธิบายสั้นๆ ว่าโค้ดทำอะไร ทำไม — ไม่สอน syntax ทีละบรรทัด
- ทำเสร็จแต่ละ step → ทดสอบให้ผ่านก่อน → ค่อยไปต่อ
- ถ้าไม่แน่ใจ ถามก่อนทำเสมอ
- **ทุกครั้งที่คุยและตกลงอะไรกันได้ → เพิ่มลงใน CLAUDE.md เพื่อให้ session ใหม่ทำต่อได้**

### โครงสร้างโฟลเดอร์ที่ตกลงกัน

```
ev-charging-simulation/
├── package.json
├── .env                              ← SHEETS_URL, SERIAL_PORT
├── .gitignore
│
├── src/
│   ├── app.js                        ← Express + socket.io setup
│   ├── server.js                     ← เปิด port, start server
│   │
│   ├── routes/
│   │   ├── index.js                  ← รวม routes ทั้งหมด
│   │   ├── config.routes.js
│   │   └── simulation.routes.js
│   │
│   ├── controllers/
│   │   ├── config.controller.js      ← รับ req/res, เรียก service
│   │   └── simulation.controller.js
│   │
│   ├── services/
│   │   ├── csv.service.js            ← อ่าน/เขียน CSV (local + Google Sheets fallback)
│   │   ├── calculation.service.js    ← คำนวณ load, overload, PWM
│   │   ├── simulation.service.js     ← loop ทุก 2 วิ, ส่งผ่าน WebSocket
│   │   └── serial.service.js         ← ส่ง PWM ไป Arduino
│   │
│   ├── middleware/
│   │   ├── errorHandler.js           ← จับ error ทุกตัวไว้ที่เดียว
│   │   └── validate.js               ← ตรวจ input ก่อนเข้า controller
│   │
│   ├── config/
│   │   └── index.js                  ← อ่านค่า .env มาใช้
│   │
│   └── public/
│       ├── index.html                ← หน้าตั้งค่า
│       ├── dashboard.html            ← หน้า Dashboard
│       ├── css/
│       └── js/
│           ├── config.js
│           └── dashboard.js
│
├── data/
│   └── ev_charging.csv               ← local CSV (ใช้พัฒนา + fallback)
│
└── arduino/
    └── ev_pwm_controller.ino
```

**ความแตกต่าง routes vs controllers vs services:**
- `routes/` = รับ HTTP request, ชี้ไป controller
- `controllers/` = รับ req/res, เรียก service, ส่ง response
- `services/` = business logic ล้วนๆ ไม่รู้จัก req/res

### ลำดับ Step การพัฒนา (ตกลงแล้ว)

```
Step 1: Setup โปรเจค + Express server เปล่าๆ ทำงานได้
Step 2: Local CSV + อ่านข้อมูลได้
Step 3: Calculation logic (load/overload/PWM)
Step 4: WebSocket ส่งข้อมูล real-time
Step 5: Dashboard (แสดงผล)
Step 6: Config Page (ตั้งค่า + เขียน CSV)
Step 7: เชื่อม Google Sheets
Step 8: Arduino (ถ้าเวลาพอ)
```

### เหตุผลลำดับนี้
- Backend ก่อน Frontend → logic ถูกต้องก่อน แล้วค่อยทำ UI ครอบ
- Dashboard ก่อน Config Page → ดูว่า output ถูกไหมได้เร็ว
- Google Sheets ทีหลังสุด → พัฒนาได้ offline ไม่ติด dependency ภายนอก
