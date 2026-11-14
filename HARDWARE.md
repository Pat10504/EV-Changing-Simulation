> **เอกสารย้อนหลัง — ยุติการใช้งานตั้งแต่ 14 พฤศจิกายน 2026**
> ระบบปัจจุบันถอด PWM และ `GET /api/hardware/latest` แล้ว เพราะเปลี่ยนไปศึกษาการปรับกำลังผ่านวงจร MATLAB
> เนื้อหาด้านล่างและ firmware ใน `hardware/` เก็บเป็นประวัติการทดลองเดิม; firmware นี้ใช้กับ backend ปัจจุบันไม่ได้
> คู่มือ `docs/ev_charging_simulation_manual.docx` และตัวสร้าง `scripts/build_manual_docx.py` ก็เป็นคู่มือรุ่นเดิมที่ยังกล่าวถึง PWM

# HARDWARE.md — Phase ทดลองแสดงผลจาก Dashboard

เอกสารนี้อัปเดตจากอุปกรณ์ที่มีจริงล่าสุด เพื่อใช้ทำ demo ฝั่ง hardware ให้อาจารย์ดูก่อน โดยยังไม่ทำวงจรกำลังจริง และยังไม่จำลองโหลด EV ด้วย MOSFET หรือ current sensor ใน phase นี้

---

## 1. เป้าหมาย Phase นี้

ทำอุปกรณ์จำลองขนาดเล็กที่:

1. ESP32 เชื่อม Wi-Fi เข้ากับ network เดียวกับเครื่องที่รัน Dashboard
2. ESP32 รับค่าจาก backend เช่น `status`, `PWM`, `total load`, `base load`, `EV load`
3. แสดงค่าบนจอ LCD 16x2 I2C
4. ใช้ประกอบการ demo ว่า Dashboard สามารถส่งค่ามายัง hardware display ได้จริง

สิ่งที่ยังไม่ทำใน phase นี้:

- ยังไม่ควบคุมกระแสจริง
- ยังไม่ต่อ MOSFET
- ยังไม่วัดกระแสจริงด้วย sensor
- ยังไม่จำลองสายชาร์จหรือรถ EV จริง

---

## 2. อุปกรณ์ที่ใช้จริงใน Phase นี้

| อุปกรณ์ | ระบุจากรูป | สถานะ | หมายเหตุ |
|---|---|---|---|
| บอร์ด Wi-Fi | ESP32 DevKit / ESP-WROOM-32 | ใช้เป็นบอร์ดหลัก | มี Wi-Fi + Bluetooth, เหมาะกว่า NodeMCU ESP8266 |
| USB-to-Serial | Silicon Labs CP2102 | ใช้ upload code ผ่าน USB-C | ถ้า Mac ไม่เห็น port ให้ติดตั้ง CP210x driver |
| จอแสดงผล | LCD 1602 / 16x2 พร้อม I2C backpack | ใช้แสดงผล | pin `GND VCC SDA SCL` |
| Adapter | AC/DC Adapter 9V 1000mA | ใช้เฉพาะจ่ายไฟภายหลังแบบระวัง | ต้องจ่ายเข้า `VIN` หรือช่องรับไฟที่รองรับเท่านั้น ห้ามเข้าขา `3V3` |
| สาย jumper | Dupont jumper wires | ใช้ต่อ LCD กับ ESP32 | ต้องต่อ GND ร่วมกัน |

หมายเหตุ: ตอนแรกมี NodeMCU ESP8266 แต่เปลี่ยนมาใช้ ESP32 ตัวใหม่เป็นบอร์ดหลัก เพราะมีพอร์ต USB-C, Wi-Fi พร้อมใช้งาน, pin เยอะกว่า และเหมาะกับ demo นี้มากกว่า

---

## 3. วิเคราะห์บอร์ด ESP32

จากรูปบอร์ดเห็นข้อความ `ESP-32`, pin layout แบบ ESP32 DevKit และชิป USB-to-Serial `Silicon Labs CP2102` จึงสรุปว่าเป็นบอร์ด ESP32 DevKit ที่ใช้กับ Arduino IDE ได้

### ใช้กับโปรเจคนี้ได้ไหม

- ใช้ Wi-Fi ได้: ได้
- ใช้แสดงค่าจาก Dashboard ได้: ได้
- ใช้ Arduino IDE ได้: ได้
- ใช้ library `WiFi.h`: ได้
- ใช้ HTTP polling ไป backend: ได้
- เหมาะกับ demo มากกว่า NodeMCU ESP8266: ใช่

### สิ่งที่ต้องติดตั้งใน Arduino IDE

Board package:

```text
esp32 by Espressif Systems
```

เลือกบอร์ด:

```text
ESP32 Dev Module
```

ถ้า Arduino IDE มีตัวเลือก `DOIT ESP32 DEVKIT V1` ก็ใช้ได้เช่นกัน แต่ค่า default ที่แนะนำคือ `ESP32 Dev Module`

---

## 4. วิเคราะห์จอ LCD

จอเป็น LCD 16x2 พร้อม I2C backpack ไม่ใช่ OLED

