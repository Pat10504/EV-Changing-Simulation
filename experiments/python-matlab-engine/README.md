# ทดลอง HTML → Python → MATLAB/Simulink แบบ local

ขอบเขต: กรอกกระแสเป้าหมายเป็นจำนวนเต็ม 20–100 A กด **บันทึกและรัน MATLAB** แล้วแสดงกระแสตัวอย่างสุดท้ายของวงจร DC Fast Charger บนหน้าเว็บเดิม

```text
templates/index.html → web_app.py → MATLAB Engine
                                       ↓
                         manual_current_test.m
                                       ↓
                          DCFastCharger.slx
                                       ↓
                     last_current_A → หน้าเว็บ
```

การบันทึกในตัวอย่างนี้หมายถึงส่งค่าเข้า MATLAB Workspace สำหรับการจำลองรอบนั้น ยังไม่มีการเก็บประวัติลงฐานข้อมูล และไม่ต้องเปิด Node/Express ของเว็บหลัก

## ไฟล์แต่ละตัวทำอะไร

| ไฟล์ | หน้าที่ |
|---|---|
| `web_app.py` | เว็บ Flask รับค่าจากฟอร์ม ตรวจช่วงค่า สั่ง MATLAB และส่งผลกลับ |
| `templates/index.html` | ฟอร์ม HTML และช่องแสดงผลที่ Flask เติมค่า |
| `run_current_test.py` | ทดลองกำหนดค่า รัน และรับผลจาก Python โดยตรง ปัจจุบันตั้งไว้ 40 A |
| `dc-fast-charger/manual_current_test.m` | โหลดข้อมูล ตั้งกระแสเป้าหมาย รันวงจร และอ่านค่าจาก Simscape logging |
| `dc-fast-charger/DCFastCharger.slx` | โมเดลวงจร โดย Constant4 อ่าน `battery.currentReference` |
| `dc-fast-charger/DCFastChargerData.mlx` | ค่าตั้งต้นและตัวเลือกของโมเดล โหลดใหม่ทุกครั้งก่อนตั้งค่าเป้าหมาย |
| `dc-fast-charger/DCFastChargingStationDD.sldd` | Data dictionary ที่มาพร้อมตัวอย่าง |
| `dc-fast-charger/DCFastChargerExample.m` | คำอธิบายและสคริปต์ตัวอย่างของ MathWorks ซึ่งมีคำสั่งรันหลายกรณี |
| `smoke_test.py` | การทดลองเก่าที่เปิด MATLAB session ใหม่ ไม่ใช่เส้นทางที่เว็บนี้ใช้ |
| `ROADMAP_TH.md` | สถานะปัจจุบันและแผนการเรียนย้อนหลัง |

## สภาพแวดล้อมที่ทดลองผ่าน

- macOS Apple silicon
- MATLAB R2026b พร้อม Simulink, Simscape และ Simscape Electrical ที่มี license ใช้งานได้
- Python 3.13.18, MATLAB Engine 26.2, Flask 3.1.3
- MATLAB เปิดอยู่และแชร์ session ชื่อ `EVChargingLab`

