import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
})

export const devicesApi = {
  list:           ()         => api.get('/devices'),
  exportCsv:      (params)   => api.get('/devices/export/csv', { params, responseType: 'blob' }),
  importCsv:      (file)     => api.post('/devices/import/csv', file, { headers: { 'Content-Type': 'multipart/form-data' } }),
  get:            (id)       => api.get(`/devices/${id}`),
  create:         (data)     => api.post('/devices', data),
  update:         (id, data) => api.put(`/devices/${id}`, data),
  remove:         (id)       => api.delete(`/devices/${id}`),
  testConnection: (id)       => api.post(`/devices/${id}/test-connection`),
  testConnectionRaw: (data)  => api.post(`/devices/test-connection-raw`, data),
  getTypes:       ()         => api.get('/devices/device-types'),
  bulkRefresh:    (data)     => api.post('/devices/bulk-refresh', data),
  getBulkRefreshStatus: (taskId) => api.get(`/devices/bulk-refresh/${taskId}`),
  getPortMap:     (id)       => api.get(`/devices/${id}/port-map`),
  getPortAnalysis: (id)      => api.get(`/devices/${id}/port-analysis`),
  getL2Overview:  (id)       => api.get(`/devices/${id}/l2/overview`),
  getL2Ports:     (id)       => api.get(`/devices/${id}/l2/ports`),
  getL2Stp:       (id)       => api.get(`/devices/${id}/l2/stp`),
  getL2Vlans:     (id)       => api.get(`/devices/${id}/l2/vlans`),
  getL2Macs:      (id)       => api.get(`/devices/${id}/l2/macs`),
  getL2Timeline:  (id)       => api.get(`/devices/${id}/l2/timeline`),
  getL2Lifecycle: (id)       => api.get(`/devices/${id}/l2/lifecycle`),
  refreshL2:      (id)       => api.post(`/devices/${id}/l2/refresh`),
  ping:           (id)       => api.post(`/devices/${id}/ping`),
  getPingHistory: (id)       => api.get(`/devices/${id}/ping/history`),
  bulkPing:       (data)     => api.post('/devices/bulk-ping', data),
  getBulkPingStatus: (taskId) => api.get(`/devices/bulk-ping/${taskId}`),
  getSerialPorts: ()         => api.get('/terminal/serial-ports'),
}

export const groupsApi = {
  list:   ()         => api.get('/groups'),
  create: (data)     => api.post('/groups', data),
  update: (id, data) => api.put(`/groups/${id}`, data),
  remove: (id)       => api.delete(`/groups/${id}`),
  refresh: (id)      => api.post(`/groups/${id}/refresh`),
}

export const credentialsApi = {
  list:             ()         => api.get('/credentials'),
  create:           (data)     => api.post('/credentials', data),
  remove:           (id)       => api.delete(`/credentials/${id}`),
  getCompliance:    ()         => api.get('/credentials/compliance'),
  runScan:          (data)     => api.post('/credentials/compliance/scan', data),
  scanTarget:       (data)     => api.post('/credentials/scan-target', data),
}

export const arpApi = {
  getSummary:  ()   => api.get('/arp/summary'),
  getCache:    (id) => api.get(`/devices/${id}/arp`),
  refresh:     (id) => api.post(`/devices/${id}/arp/refresh`),
  getHistory:  (id) => api.get(`/arp/history/${id}`),
  lookupMac:   (mac) => api.get('/mac/lookup', { params: { mac } }),
  getAll:      ()   => api.get('/arp/all'),
  getNetworkHistory: (timeframe) => api.get('/network/history', { params: { timeframe } }),
}

export const lldpApi = {
  getSummary:  ()   => api.get('/lldp/summary'),
  getCache:    (id) => api.get(`/devices/${id}/lldp`),
  refresh:     (id) => api.post(`/devices/${id}/lldp/refresh`),
  getAll:      ()   => api.get('/lldp/all'),
}

export const cdpApi = {
  getCache:    (id) => api.get(`/devices/${id}/cdp`),
  refresh:     (id) => api.post(`/devices/${id}/cdp/refresh`),
}

export const routingApi = {
  getCache:    (id) => api.get(`/devices/${id}/routing`),
  refresh:     (id) => api.post(`/devices/${id}/routing/refresh`),
}

export const topologyApi = {
  get: (groupId) => api.get('/topology', { params: { group_id: groupId } }),
  savePositions: (positions) => api.post('/topology/positions', positions),
}

