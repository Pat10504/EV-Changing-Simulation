import json
import unittest
from unittest.mock import patch, Mock
from uuid import uuid4
from web_app import app
import circuit_api as api

class CircuitTests(unittest.TestCase):
    def setUp(self):
        self.client=app.test_client()
        api.jobs.clear()
        if api.engine_lock.locked(): api.engine_lock.release()
        self.payload=dict(id=str(uuid4()),target_power_kW=12,reference_voltage_V=400,initial_soc=.2,duration_s=.2)
    def tearDown(self):
        if api.engine_lock.locked(): api.engine_lock.release()
    def test_rejects_outside_scope(self):
        for edit in [dict(target_power_kW=51),dict(target_power_kW=50,reference_voltage_V=200),dict(initial_soc=float('nan')),dict(id='invalid')]:
            self.assertEqual(self.client.post('/api/circuit/jobs',json={**self.payload,**edit}).status_code,400)
    @patch('circuit_api.Thread')
    def test_single_job_and_idempotent_retry(self, thread):
        self.assertEqual(self.client.post('/api/circuit/jobs',json=self.payload).status_code,202)
        self.assertEqual(self.client.post('/api/circuit/jobs',json=self.payload).status_code,200)
        self.assertEqual(thread.call_count,1)
        self.assertEqual(self.client.post('/api/circuit/jobs',json={**self.payload,'id':str(uuid4())}).status_code,409)
        self.assertEqual(self.client.post('/api/circuit/jobs',json={**self.payload,'duration_s':.5}).status_code,409)
    def test_engine_result_and_failure_release_the_lock(self):
        job_id, inputs=api.validate(self.payload)
        api.jobs[job_id]=dict(status='running',result=None)
        api.engine_lock.acquire()
        engine=Mock(); engine.run_dashboard_experiment.return_value=json.dumps({'summary':{'power_kW':12.05}})
        with patch('circuit_api.connect_engine',return_value=engine): api.execute(job_id,inputs)
        engine.run_dashboard_experiment.assert_called_once_with(12.,400.,.2,.2)
        self.assertEqual(api.jobs[job_id]['status'],'complete')
        self.assertFalse(api.engine_lock.locked())
        api.jobs[job_id]=dict(status='running',result=None);api.engine_lock.acquire()
        with patch('circuit_api.connect_engine',side_effect=ValueError('not shared')):api.execute(job_id,inputs)
        self.assertEqual(api.jobs[job_id]['status'],'failed')
        self.assertIsNone(api.jobs[job_id]['result'])
        self.assertFalse(api.engine_lock.locked())

if __name__=='__main__':unittest.main()
