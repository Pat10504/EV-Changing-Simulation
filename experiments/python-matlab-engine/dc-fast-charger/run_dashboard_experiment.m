function output = run_dashboard_experiment(target_kW, reference_V, initial_soc, duration_s)
% Independent current-controlled experiment; no edits to the saved model/data.
arguments
    target_kW (1,1) double {mustBePositive, mustBeFinite}
    reference_V (1,1) double {mustBePositive, mustBeFinite}
    initial_soc (1,1) double {mustBeFinite}
    duration_s (1,1) double {mustBePositive, mustBeFinite}
end
assert(target_kW <= 50 && reference_V >= 200 && reference_V <= 1000, 'Invalid power or reference voltage.');
assert(initial_soc >= 0.05 && initial_soc <= 0.95 && duration_s >= 0.2 && duration_s <= 2, 'Outside the experiment range.');
target_A = target_kW * 1000 / reference_V;
assert(target_A <= 125, 'Requested current exceeds the 125 A software experiment limit.');
folder = fileparts(mfilename('fullpath'));
model = 'DCFastCharger';
modelFile = fullfile(folder, [model '.slx']);
if bdIsLoaded(model)
    assert(strcmp(get_param(model,'FileName'),modelFile), 'A different DCFastCharger model is open.');
    assert(strcmp(get_param(model,'Dirty'),'off'), 'Save or discard model edits before this experiment.');
    assert(strcmp(get_param(model,'SimulationStatus'),'stopped'), 'The model is already running.');
else
    load_system(modelFile);
end
% The data script runs in this function workspace, not the user's base workspace.
run(fullfile(folder,'DCFastChargerData.mlx'));
battery.currentReference = target_A;
battery.initialSOC = initial_soc;
simulation.simTime = duration_s;
simIn = Simulink.SimulationInput(model);
names = {'battery','simulation','rectifier','inverter','transformer','chopper', ...
    'powerCircuit'};
for k = 1:numel(names)
    simIn = simIn.setVariable(names{k}, eval(names{k}));
end
% Variant expressions require global scope; restore the original values on exit.
variantNames = {'average','twoLevel','threeLevel'};
previous = cell(size(variantNames)); existed = false(size(variantNames));
for k = 1:numel(variantNames)
    existed(k) = evalin('base',sprintf('exist(''%s'',''var'')',variantNames{k})) ~= 0;
    if existed(k), previous{k} = evalin('base',variantNames{k}); end
end
restoreVariants = onCleanup(@() restoreBase(variantNames,previous,existed)); %#ok<NASGU>
for k = 1:numel(variantNames), assignin('base',variantNames{k},eval(variantNames{k})); end
simIn = simIn.setModelParameter('StopTime',num2str(duration_s), ...
    'ReturnWorkspaceOutputs','on','SimscapeLogType','all', ...
    'SimscapeLogName','simlog_DCFastCharger');
wallClock = tic;
simOut = sim(simIn);
wall_s = toc(wallClock);
log = simOut.simlog_DCFastCharger;
is = log.EV_Battery.i.Current_Sensor.I.series;
vs = log.EV_Battery.v.Voltage_Sensor.V.series;
ds = log.Front_end_converter.DC_Bus_Voltage_Sensor.V.series;
sourceTime = time(is);
[t, uniqueIndex] = unique(sourceTime(:),'last');
i = values(is,'A'); i = i(uniqueIndex);
v = alignSeries(vs,t,'V');
dc = alignSeries(ds,t,'V');
i = i(:); v = v(:); dc = dc(:);
p = v .* i / 1000; % Retain the signed sensor values; do not hide reversed flow.
assert(numel(t) > 2 && all(isfinite([t;i;v;dc;p])), 'Invalid or missing measurement data.');
tail = t >= t(end) - 0.2*(t(end)-t(1));
tt = t(tail); pp = p(tail);
assert(numel(tt) >= 3 && tt(end) > tt(1), 'Too few samples to summarize.');
averageP = trapz(tt,pp)/(tt(end)-tt(1));
mid = (tt(1)+tt(end))/2;
left = tt <= mid; right = tt >= mid;
stable = false;
if nnz(left) >= 2 && nnz(right) >= 2
    firstMean = trapz(tt(left),pp(left))/(tt(find(left,1,'last'))-tt(1));
    lastMean = trapz(tt(right),pp(right))/(tt(end)-tt(find(right,1)));
    stable = abs(firstMean-lastMean) <= .02*max(abs(averageP),1) ...
        && max(pp)-min(pp) <= .05*max(abs(averageP),1);
end
summary = struct('power_kW',averageP, ...
    'voltage_V',trapz(tt,v(tail))/(tt(end)-tt(1)), ...
    'current_A',trapz(tt,i(tail))/(tt(end)-tt(1)), ...
    'dc_bus_V',trapz(tt,dc(tail))/(tt(end)-tt(1)), ...
    'error_percent',100*(averageP-target_kW)/target_kW, ...
    'stable_tail',stable,'window_start_s',tt(1),'window_end_s',tt(end), ...
    'power_min_kW',min(pp),'power_max_kW',max(pp));
pick = unique(round(linspace(1,numel(t),min(1200,numel(t)))));
series = struct('time_s',t(pick),'voltage_V',v(pick),'current_A',i(pick), ...
    'power_kW',p(pick),'dc_bus_V',dc(pick));
output = jsonencode(struct('target_kW',target_kW,'target_current_A',target_A, ...
    'reference_voltage_V',reference_V,'initial_soc',initial_soc, ...
    'duration_s',duration_s,'wall_time_s',wall_s,'sample_count',numel(t), ...
    'summary',summary,'series',series,'model_file',modelFile, ...
    'cells_series',battery.cellsInSeries,'strings_parallel',battery.batteryStringsInParallel));
end

function result = alignSeries(series,t,unit)
rawTime = time(series);
[sourceTime,ix] = unique(rawTime(:),'last');
source = values(series,unit); source = source(ix);
result = interp1(sourceTime,source,t,'linear');
end

function restoreBase(names,previous,existed)
for k = 1:numel(names)
    if existed(k), assignin('base',names{k},previous{k});
    else, evalin('base',['clear ' names{k}]); end
end
end