### สเปคที่คาดว่าใช่

| รายการ | ค่า |
|---|---|
| ประเภท | Character LCD 16x2 |
| Controller หลัก | HD44780 compatible |
| Interface | I2C backpack |
| Pin | `GND`, `VCC`, `SDA`, `SCL` |
| I2C address ที่พบบ่อย | `0x27` หรือ `0x3F` |
| Library ที่ใช้ | `LiquidCrystal_I2C` |

### ข้อควรระวังเรื่องแรงดัน

ESP32 เป็น logic `3.3V` ส่วน LCD backpack หลายรุ่นออกแบบให้ใช้ `5V`

แนวทางที่ปลอดภัย:

1. เริ่มจากจ่าย LCD ด้วย `3V3` ก่อน
2. ถ้าจอติดแต่ไม่เห็นตัวอักษร ให้หมุน potentiometer สีน้ำเงินหลังจอเพื่อปรับ contrast
3. ถ้าจอไม่ทำงานที่ `3V3` อาจต้องจ่าย `5V` ให้ LCD แต่ควรระวัง I2C pull-up บน SDA/SCL เพราะอาจดึงสัญญาณเป็น 5V
4. ถ้าใช้ `5V` อย่างจริงจัง ควรใช้ logic level shifter สำหรับ SDA/SCL

---

## 5. Wiring เบื้องต้น: ESP32 + LCD I2C

ใช้ I2C pin มาตรฐานของ ESP32:

| LCD I2C | ESP32 | หมายเหตุ |
|---|---|---|
| GND | GND | ground ร่วม |
| VCC | 3V3 | เริ่มจาก 3.3V ก่อนเพื่อความปลอดภัย |
| SDA | D21 / GPIO21 | I2C data, บนบอร์ดพิมพ์ว่า `D21` |
| SCL | D22 / GPIO22 | I2C clock, บนบอร์ดพิมพ์ว่า `D22` |

ถ้าจอไม่ติดหรือไม่มีตัวอักษร:

- หมุน potentiometer สีน้ำเงินด้านหลังจอ
- ทดสอบ I2C address ด้วย I2C scanner
- ลอง address `0x27` ก่อน ถ้าไม่เจอค่อยลอง `0x3F`
- ตรวจสาย `SDA -> D21` และ `SCL -> D22`

---

## 6. การจ่ายไฟ

### ตอนพัฒนาและ upload code

ใช้สาย USB-C ต่อ ESP32 เข้ากับ Mac เพื่อ:

- จ่ายไฟ
- upload code
- เปิด Serial Monitor

### ตอน demo แบบไม่ต่อ Mac

ใช้ adapter `9V 1000mA` ได้เฉพาะกรณีจ่ายเข้าขา/ช่องที่บอร์ดรองรับ เช่น `VIN` แล้วให้ regulator บนบอร์ดลดไฟเอง

ข้อควรระวัง:

- ห้ามจ่าย 9V เข้า `3V3`
- ห้ามจ่าย 9V เข้า GPIO
- ถ้าบอร์ดร้อนมาก ให้หยุดใช้ adapter และกลับมาใช้ USB-C
- สำหรับ demo แสดงผลอย่างเดียว ใช้ USB-C จากคอมพิวเตอร์หรือ power bank 5V จะปลอดภัยกว่า

---

## 7. วิธีเชื่อมกับ Dashboard ที่แนะนำ

ให้ ESP32 ดึงข้อมูลจาก backend ด้วย HTTP polling ทุก 1 วินาที

```text
ESP32 -> Wi-Fi -> GET http://<computer-ip>:3000/api/hardware/latest
```

แล้วแสดงบน LCD เช่น:

```text
NORMAL PWM:255
Load 53.5% 16kVA
```

### ทำไมใช้ HTTP polling

Backend ใช้ socket.io สำหรับ browser อยู่แล้ว แต่ฝั่ง microcontroller ใช้ HTTP ธรรมดาง่ายกว่า debug ง่ายกว่า และพอสำหรับ demo

### สิ่งที่ต้องเพิ่มใน backend

เพิ่ม endpoint:

```text
GET /api/hardware/latest
```

response ตัวอย่าง:

```json
{
  "time": "18:00",
  "status": "OVERLOAD",
  "pwm": 161,
  "total_load_percent": 86.4,
  "total_load_kVA": 43200,
  "ev_load_kW": 11500,
  "base_load_kVA": 30000,
  "min_charger_power_kW": 20,
  "control_limited": false
}
```

endpoint นี้ควรคืนค่าล่าสุดที่ simulation service คำนวณแล้ว เพื่อให้ ESP32 อ่านไปแสดงบน LCD

หมายเหตุ: ค่า PWM มาจากกำลังหลังปรับลดของตู้ชาร์จ แต่ระบบจะไม่สั่งให้ตู้ที่ยัง active ต่ำกว่า `20 kW` เพราะต่ำกว่านี้ถือว่าไฟไม่เข้ารถในโมเดล demo ถ้าลดถึงขั้นต่ำแล้วยังเกิน limit จะส่ง `control_limited: true`

