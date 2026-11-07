%% 1. เตรียมวงจรและค่าตั้งต้น
load_system('DCFastCharger');
run('DCFastChargerData.mlx');
%% 2. ตั้งกระแสชาร์จเป้าหมาย
battery.currentReference = target_current_A; % A
%% 3. รันวงจรและรับชุดผลลัพธ์
simOut = sim('DCFastCharger', 'ReturnWorkspaceOutputs', 'on');
%% 4. อ่านกระแสที่วัดได้
currentSeries = simOut.simlog_DCFastCharger.EV_Battery.i.Current_Sensor.I.series;
current_A = values(currentSeries, Units="A");
last_current_A = current_A(end)
