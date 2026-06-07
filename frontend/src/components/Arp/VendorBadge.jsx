const CATEGORY_CONFIG = {
  networking: { icon: '🖥', label: 'Networking' },
  endpoint:   { icon: '💻', label: 'Endpoint' },
  printer:    { icon: '🖨', label: 'Printer' },
  phone:      { icon: '📱', label: 'Phone' },
  iot:        { icon: '🔌', label: 'IoT' },
  unknown:    { icon: '❓', label: 'Unknown' },
}

export default function VendorBadge({ vendor, category, showIcon = true }) {
  const cfg = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.unknown
  const displayName = vendor && vendor !== 'Unknown' ? vendor : cfg.label

  return (
    <span
      className={`vendor-badge ${category || 'unknown'}`}
      title={vendor || 'Unknown Vendor'}
    >
      {showIcon && <span style={{ flexShrink: 0 }}>{cfg.icon}</span>}
      <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{displayName}</span>
    </span>
  )
}
