#!/usr/bin/env bash
#
# Sample the WSL 2 virtual machine while the hosted gate runs inside it.
#
# The gate's transcript only shows when a producer settled. It cannot tell a
# starved machine from a held lock or a genuine hang: each ends as "timed out
# and was killed". This sampler runs as root beside the gate and records what
# the VM itself is doing: memory and swap, pressure-stall figures, swap
# traffic, every process's state and resident size, the job leaders the gate
# spawned, the kernel's lock table, and any out-of-memory kill. The lane keeps
# the samples as a run artifact and prints a summary into the step log.
#
#   vm-samples.sh start <dir> [interval]   record the VM's facts, then sample in the background
#   vm-samples.sh stop <dir>               stop sampling, take a final sample, print the summary
#   vm-samples.sh summary <dir>            print the summary for an existing sample set
#
# Everything comes from procps and /proc; nothing installs into the VM.

set -u

mode="${1:-}"
dir="${2:-}"
interval="${3:-20}"

if [ -z "$mode" ] || [ -z "$dir" ]; then
  echo "usage: $0 start|stop|summary <dir> [interval-seconds]" >&2
  exit 64
fi

facts_file="$dir/facts.txt"
samples_file="$dir/samples.txt"
pid_file="$dir/sampler.pid"
log_file="$dir/sampler.log"

now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# The file's contents, or a marker when the kernel does not expose it.
read_or_absent() {
  if [ -r "$1" ]; then
    cat "$1"
  else
    echo "absent"
  fi
}

# One figure from a pressure-stall file: the `window` average of the `line`
# row ("some" or "full"), or -1 when the kernel keeps no pressure accounting.
psi_value() {
  local file="$1" row="$2" window="$3"
  if [ -r "$file" ]; then
    awk -v row="$row" -v window="$window" '
      $1 == row {
        for (i = 2; i <= NF; i++) {
          if (index($i, window "=") == 1) {
            split($i, kv, "=")
            print kv[2]
            exit
          }
        }
      }' "$file"
  else
    echo "-1"
  fi
}

# A /proc/meminfo row in mebibytes.
meminfo_mb() {
  awk -v key="$1" '$1 == key ":" { printf "%d", $2 / 1024 }' /proc/meminfo
}

# A /proc/vmstat counter.
vmstat_count() {
  awk -v key="$1" '$1 == key { print $2 }' /proc/vmstat
}

# The environment the gate runs in, recorded once so the samples can be read
# against the machine's actual size rather than the runner's advertised one.
facts() {
  {
    echo "recorded: $(now)"
    echo "--- kernel"
    uname -a
    echo "--- cpus"
    nproc
    grep -m1 'model name' /proc/cpuinfo || true
    echo "--- memory"
    free -m
    echo "--- meminfo"
    cat /proc/meminfo
    echo "--- swap"
    cat /proc/swaps
    echo "--- vm"
    for key in overcommit_memory overcommit_ratio swappiness max_map_count; do
      echo "$key=$(read_or_absent "/proc/sys/vm/$key")"
    done
    echo "--- pressure"
    for kind in memory cpu io; do
      echo "$kind: $(read_or_absent "/proc/pressure/$kind" | tr '\n' ' ')"
    done
    echo "--- cgroup"
    for key in memory.max memory.high memory.swap.max cpu.max; do
      echo "$key=$(read_or_absent "/sys/fs/cgroup/$key")"
    done
    echo "--- disks"
    df -h / /home /tmp /mnt/c 2>&1 || true
    findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS / /home /tmp 2>&1 || true
    echo "--- wsl.conf"
    read_or_absent /etc/wsl.conf
    echo "--- deno"
    /usr/local/bin/deno --version 2>&1 || true
    echo "--- gate user limits"
    runuser -u gate -- bash -c 'ulimit -a' 2>&1 || true
    echo "--- lock files (inode numbers match /proc/locks)"
    find /home/gate/discern/node_modules/.deno -maxdepth 1 -iname '*lock*' -exec ls -li {} + 2>/dev/null || true
    find /home/gate/.cache/deno -maxdepth 3 -name '*.lock*' -exec ls -li {} + 2>/dev/null || true
    echo "--- processes"
    ps -eo pid,ppid,pgid,user,stat,rss,etimes,args --sort=pid | cut -c1-200
  } > "$facts_file" 2>&1
}

