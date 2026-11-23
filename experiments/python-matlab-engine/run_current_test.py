import matlab.engine

# เชื่อมกับ MATLAB ที่เปิดอยู่
eng = matlab.engine.connect_matlab("EVChargingLab")

# ให้ MATLAB ใช้โฟลเดอร์ที่มีสคริปต์และวงจร
eng.cd(
    "/Users/patkruadamrong/EESPU/ev-charging-simulation/experiments/python-matlab-engine/dc-fast-charger",
    nargout=0,
)

# 1. กำหนดกระแสเป้าหมาย
target_current_A = 40.0
eng.workspace["target_current_A"] = target_current_A

# 2. สั่ง MATLAB รันสคริปต์ทดลอง
eng.eval("manual_current_test", nargout=0)

# 3. อ่านผลกลับมาเก็บใน Python
result_A = eng.workspace["last_current_A"]

print("Target:", target_current_A, "A")
print("Last measured current:", result_A, "A")