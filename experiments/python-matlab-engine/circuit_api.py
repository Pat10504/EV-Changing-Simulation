"""Local, single-job bridge. All results come from MATLAB; no fallback data."""
import json
import math
from pathlib import Path
from threading import Lock, Thread
from uuid import UUID
import matlab.engine
from flask import Blueprint, jsonify, request

api = Blueprint('circuit', __name__, url_prefix='/api/circuit')
engine_lock = Lock()
jobs_lock = Lock()
jobs = {}
MODEL_FOLDER = Path(__file__).resolve().parent / 'dc-fast-charger'

def connect_engine():
    if 'EVChargingLab' not in matlab.engine.find_matlab():
        raise ValueError("เปิด MATLAB และพิมพ์ matlab.engine.shareEngine('EVChargingLab') ก่อน")
    eng = matlab.engine.connect_matlab('EVChargingLab')
    eng.addpath(str(MODEL_FOLDER), nargout=0)
    return eng

def validate(payload):
    job_id = str(UUID(str(payload.get('id', ''))))
    inputs = {key: float(payload[key]) for key in ('target_power_kW','reference_voltage_V','initial_soc','duration_s')}
    if not all(math.isfinite(v) for v in inputs.values()):
        raise ValueError('ค่าตั้งต้องเป็นตัวเลขที่มีค่าจำกัด')
    p, v, soc, duration = (inputs[k] for k in ('target_power_kW','reference_voltage_V','initial_soc','duration_s'))
    if not (0 < p <= 50 and 200 <= v <= 1000 and .05 <= soc <= .95 and .2 <= duration <= 2):
        raise ValueError('ค่าตั้งอยู่นอกขอบเขตทดลอง')
    if p * 1000 / v > 125:
        raise ValueError('กระแสเป้าหมายเกินขอบเขตทดลอง 125 A')
    return job_id, inputs

@api.get('/status')
def status():
    try:
        ready = 'EVChargingLab' in matlab.engine.find_matlab()
        return jsonify(matlab_ready=ready, busy=engine_lock.locked(), message=None if ready else "เปิด MATLAB แล้วแชร์ชื่อ EVChargingLab")
    except Exception:
        return jsonify(matlab_ready=False, busy=engine_lock.locked(), message='ตรวจ MATLAB Engine ไม่สำเร็จ')

def execute(job_id, inputs):
    try:
        eng = connect_engine()
        result = json.loads(eng.run_dashboard_experiment(inputs['target_power_kW'], inputs['reference_voltage_V'], inputs['initial_soc'], inputs['duration_s']))
        with jobs_lock:
            jobs[job_id].update(status='complete', result=result, message=None)
    except Exception as exc:
        with jobs_lock:
            jobs[job_id].update(status='failed', message=str(exc)[-1500:])
    finally:
        engine_lock.release()

@api.post('/jobs')
def start():
    try:
        job_id, inputs = validate(request.get_json(silent=True) or {})
    except (KeyError, ValueError, TypeError) as exc:
        return jsonify(message=f'ข้อมูลทดลองไม่ถูกต้อง: {exc}'), 400
    with jobs_lock:
        if job_id in jobs:
            if jobs[job_id]['inputs'] != inputs:
                return jsonify(message='รหัสงานเดิมมีค่าตั้งต่างกัน'), 409
            return jsonify(jobs[job_id])
        if not engine_lock.acquire(blocking=False):
            return jsonify(message='MATLAB กำลังทำงานอื่น รอให้เสร็จก่อนแล้วลองอีกครั้ง'), 409
        if len(jobs) >= 30:
            expired = next((k for k,v in jobs.items() if v['status'] != 'running'), None)
            if expired: del jobs[expired]
        jobs[job_id] = dict(id=job_id, inputs=inputs, status='running', result=None, message=None)
        answer = dict(jobs[job_id])
    Thread(target=execute, args=(job_id, inputs), daemon=True).start()
    return jsonify(answer), 202

@api.get('/jobs/<job_id>')
def read(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None: return jsonify(message='ไม่พบงานใน Python อาจมีการเริ่มเซิร์ฟเวอร์ใหม่'), 404
        return jsonify(job)