# The gate spawns every job as `sh -c <command>` leading its own process
# group, so the leaders alone give each producer's start and lifetime.
job_leaders() {
  ps -eo pid=,pgid=,etimes=,args= | awk '
    $1 == $2 && $4 == "sh" && $5 == "-c" {
      cmd = ""
      for (i = 6; i <= NF; i++) cmd = cmd (i > 6 ? " " : "") $i
      print "pgid=" $2 " etimes=" $3 " cmd=" substr(cmd, 1, 140)
    }'
}

# One line per Deno process: group, scheduler state, memory, age, and the
# kernel function it waits in, so a stalled producer reads directly.
deno_processes() {
  local pid status state rss swap pgid etimes wchan cmd
  for pid in $(pgrep -x deno); do
    status="/proc/$pid/status"
    [ -r "$status" ] || continue
    state="$(awk '/^State:/ { print $2 }' "$status")"
    rss="$(awk '/^VmRSS:/ { print $2 }' "$status")"
    swap="$(awk '/^VmSwap:/ { print $2 }' "$status")"
    read -r pgid etimes < <(ps -o pgid=,etimes= -p "$pid" 2>/dev/null) || true
    wchan="$(read_or_absent "/proc/$pid/wchan")"
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-160)"
    echo "pid=$pid pgid=${pgid:-?} state=${state:-?} rss_kb=${rss:-0} swap_kb=${swap:-0} etimes=${etimes:-?} wchan=$wchan cmd=$cmd"
  done
}

# One sample: a machine-readable SAMPLE line, then the detail behind it.
sample() {
  local ts epoch load deno_rows deno_count deno_running deno_disk locks oom
  ts="$(now)"
  epoch="$(date -u +%s)"
  load="$(cut -d' ' -f1-3 /proc/loadavg)"
  deno_rows="$(deno_processes)"
  deno_count="$(printf '%s\n' "$deno_rows" | grep -c '^pid=' || true)"
  deno_running="$(printf '%s\n' "$deno_rows" | grep -c ' state=R ' || true)"
  deno_disk="$(printf '%s\n' "$deno_rows" | grep -c ' state=D ' || true)"
  locks="$(read_or_absent /proc/locks)"
  oom="$(dmesg 2>/dev/null | grep -i -E 'out of memory|oom-kill|killed process|invoked oom-killer' | tail -n 5 || true)"
  echo "=== sample $ts load=$load"
  echo "SAMPLE ts=$ts epoch=$epoch" \
    "mem_total_mb=$(meminfo_mb MemTotal) mem_avail_mb=$(meminfo_mb MemAvailable)" \
    "swap_total_mb=$(meminfo_mb SwapTotal) swap_free_mb=$(meminfo_mb SwapFree)" \
    "psi_mem_some10=$(psi_value /proc/pressure/memory some avg10)" \
    "psi_mem_full10=$(psi_value /proc/pressure/memory full avg10)" \
    "psi_cpu_some10=$(psi_value /proc/pressure/cpu some avg10)" \
    "psi_io_some10=$(psi_value /proc/pressure/io some avg10)" \
    "psi_io_full10=$(psi_value /proc/pressure/io full avg10)" \
    "pswpin=$(vmstat_count pswpin) pswpout=$(vmstat_count pswpout) pgmajfault=$(vmstat_count pgmajfault)" \
    "procs=$(ps -e --no-headers | wc -l) deno=$deno_count deno_running=$deno_running deno_disk=$deno_disk" \
    "locks=$(printf '%s\n' "$locks" | grep -c '^[0-9]' || true)"
  echo "--- jobs"
  job_leaders
  echo "--- deno"
  printf '%s\n' "$deno_rows"
  echo "--- top (resident set)"
  ps -eo pid,pgid,user,stat,wchan:20,pcpu,pmem,rss,etimes,args --sort=-rss | head -n 21 | cut -c1-200
  echo "--- locks"
  printf '%s\n' "$locks"
  echo "--- oom"
  printf '%s\n' "${oom:-none}"
}

