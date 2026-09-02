#!/usr/bin/env bash
set -euo pipefail

cpu_percent="$(ps -eo pcpu= | awk '{ total += $1 } END { printf "%.1f", total + 0 }')"

if [[ -r /sys/fs/cgroup/memory.current ]]; then
  memory_bytes="$(cat /sys/fs/cgroup/memory.current)"
else
  memory_bytes="$(awk '/MemTotal/ { total=$2 } /MemAvailable/ { available=$2 } END { printf "%.0f", (total-available)*1024 }' /proc/meminfo)"
fi

memory_limit="null"
if [[ -r /sys/fs/cgroup/memory.max ]]; then
  candidate="$(cat /sys/fs/cgroup/memory.max)"
  [[ "$candidate" =~ ^[0-9]+$ ]] && memory_limit="$candidate"
fi

read -r disk_limit disk_bytes < <(df -B1 --output=size,used /workspace | awk 'NR == 2 { print $1, $2 }')

printf '{"cpuPercent":%s,"memoryBytes":%s,"memoryLimitBytes":%s,"diskBytes":%s,"diskLimitBytes":%s}\n' \
  "$cpu_percent" "$memory_bytes" "$memory_limit" "$disk_bytes" "$disk_limit"