โมเดลนี้ดัดแปลงจาก [DC Fast Charger for Electric Vehicle ของ MathWorks](https://www.mathworks.com/help/simscape-electrical/ug/dc-fast-charger.html) โดยคงข้อความลิขสิทธิ์ของไฟล์ตัวอย่างไว้ ต้องมี MATLAB และผลิตภัณฑ์ที่โมเดลใช้ติดตั้งบนเครื่อง

## เตรียม Python

ใน Terminal ให้เข้าโฟลเดอร์นี้จาก root ของ repo ก่อน:

```bash
cd experiments/python-matlab-engine
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install "/Applications/MATLAB_R2026b.app/extern/engines/python"
python -m pip install -r requirements.txt
```

คำสั่งนี้เป็นวิธีติดตั้งบน Mac ที่ใช้ทดลอง หากตำแหน่ง Python หรือ MATLAB ต่างกัน ให้แก้พาธให้ตรงกับเครื่อง และเลือก `.venv/bin/python` ของโฟลเดอร์นี้เป็น interpreter ใน VS Code

ไฟล์ Python สองตัวที่ใช้ทดลองยังระบุพาธโมเดลตามเครื่องที่ทดสอบไว้:

```text
/Users/patkruadamrong/EESPU/ev-charging-simulation/experiments/python-matlab-engine/dc-fast-charger
```

หาก clone ไว้ตำแหน่งอื่น ให้แก้พาธใน `eng.cd(...)` ของ `run_current_test.py` และ `web_app.py` ให้ชี้ไปที่โฟลเดอร์ `dc-fast-charger` ของสำเนานั้นก่อนรัน

## เปิด MATLAB ให้ Python เชื่อมต่อ

ใน MATLAB Command Window:

```matlab
matlab.engine.shareEngine('EVChargingLab')
matlab.engine.engineName
```

ตรวจว่าชื่อที่คืนมาคือ `EVChargingLab` และเปิด MATLAB ค้างไว้ ถ้ามีโมเดลชื่อ `DCFastCharger` เปิดอยู่ ให้ตรวจ `get_param('DCFastCharger', 'FileName')` ว่าเป็นไฟล์ในสำเนา repo นี้

## รันผ่าน Python หรือหน้าเว็บ

จาก Terminal ที่เปิด `.venv` และอยู่ในโฟลเดอร์การทดลอง:

```bash
python run_current_test.py
```

สำหรับหน้าเว็บ:

```bash
python web_app.py
```

เปิด [http://127.0.0.1:5050](http://127.0.0.1:5050) กรอกกระแส แล้วกด **บันทึกและรัน MATLAB** เว็บรับงานทีละรายการ และต้องเปิด Terminal กับ MATLAB ค้างไว้ระหว่างใช้งาน

กด Ctrl+C ใน Terminal เพื่อหยุดเว็บ เมื่อแก้ Python ให้หยุดแล้วเปิดใหม่ เพราะปิด debug/reloader ไว้ หลังปิด MATLAB ต้องแชร์ session ใหม่และเริ่มเว็บใหม่ด้วย

## ผลที่ตรวจแล้วและขอบเขตการตีความ

- ผู้ใช้รันจาก Python: เป้าหมาย 40 A → กระแสตัวอย่างสุดท้าย **39.46074956936718 A**
- ผู้ใช้รันจากเว็บ local: เป้าหมาย 40 A → ผลเดียวกัน ยืนยันจากภาพหน้าจอวันที่ 7 พฤศจิกายน 2026
- ผล manual ก่อนหน้า: 20 A → ประมาณ 18.0987 A และ 50 A → ประมาณ 51.1445 A
- กรณีเปลี่ยนจาก 40 เป็น 50 A ผ่านหน้าเว็บ ยังไม่ได้รับหลักฐานผลรันในจังหวะที่บันทึกเอกสารนี้

ผลมาจาก `current_A(end)` ของเซนเซอร์ `EV_Battery.i.Current_Sensor.I` เป็นตัวอย่างสุดท้าย ไม่ใช่ค่าเฉลี่ยหรือการรับรองความแม่นยำช่วงคงตัว ข้อมูลเริ่มต้นใช้ `powerCircuit = 0` และเวลาจำลอง 0.2 วินาที ช่วง 20–100 A เป็นขอบเขตทดลองซอฟต์แวร์ ไม่ใช่พิกัดยืนยันของแบตเตอรี่หรือตู้จริง

`.venv`, `slprj`, `.slxc` และ Python cache ไม่เก็บใน Git เพราะสร้างใหม่ได้ ไม่ได้เชื่อมกับ ESP32, Supabase หรือการควบคุมฮาร์ดแวร์จริง