# The headline figures from every SAMPLE line, the producers' lifetimes from
# the job leaders, and every out-of-memory kill the kernel reported.
summary() {
  echo "::group::WSL 2 VM samples: summary"
  if [ ! -s "$samples_file" ]; then
    echo "no samples recorded"
    echo "::endgroup::"
    return 0
  fi
  echo "--- environment"
  grep -E '^(Mem(Total|Available)|Swap(Total|Free)):' "$facts_file" 2>/dev/null || true
  echo "cpus: $(nproc)"
  echo "--- across the samples"
  awk '
    function num(s) { return s + 0 }
    /^SAMPLE / {
      n++
      for (i = 2; i <= NF; i++) { split($i, kv, "="); v[kv[1]] = kv[2] }
      epoch = num(v["epoch"])
      if (n == 1) {
        first = epoch; first_ts = v["ts"]
        min_avail = num(v["mem_avail_mb"]); min_swap = num(v["swap_free_mb"])
        pswpout0 = num(v["pswpout"]); pgmaj0 = num(v["pgmajfault"])
      } else if (epoch - last > max_gap) {
        max_gap = epoch - last; max_gap_at = epoch - first
      }
      last = epoch
      if (num(v["mem_avail_mb"]) <= min_avail) { min_avail = num(v["mem_avail_mb"]); min_avail_at = epoch - first }
      if (num(v["swap_free_mb"]) <= min_swap) { min_swap = num(v["swap_free_mb"]); min_swap_at = epoch - first }
      if (num(v["psi_mem_some10"]) > max_mem_some) max_mem_some = num(v["psi_mem_some10"])
      if (num(v["psi_mem_full10"]) > max_mem_full) { max_mem_full = num(v["psi_mem_full10"]); max_mem_full_at = epoch - first }
      if (num(v["psi_cpu_some10"]) > max_cpu_some) max_cpu_some = num(v["psi_cpu_some10"])
      if (num(v["psi_io_full10"]) > max_io_full) max_io_full = num(v["psi_io_full10"])
      if (num(v["deno"]) > max_deno) max_deno = num(v["deno"])
      if (num(v["deno_disk"]) > max_deno_disk) { max_deno_disk = num(v["deno_disk"]); max_deno_disk_at = epoch - first }
      pswpout1 = num(v["pswpout"]); pgmaj1 = num(v["pgmajfault"])
      next
    }
    /^--- jobs/ { in_jobs = 1; next }
    /^--- / { in_jobs = 0 }
    in_jobs && /^pgid=/ {
      split($1, a, "="); pg = a[2]
      split($2, b, "="); age = num(b[2])
      if (!(pg in job_start)) {
        job_start[pg] = epoch - age - first
        line = $0
        sub(/^pgid=[0-9]+ etimes=[0-9]+ cmd=/, "", line)
        job_cmd[pg] = line
      }
      job_last[pg] = epoch - first
    }
    END {
      printf "samples: %d, first at %s, spanning %ds, longest gap between samples %ds (at +%ds)\n", n, first_ts, last - first, max_gap, max_gap_at
      printf "memory: lowest available %d MiB at +%ds; swap: lowest free %d MiB at +%ds; pages swapped out %d; major faults %d\n", min_avail, min_avail_at, min_swap, min_swap_at, pswpout1 - pswpout0, pgmaj1 - pgmaj0
      printf "pressure (avg10 peaks): memory some %.2f, memory full %.2f at +%ds, cpu some %.2f, io full %.2f\n", max_mem_some, max_mem_full, max_mem_full_at, max_cpu_some, max_io_full
      printf "deno processes: most seen at once %d; most in disk wait at once %d at +%ds\n", max_deno, max_deno_disk, max_deno_disk_at
      print "--- gate jobs (start, last seen, seconds after the first sample)"
      for (pg in job_start) printf "%6d %6d %s\n", job_start[pg], job_last[pg], job_cmd[pg] | "sort -n"
      close("sort -n")
    }' "$samples_file"
  echo "--- out-of-memory kills"
  grep -h -i -E 'out of memory|oom-kill|killed process|invoked oom-killer' "$samples_file" | sort -u | head -n 20 || true
  echo "::endgroup::"
}

run() {
  echo $$ > "$pid_file"
  trap 'exit 0' TERM INT
  while :; do
    sample >> "$samples_file"
    sleep "$interval" &
    wait $!
  done
}

start() {
  mkdir -p "$dir"
  facts
  setsid nohup "$0" run "$dir" "$interval" > "$log_file" 2>&1 < /dev/null &
  echo "VM sampler started: every ${interval}s into $dir"
}

stop() {
  local pid waited
  if [ -r "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    kill "$pid" 2>/dev/null || true
    waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 30 ]; do
      sleep 1
      waited=$((waited + 1))
    done
  fi
  sample >> "$samples_file"
  summary
}

case "$mode" in
  start) start ;;
  stop) stop ;;
  summary) summary ;;
  run) run ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 64
    ;;
esac
