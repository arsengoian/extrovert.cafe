-- migrate:up

-- Помилки з лога ядра малини (pitelemetry.c, 17.10.2026): окремий потік
-- телеметрії шле їх, щойно ядро їх написало, пробою з source 'kernel'. Це
-- подія, а не стан, тож «останньою пробою точки» вона не вважається
-- (admin-ops.js). 16.10 малина зависла, коли SD-картка, найімовірніше,
-- перестала відповідати, — а лог ядра, з якого це видно, жив лише в її RAM.
--
-- not valid + validate: перевірка наявних рядків іде під легшим замком і не
-- тримає вставки телеметрії, поки проходить таблицю.
alter table device_telemetry drop constraint device_telemetry_source_check;
alter table device_telemetry add constraint device_telemetry_source_check
    check (source in ('pi', 'jetinno', 'camera', 'kernel')) not valid;
alter table device_telemetry validate constraint device_telemetry_source_check;

-- migrate:down

-- Рядки kernel лишаються: not valid не перевіряє наявних.
alter table device_telemetry drop constraint device_telemetry_source_check;
alter table device_telemetry add constraint device_telemetry_source_check
    check (source in ('pi', 'jetinno', 'camera')) not valid;
