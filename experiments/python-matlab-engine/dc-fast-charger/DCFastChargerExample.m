%% DC Fast Charger for Electric Vehicle
%
% This example models a DC fast charging station connected with the battery
% pack of an Electric Vehicle (EV).
%
% The main components of the example are:
%
% * Grid - Model the AC supply voltage as a three-phase constant voltage source.
% * DC Fast Charging Station - Model the power electronic circuits to
% convert the AC supply voltage from the grid to the DC voltage level that
% the EV battery pack requires.
% * EV battery pack - Model the battery pack as series of battery cells.

% Copyright 2021-2023 The MathWorks, Inc.

%% Model Overview
open_system('DCFastCharger')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants, 'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%% Components in DC Fast Charging Station
%
% These are the main components of the system:
%
% * Filter & AC Measurements to filter the harmonics in the line current and
% measure the three-phase supply voltage and line current.
%%
open_system('DCFastCharger/Filter & AC measurements')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% * Unity Power Factor (UPF) Front End Converter (FEC) to control output
% DC voltage at 800 V.

%%
open_system('DCFastCharger/Front end converter')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% The converter circuit is modeled with three levels of fidelity:

%%
open_system('DCFastCharger/Front end converter/FEC')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% * Average Inverter Fidelity

%%
powerCircuit=0; %#ok<*NASGU>
open_system('DCFastCharger/Front end converter/FEC/Average')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% * Two Level Inverter Fidelity

%%
powerCircuit=1;
sim('DCFastCharger');
open_system('DCFastCharger/Front end converter/FEC/Two Level')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% * Three Level Inverter Fidelity

%%
powerCircuit=2;
sim('DCFastCharger');
open_system('DCFastCharger/Front end converter/FEC/Three Level')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% * Isolated DC-DC converter supply constant charging current to the EV battery.
%%
open_system('DCFastCharger/DC-DC converter with galvanic isolation')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% These are the main components of the isolated DC-DC Converter:
% * Inverter

%%
open_system('DCFastCharger/DC-DC converter with galvanic isolation/Inverter')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% * HF Isolation Transformer

%%
open_system('DCFastCharger/DC-DC converter with galvanic isolation/HF isolation transformer')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%%
% * Diode-Bridge Rectifier

%%
open_system('DCFastCharger/DC-DC converter with galvanic isolation/Diode-Bridge rectifier')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%% EV Battery Pack Overview
% The EV Battery Pack models the battery cells connected in series and the
% sensors to measure the battery terminal voltage and output current.

%%
open_system('DCFastCharger/EV Battery')
set_param(find_system('DCFastCharger','MatchFilter', @Simulink.match.allVariants,'FindAll', 'on','type','annotation','Tag','ModelFeatures'),'Interpreter','off')

%% Simulation Results from Simscape Logging
%
% The plot below shows the DC bus voltage and current, battery terminal
% voltage, and charging current.

powerCircuit=0;
open_system('DCFastCharger/Scope : DCFastCharger');
sim('DCFastCharger');

%%
