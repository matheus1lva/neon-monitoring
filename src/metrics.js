// Metric definitions + pure data helpers, ported from the original single-file dashboard.

export function bytes(b) {
  if (b == null) return '–'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return v.toFixed(v < 10 && i > 0 ? 2 : 1) + ' ' + u[i]
}

// v1 consumption_history (4 hourly metrics, flat rows). CPU/activity detail not in v2.
export const METRICS = [
  { id: 'cores', title: 'CPU used', sub: 'avg cores = compute_time_seconds / bucket (set granularity=hourly for finer curve)', color: '#58a6ff',
    val: (r, span) => r.compute_time_seconds / span, unit: 'cores', dp: 2, peak: true },
  { id: 'cpuhours', title: 'CPU usage hours', sub: 'compute-hours = compute_time_seconds / 3600 (CPU usage, not utilization)', color: '#388bfd',
    val: r => r.compute_time_seconds / 3600, unit: 'compute-hrs', dp: 1, total: true, cumulative: true },
  { id: 'active', title: 'Active endpoint time', sub: 'active_time_seconds / 3600 (wall time computes ran, NOT CPU-weighted)', color: '#3fb950',
    val: r => r.active_time_seconds / 3600, unit: 'endpoint-hrs', dp: 1, total: true, cumulative: true },
  { id: 'written', title: 'Data written', sub: 'written_data_bytes / 1e6', color: '#d29922',
    val: r => r.written_data_bytes / 1e6, unit: 'MB', dp: 1, total: true, cumulative: true },
  { id: 'storage', title: 'Storage size', sub: 'synthetic_storage_size_bytes / 1e9 (snapshot, not summed)', color: '#bc8cff',
    val: r => r.synthetic_storage_size_bytes / 1e9, unit: 'GB', dp: 2, total: false },
]

// v2 consumption_history (/consumption_history/v2/projects) — billing-aligned metrics.
// `key` is the API metric_name (also sent in the required metrics= param); rows are flattened
// from the v2 [{metric_name,value}] form into r[key] before these accessors run. Additive
// metrics (compute units, network transfer) carry cumulative:true for the running-sum toggle.
export const METRICS_V2 = [
  { id: 'cu', key: 'compute_unit_seconds', title: 'Compute units', sub: 'compute_unit_seconds / 3600 — billing compute (CU-hours)', color: '#388bfd',
    val: r => r.compute_unit_seconds / 3600, unit: 'CU-hrs', dp: 2, total: true, cumulative: true },
  { id: 'rootbr', key: 'root_branch_bytes_month', title: 'Root branch storage', sub: 'root_branch_bytes_month / 1e9 (primary branches)', color: '#bc8cff',
    val: r => r.root_branch_bytes_month / 1e9, unit: 'GB', dp: 2 },
  { id: 'childbr', key: 'child_branch_bytes_month', title: 'Child branch storage', sub: 'child_branch_bytes_month / 1e9 (delta from parent)', color: '#a371f7',
    val: r => r.child_branch_bytes_month / 1e9, unit: 'GB', dp: 2 },
  { id: 'pitr', key: 'instant_restore_bytes_month', title: 'Instant restore (PITR)', sub: 'instant_restore_bytes_month / 1e9 (WAL history)', color: '#39c5cf',
    val: r => r.instant_restore_bytes_month / 1e9, unit: 'GB', dp: 2 },
  { id: 'snap', key: 'snapshot_storage_bytes_month', title: 'Snapshot storage', sub: 'snapshot_storage_bytes_month / 1e9', color: '#db61a2',
    val: r => r.snapshot_storage_bytes_month / 1e9, unit: 'GB', dp: 2 },
  { id: 'pubnet', key: 'public_network_transfer_bytes', title: 'Public egress', sub: 'public_network_transfer_bytes / 1e6 (public internet)', color: '#d29922',
    val: r => r.public_network_transfer_bytes / 1e6, unit: 'MB', dp: 1, total: true, cumulative: true },
  { id: 'privnet', key: 'private_network_transfer_bytes', title: 'Private transfer', sub: 'private_network_transfer_bytes / 1e6 (PrivateLink)', color: '#e3b341',
    val: r => r.private_network_transfer_bytes / 1e6, unit: 'MB', dp: 1, total: true, cumulative: true },
  { id: 'xbranch', key: 'extra_branches_month', title: 'Extra branches', sub: 'extra_branches_month (active branches over plan allowance)', color: '#f85149',
    val: r => r.extra_branches_month, unit: 'branches', dp: 0, peak: true },
]

// Current-billing-period snapshots from project/branch detail (not in consumption_history).
export const SNAP = [
  { id: 'transfer', title: 'Data transfer (egress)', src: 'project', val: p => p.data_transfer_bytes, fmt: bytes },
  { id: 'dbsize', title: 'DB size (logical)', src: 'branches', val: bs => bs.reduce((a, b) => a + (b.logical_size || 0), 0), fmt: bytes },
  { id: 'storehr', title: 'Data storage', src: 'project', val: p => p.data_storage_bytes_hour, fmt: v => (v / 1e9).toFixed(2) + ' GB·hr' },
  { id: 'cpu', title: 'CPU used', src: 'project', val: p => p.cpu_used_sec / 3600, fmt: v => v.toFixed(1) + ' compute-hrs' },
  { id: 'synth', title: 'Storage (current)', src: 'project', val: p => p.synthetic_storage_size, fmt: bytes },
]

export function rowsFrom(j) {
  return (j.projects || []).flatMap(p => (p.periods || []).flatMap(pe => pe.consumption || []))
    .sort((a, b) => a.timeframe_start.localeCompare(b.timeframe_start))
}

// v2 rows carry metrics as [{metric_name,value}]; flatten to r[metric_name] so the m.val
// accessors work the same as v1's flat rows.
export function flattenV2(j) {
  for (const p of j.projects || [])
    for (const pe of p.periods || [])
      for (const r of pe.consumption || [])
        for (const mm of r.metrics || []) r[mm.metric_name] = mm.value
  return j
}

// Merge rows into per-timeframe buckets (summing across projects), optionally running-sum.
// `|| 0` guards undefined/NaN values: a single missing v2 metric must not poison the whole
// series — that was the bug behind "0.0 total" and the cumulative line disappearing.
export function bucketPoints(rows, m, span, accumulate) {
  const buckets = new Map()
  for (const r of rows) {
    const t = r.timeframe_start
    buckets.set(t, (buckets.get(t) || 0) + (m.val(r, span) || 0))
  }
  let acc = 0
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, y]) => ({
    x: new Date(t).getTime(),
    y: accumulate ? (acc += y) : y,
  }))
}

export function rawTotal(rows, m, span) {
  return rows.reduce((sum, r) => sum + (m.val(r, span) || 0), 0)
}
