export const cleanInterfaceName = (name) => {
  if (!name) return ''
  let cleaned = name.trim()
  // Matches ge-, xe-, et-, ae-, fxp-, em-, me-, irb-, vtep-, lo-, vlan-, etc.
  const isJuniperFormat = /^(ge|xe|et|ae|fxp|em|me|irb|vtep|lo|vlan)/i.test(cleaned)
  if (isJuniperFormat) {
    // Discard trailing parser space-separated integers/flags (e.g. "ge-0/0/5.0 0 0" -> "ge-0/0/5.0")
    cleaned = cleaned.split(/\s+/)[0]
    // Strip trailing .0 or similar subinterface suffixes (.0, .0.0, .0.0.0, etc.)
    cleaned = cleaned.replace(/\.0+(\.0+)*$/, '')
    if (cleaned.toLowerCase() === 'vtep') {
      cleaned = 'VTEP'
    }
  }
  return cleaned
}

export const getPortLabel = (name) => {
  const cleaned = cleanInterfaceName(name)
  const match = cleaned.match(/(\d+)$/)
  return match ? match[1] : cleaned
}