export const snmpApi = {
  test:          (deviceId) => api.post(`/snmp/test/${deviceId}`),
  detectInfo:    (deviceId, method = 'auto') => api.post(`/snmp/detect-info/${deviceId}`, null, { params: { method } }),
  testRaw:       (data)     => api.post('/snmp/test-raw', data),
  getInterfaces: (deviceId) => api.get(`/snmp/interfaces/${deviceId}`),
  queryCustom:   (data)     => api.post('/snmp/query-custom', data),
  getL2Status:   (deviceId) => api.get(`/snmp/l2-status/${deviceId}`),
}

export const macApi = {
  getSummary:  ()   => api.get('/mac/summary'),
  getCache:    (id) => api.get(`/devices/${id}/mac`),
  refresh:     (id) => api.post(`/devices/${id}/mac/refresh`),
  investigate: (mac) => api.get('/mac/investigate', { params: { mac } }),
  scanAll:     () => api.post('/mac/scan-all'),
  getAll:      ()   => api.get('/mac/all'),
}

export const auditLogsApi = {
  list: (params) => api.get('/audit-logs', { params }),
}

export const backupApi = {
  list:    ()         => api.get('/backups'),
  create:  ()         => api.post('/backups'),
  restore: (filename) => api.post(`/backups/${filename}/restore`),
  remove:  (filename) => api.delete(`/backups/${filename}`),
}

export const remoteBackupsApi = {
  getSettings:   ()     => api.get('/remote-backups'),
  saveSettings:  (data) => api.post('/remote-backups', data),
  testConnection: (data) => api.post('/remote-backups/test', data),
  uploadLatestDb: ()     => api.post('/remote-backups/upload-db'),
}

export const deviceBackupApi = {
  list:           () => api.get('/device-backups'),
  listDevices:    () => api.get('/device-backups/devices'),
  listVersions:   (deviceId) => api.get(`/device-backups/versions/${deviceId}`),
  get:            (backupId) => api.get(`/device-backups/${backupId}`),
  create:         (deviceId) => api.post(`/device-backups/backup/${deviceId}`),
  remove:         (backupId) => api.delete(`/device-backups/${backupId}`),
  diff:           (id1, id2) => api.get(`/device-backups/diff/${id1}/${id2}`),
  listSchedules:  () => api.get('/device-backups/schedules'),
  createSchedule: (data) => api.post('/device-backups/schedules', data),
  updateSchedule: (id, data) => api.put(`/device-backups/schedules/${id}`, data),
  removeSchedule: (id) => api.delete(`/device-backups/schedules/${id}`),
  runSchedule:    (id) => api.post(`/device-backups/schedules/${id}/run`),
}

export const mibsApi = {
  list:             ()         => api.get('/mibs'),
  import:           (formData) => api.post('/mibs/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update:           (id, data) => api.put(`/mibs/${id}`, data),
  remove:           (id)       => api.delete(`/mibs/${id}`),
  listObjects:      (id)       => api.get(`/mibs/${id}/objects`),
  getActiveObjects: (params)   => api.get('/mibs/objects/active', { params }),
  updateObject:     (objectId, data) => api.put(`/mibs/objects/${objectId}`, data),
}

export const anomaliesApi = {
  getActive:  ()       => api.get('/anomalies/active'),
  getHistory: (params) => api.get('/anomalies/history', { params }),
  resolve:    (id)     => api.post(`/anomalies/${id}/resolve`),
  resolveAll: ()       => api.post('/anomalies/resolve-all'),
  getDeviceSummary: () => api.get('/anomalies/device-summary'),
  getRca:     ()       => api.get('/anomalies/rca'),
}

export const syslogApi = {
  list:  (params) => api.get('/syslog', { params }),
  clear: ()       => api.delete('/syslog/clear'),
  getSenders: ()  => api.get('/syslog/senders'),
  getPatterns: () => api.get('/syslog/patterns'),
  updatePattern: (hash, data) => api.put(`/syslog/patterns/${hash}`, data),
}

export const thresholdsApi = {
  list:   ()         => api.get('/thresholds'),
  get:    (id)       => api.get(`/thresholds/${id}`),
  create: (data)     => api.post('/thresholds', data),
  update: (id, data) => api.put(`/thresholds/${id}`, data),
  remove: (id)       => api.delete(`/thresholds/${id}`),
}


export const dbSettingsApi = {
  getCurrent:       () => api.get('/db-settings/current'),
  save:             (data) => api.post('/db-settings/save', data),
  testConnection:   (data) => api.post('/db-settings/test-connection', data),
  activatePostgres: (data) => api.post('/db-settings/activate-postgresql', data),
  revertSqlite:     () => api.post('/db-settings/revert-sqlite'),
  getSqliteTables:  () => api.get('/db-settings/sqlite-tables'),
}

export const healthApi = {
  getDiagnostics: () => api.get('/health/diagnostics'),
}

export default api

