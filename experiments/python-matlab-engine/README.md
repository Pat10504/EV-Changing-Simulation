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


## ส่วนเชื่อม Dashboard ใหม่ — 14 พฤศจิกายน 2026

หน้า `/circuit` บนเว็บ Node เป็นการทดลองเพิ่มจากฟอร์มกระแสเดิม: เลือกเวลาและพักที่ Dashboard → เปิดทดลองตู้ 50 kW → ตรวจเงื่อนไข → กดรัน MATLAB

- `circuit_api.py`: Flask Blueprint `/api/circuit/status` และ `/api/circuit/jobs` งาน background ทีละงาน ใช้ล็อกร่วมกับฟอร์มเก่า พร้อมตรวจขอบเขตและรหัสงานซ้ำ
- `dc-fast-charger/run_dashboard_experiment.m`: รับ target_kW, reference_V, initial_soc, duration_s; คืน JSON ผลวัดจริง โดยไม่บันทึกทับโมเดล/ค่าตั้งเดิม
- หน้าเว็บแสดงกำลังเป้าหมาย กระแสคำสั่ง ค่าเฉลี่ย P/V/I และ DC bus ช่วงท้าย กราฟ P/V/I และสถานะยังแกว่งเมื่อไม่ผ่านเกณฑ์เบื้องต้น
- ใช้ SimulationInput แยกค่าตั้งรายรอบ; Simulink.VariantExpression ต้องอยู่ global scope จึงสำรอง/คืนเฉพาะ average/twoLevel/threeLevel ด้วย onCleanup
- โหลดค่าจาก mlx ที่บันทึกไว้ล่าสุด ความจุเซลล์จริงยังมาจาก Battery (Table-Based) ใน slx ไม่ได้แก้การเชื่อม battery.AHRating ในงานนี้
- ผลตรวจบนเครื่องที่ใช้ 108S46P, SOC20%, เป้าหมาย12kW, Vref400V, Iref30A, เวลา0.2s: เฉลี่ยช่วง0.16–0.2s ได้ประมาณ12.055kW,382.988V,31.476A, DC bus800V และยังแกว่ง ผลเฉลี่ยไม่ใช่การรับรองว่าควบคุมกำลังนิ่งแล้ว
- ชุดค่าตั้ง mlx ที่ใช้ทดลองถูกบันทึกใน commit `54f6780` แล้ว (108S46P, currentReference 125 A); ผลอาจต่างกันเมื่อใช้ค่าตั้งอีกชุด ไม่อ้างผลตัวอย่างเป็นผลใหม่

รันเหมือนเดิมด้วย `.venv/bin/python web_app.py` จากโฟลเดอร์นี้ ตอนนี้เปิด Flask ได้แม้ MATLAB ยังไม่แชร์ และรายงานสถานะการเชื่อมต่อได้ ฟอร์มเดิมยังจำกัด20–100A; APIทดลองใหม่รับกระแสที่คำนวณแล้วไม่เกิน125A

ทดสอบส่วน API (ใช้ mock เฉพาะ unit test ไม่ใช่ผลแสดงบนเว็บ):

```bash
.venv/bin/python -m unittest test_circuit_api.py
```

## รันหลายช่วงเวลาอัตโนมัติ

เปิด `/dashboard?mode=matlab` บน Node (ปกติพอร์ต 3000) เลือกเวลาเริ่ม–สิ้นสุด แล้วกดเริ่มจำลองพร้อม MATLAB ครั้งเดียว ไม่ต้องเปลี่ยนวิธีเปิด Python หรือแชร์ MATLAB ระบบ Node จัดคิวเองและเรียก API เดิมทีละงาน หลังได้รับผลแล้วจึงส่งช่วงถัดไป

ค่า `battery.currentReference` ที่ส่งในแต่ละรอบคำนวณจากกำลังสุดท้ายของสูตรจัดสรร `P_target × 1000 / V_reference` โดยใช้ SimulationInput เหมือนเดิม ไม่เขียนทับ mlx/slx หรือ battery ใน Workspace ของผู้ใช้ ทุกช่วงเริ่ม SOC ใหม่ จึงยังไม่ใช่การจำลองรถคันเดิมต่อเนื่องทั้งวัน และยังไม่มีตัวควบคุมกำลังป้อนกลับหรือข้อจำกัดกำลังจริง 50 kW ในวงจร

รอบที่ไม่มี active จะถูกข้าม ค่าตั้งที่ทำให้กระแสคำสั่งเกิน 125 A จะถูกปฏิเสธก่อนเริ่มชุด ข้อความว่าโหลดหม้อแปลงยังเกิน limit แยกจากการรันวงจรสำเร็จและการผ่านเกณฑ์ความนิ่ง

Node บันทึก metadata / ผลสรุป / กราฟลง `runtime-data/circuit-batches/` ที่ root repo (JSON ในไฟล์ `.snapshot`, ไม่เก็บใน Git) ขณะที่ Python ยังเก็บงานล่าสุดในหน่วยความจำ เมื่อ Node รีสตาร์ต จะพักชุดและรอผู้ใช้กดทำต่อเพื่อตรวจรหัสงานเดิม ถ้า Python สูญเสียงานเดิมจะไม่เดาผลหรือรันซ้ำอัตโนมัติ

ปุ่มพัก/หยุดรอให้รอบ MATLAB ปัจจุบันจบ ไม่หยุด solver กลางทาง หากต้องการแก้ model หรือ mlx ให้พักชุดจนรอบเสร็จก่อน แล้วสร้างชุดใหม่เพื่อไม่ผสมผลจากคนละค่าตั้งวงจร ดูวิธีใช้และ API ใน README หลัก

ผลตรวจระบบอัตโนมัติวันที่ 14 พฤศจิกายน 2026 (ชุด `21f628ed`): ที่ Vref400V, SOC20%, วงจร0.5s ได้ 12:30 เป้าหมาย42.32kW → เฉลี่ย42.3376kW; 18:35 และ20:55 เป้าหมาย12kW → เฉลี่ย11.9878kW ทั้งสามยังไม่ผ่านเกณฑ์ความนิ่งช่วงท้าย และที่20:55 ยังคงรายงานหม้อแปลงเกิน420kVA จากสูตรจัดสรร ไม่ได้ใช้ผลวงจรลบสถานะนี้ ทดสอบพัก/ทำต่อและกู้ผลหลังเซิร์ฟเวอร์เริ่มใหม่แล้ว

ตรวจเพิ่มชุด `00dbda63` ที่18:30/18:35/18:40, วงจร0.2s ระบบเดินครบสามรอบหลังเริ่มเพียงครั้งเดียว ได้เฉลี่ยประมาณ12.0552kWแต่ละรอบ (คำสั่งเท่ากัน12kW/30A, เริ่มSOCเดียวกัน) ผลเก็บในเครื่องของผู้ทดลอง ไม่อยู่ในGit และไม่ใช่ผลที่รับประกันสำหรับค่าตั้งอื่น