---

## 8. สิ่งที่จอ LCD 16x2 ควรแสดง

LCD มี 16 ตัวอักษร x 2 บรรทัด จึงควรแสดงแบบกระชับ

### หน้าแสดงปกติ

```text
NORMAL 01:00 P:255
Load 53.5%
```

### ตอน WARNING

```text
WARN 18:00 P:255
Load 74.2%
```

### ตอน OVERLOAD

```text
OVR 18:00 P:161
Load86.4% Cut18
```

### ตอนลดถึงขั้นต่ำ 20 kW แล้วยังเกิน limit

```text
OVR 18:00 P:102
MIN20 LIMIT
```

---

## 9. Arduino IDE Setup สำหรับ ESP32

### Board package

ใน Arduino IDE ไปที่ `Settings` แล้วใส่ URL นี้ใน `Additional boards manager URLs`

```text
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```

จากนั้นไปที่ Boards Manager แล้วติดตั้ง:

```text
esp32 by Espressif Systems
```

เลือกบอร์ด:

```text
ESP32 Dev Module
```

### Libraries ที่ต้องใช้

| Library | ใช้ทำอะไร |
|---|---|
| WiFi | เชื่อม Wi-Fi บน ESP32 |
| HTTPClient | ยิง HTTP request ไป backend |
| ArduinoJson | parse JSON จาก backend |
| Wire | I2C |
| LiquidCrystal_I2C | ควบคุม LCD 16x2 I2C |

`WiFi`, `HTTPClient`, และ `Wire` จะมากับ ESP32 core / Arduino IDE อยู่แล้ว ส่วน `ArduinoJson` และ `LiquidCrystal_I2C` ให้ติดตั้งจาก Library Manager

---

## 10. Workflow การทดสอบ Hardware

1. ติดตั้ง board package `esp32 by Espressif Systems`
2. เลือกบอร์ด `ESP32 Dev Module`
3. เลือก port ของ ESP32 เช่น `/dev/cu.usbserial...` หรือ `/dev/cu.SLAB_USBtoUART...`
4. upload I2C scanner เพื่อหา address ของ LCD
5. upload `hardware/esp32_lcd_test/esp32_lcd_test.ino` เพื่อยืนยันว่าจอแสดงตัวอักษรได้
6. backend มี endpoint `/api/hardware/latest` สำหรับ ESP32 อ่านค่าล่าสุด
7. คัดลอก `hardware/esp32_dashboard_lcd/secrets.example.h` เป็น `secrets.h` ในโฟลเดอร์เดียวกัน แล้วตั้ง `WIFI_SSID`, `WIFI_PASSWORD`, และ `API_URL` ใน `secrets.h` ซึ่ง Git ไม่ติดตาม
8. upload firmware ให้ ESP32 เชื่อม Wi-Fi และอ่าน JSON จาก endpoint
9. แสดง `status`, `PWM`, `total_load_percent`, `total_load_kVA` บน LCD
10. Demo ให้อาจารย์ดูว่า Dashboard -> Wi-Fi -> ESP32 -> LCD ทำงานจริง

### ไฟล์ firmware ใน repo

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `hardware/esp32_lcd_test/esp32_lcd_test.ino` | ทดสอบ LCD address `0x27`, SDA `GPIO21`, SCL `GPIO22` |
| `hardware/esp32_dashboard_lcd/esp32_dashboard_lcd.ino` | ต่อ Wi-Fi แล้วอ่าน `GET /api/hardware/latest` ทุก 1 วินาที |
| `hardware/esp32_dashboard_lcd/secrets.example.h` | ตัวอย่างค่าตั้งต้นสำหรับคัดลอกเป็น `secrets.h` แล้วใส่ค่าจริงเฉพาะเครื่อง |

ก่อน upload firmware dashboard ให้หา IP ของเครื่องที่รัน backend เช่น `192.168.1.100` แล้วตั้งใน `secrets.h`:

```cpp
const char* API_URL = "http://192.168.1.100:3000/api/hardware/latest";
```

ห้ามใช้ `localhost` ใน ESP32 เพราะจะหมายถึงตัว ESP32 เอง ไม่ใช่เครื่องที่รัน Dashboard

---

## 11. สรุปความเป็นไปได้

อุปกรณ์ที่มีตอนนี้สามารถทำ demo ได้

ทำได้แน่นอน:

- ESP32 ต่อ Wi-Fi
- ESP32 อ่านค่าจาก Node.js backend ผ่าน HTTP
- LCD 16x2 แสดง status, PWM, load percent, load kVA/kW

ยังไม่ควรทำใน phase นี้:

- ควบคุมโหลดจริงด้วย 9V adapter
- ต่อ MOSFET เพื่อจ่ายกำลัง
- วัดกระแสจริง

เหตุผล:

- อุปกรณ์ตอนนี้ยังไม่มี MOSFET, resistor load, current sensor
- Adapter 9V 1A ใช้เป็น power source ได้ แต่ยังไม่ควรเอาไปต่อโหลดกำลังโดยไม่มีวงจรป้องกัน
