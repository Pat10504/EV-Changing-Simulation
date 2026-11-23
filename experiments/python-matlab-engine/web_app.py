from flask import Flask, render_template, request
import matlab.engine
from circuit_api import api, engine_lock, connect_engine, MODEL_FOLDER

app = Flask(__name__)
app.register_blueprint(api)


@app.route("/", methods=["GET", "POST"])
def home():
    target_current_A = 40.0
    result_A = None
    error = None

    # ทำส่วนนี้เมื่อผู้ใช้กดปุ่มส่งข้อมูล
    if request.method == "POST":
        try:
            # อ่านค่าจากช่องกรอก แล้วแปลงข้อความเป็นตัวเลข
            target_current_A = float(
                request.form.get("target_current_A", "")
            )

            # ตรวจค่าก่อนส่งไป MATLAB
            if not (
                20 <= target_current_A <= 100
                and target_current_A.is_integer()
            ):
                raise ValueError("กรอกกระแสจำนวนเต็มตั้งแต่ 20 ถึง 100 A")

            # กำหนดค่า → รัน → รับผล เหมือนที่เราทดลองมาแล้ว
            if not engine_lock.acquire(blocking=False):
                raise ValueError("MATLAB กำลังทำงานอื่น กรุณารอให้เสร็จก่อน")
            try:
                eng = connect_engine()
                eng.cd(str(MODEL_FOLDER), nargout=0)
                eng.workspace["target_current_A"] = target_current_A
                eng.eval("manual_current_test", nargout=0)
                result_A = eng.workspace["last_current_A"]
            finally:
                engine_lock.release()

        except Exception as exc:
            error = f"การทดลองไม่สำเร็จ: {exc}"

    # เติมค่าลงใน HTML แล้วส่งกลับไปให้เบราว์เซอร์
    return render_template(
        "index.html",
        target_current_A=target_current_A,
        result_A=result_A,
        error=error,
    )


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5050,
        debug=False,
        threaded=True,
    )
