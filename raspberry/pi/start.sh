#!/bin/sh
/home/pi/scripts/llctl l0 d0 f0
# ssh тепер enabled у systemd, рядок прибрано: саме він викликав запит PolicyKit
# service ssh start
echo 'Welcome!'
