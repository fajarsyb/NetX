import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BookOpen, Folder, FolderOpen, FileText, Plus, Trash2, Edit2, Copy, Star,
  Share2, Download, Upload, Search, ChevronRight, ChevronDown, Tag, X,
  Terminal, Play, Check, AlertCircle, FolderPlus, Heart, Filter, Maximize2,
  Eye, Code2, Variable, MoreVertical
} from 'lucide-react'
import api from '../../api/client'

// ─── Vendor color hints ───────────────────────────────────────────────────────
const VENDOR_COLORS = {
  cisco:    '#049fd9',
  juniper:  '#84b135',
  huawei:   '#cf0a2c',
  mikrotik: '#a01f2d',
  aruba:    '#f26522',
  fortinet: '#ee3124',
  ruckus:   '#00a6d6',
  '':       'var(--primary)',
}
const vendorColor = (v) => VENDOR_COLORS[(v || '').toLowerCase()] || VENDOR_COLORS['']

// ─── Syntax highlight for CLI content ────────────────────────────────────────
function SyntaxHighlight({ code }) {
  if (!code) return <span className="sh-empty">// empty template</span>

  const highlighted = code
    .replace(/(&)/g, '&amp;')
    .replace(/(<)/g, '&lt;')
    .replace(/\{\{(\w+)\}\}/g, '<span class="sh-var">{{$1}}</span>')
    .replace(/(^|\n)(#.+)/g, '$1<span class="sh-comment">$2</span>')
    .replace(/(^|\n)(show |display |get |set |no |ip |interface |vlan |router |bgp |ospf |mpls |snmp |logging |version |chassis |route |arp )/gi,
      '$1<span class="sh-keyword">$2</span>')
    .replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, '<span class="sh-ip">$1</span>')

  return (
    <pre className="sh-pre" dangerouslySetInnerHTML={{ __html: highlighted }} />
  )
}

// ─── Variable injection modal ─────────────────────────────────────────────────
function VariableModal({ template, onClose, onExecute }) {
  const vars = template.variables || []
  const [values, setValues] = useState(() => Object.fromEntries(vars.map(v => [v, ''])))

  const resolved = template.content.replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? `{{${name}}}`)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-slide" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Variable size={16} style={{ color: 'var(--primary)' }} />
            Fill Variables — {template.title}
          </div>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {vars.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No variables in this template.</div>
          ) : (
            vars.map(v => (
              <div key={v}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  {'{{'}{v}{'}}'}
                </label>
                <input
                  className="form-control"
                  placeholder={`Enter value for ${v}...`}
                  value={values[v]}
                  onChange={e => setValues(prev => ({ ...prev, [v]: e.target.value }))}
                  style={{ fontSize: 13 }}
                />
              </div>
            ))
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>PREVIEW</div>
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#e6edf3', maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)' }}>
              <SyntaxHighlight code={resolved} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onExecute(resolved)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Play size={13} /> Execute in Terminal
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Template editor modal ────────────────────────────────────────────────────
function TemplateEditor({ template, folders, onClose, onSave }) {
  const [form, setForm] = useState({
    title: template?.title || '',
    content: template?.content || '',
    description: template?.description || '',
    vendor_hint: template?.vendor_hint || '',
    folder_id: template?.folder_id ?? null,
    tags: (template?.tags || []).join(', '),
  })
  const [preview, setPreview] = useState(false)
  const [tagInput, setTagInput] = useState((template?.tags || []).join(', '))

  const vars = (() => {
    const matches = form.content.match(/\{\{(\w+)\}\}/g) || []
    return [...new Set(matches.map(m => m.slice(2, -2)))]
  })()

  const handleSave = () => {
    if (!form.title.trim()) return
    const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean)
    onSave({ ...form, tags, variables: vars })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-slide" style={{ maxWidth: 700, width: '95%' }}>
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} style={{ color: 'var(--primary)' }} />
            {template ? 'Edit Template' : 'New Template'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn btn-sm ${preview ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPreview(p => !p)}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {preview ? <Code2 size={12} /> : <Eye size={12} />}
              {preview ? 'Editor' : 'Preview'}
            </button>
          </div>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title & Folder */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Title *</label>
              <input className="form-control" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Template title..." />
            </div>
            <div>
              <label className="form-label">Folder</label>
              <select className="form-control" value={form.folder_id ?? ''} onChange={e => setForm(f => ({ ...f, folder_id: e.target.value ? parseInt(e.target.value) : null }))}>
                <option value="">— Root (No Folder) —</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.parent_id ? '  └ ' : ''}{f.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="form-label">Description (Markdown supported)</label>
            <textarea className="form-control" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description, troubleshooting steps, notes..." style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
          </div>

          {/* Vendor + Tags */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label className="form-label">Vendor Hint</label>
              <select className="form-control" value={form.vendor_hint} onChange={e => setForm(f => ({ ...f, vendor_hint: e.target.value }))}>
                <option value="">All Vendors</option>
                <option value="cisco">Cisco</option>
                <option value="juniper">Juniper</option>
                <option value="huawei">Huawei</option>
                <option value="mikrotik">MikroTik</option>
                <option value="aruba">Aruba</option>
                <option value="fortinet">Fortinet</option>
                <option value="ruckus">Ruckus</option>
                <option value="ruijie">Ruijie</option>
                <option value="allied_telesis">Allied Telesis</option>
              </select>
            </div>
            <div>
              <label className="form-label">Tags (comma separated)</label>
              <input className="form-control" value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="e.g. routing, interfaces, troubleshooting" />
            </div>
          </div>

          {/* Content / Preview */}
          {preview ? (
            <div>
              <label className="form-label">Preview</label>
              <div style={{ background: '#0d1117', borderRadius: 6, padding: '14px 18px', fontFamily: 'monospace', fontSize: 12.5, color: '#e6edf3', minHeight: 200, border: '1px solid var(--border)' }}>
                <SyntaxHighlight code={form.content} />
              </div>
            </div>
          ) : (
            <div>
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>CLI Content</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Use {'{{variable}}'} for dynamic values</span>
              </label>
              <textarea
                className="form-control"
                rows={10}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder={`show version\nshow interfaces status\nshow ip route\n\n# Use variables:\nshow interface {{interface}}\nshow vlan {{vlan_id}}`}
                style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
              />
            </div>
          )}

          {/* Variables detected */}
          {vars.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Variable size={12} style={{ color: 'var(--warning)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Variables detected:</span>
              {vars.map(v => (
                <span key={v} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: 'var(--warning)', fontFamily: 'monospace' }}>
                  {'{{'}{v}{'}}'}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!form.title.trim()}>
            <Check size={14} /> Save Template
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Folder Tree Node ─────────────────────────────────────────────────────────
function FolderNode({ folder, folders, templates, selectedFolderId, onSelectFolder, onDeleteFolder, onRenameFolder, onNewTemplate, onNewSubFolder, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(folder.name)
  const children = folders.filter(f => f.parent_id === folder.id)
  const tmplCount = templates.filter(t => t.folder_id === folder.id).length
  const isSelected = selectedFolderId === folder.id

  const handleRename = () => {
    if (newName.trim() && newName !== folder.name) onRenameFolder(folder.id, newName.trim())
    setRenaming(false)
  }

  return (
    <div>
      <div
        className={`snotes-folder-row ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: 12 + depth * 16, cursor: 'pointer' }}
        onClick={() => { setOpen(o => !o); onSelectFolder(isSelected ? null : folder.id) }}
      >
        <span className="snotes-folder-arrow">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        {open ? <FolderOpen size={14} style={{ color: '#e8b44b' }} /> : <Folder size={14} style={{ color: '#e8b44b' }} />}
        {renaming ? (
          <input
            autoFocus
            className="snotes-rename-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false) }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="snotes-folder-name">{folder.name}</span>
        )}
        {tmplCount > 0 && <span className="snotes-count">{tmplCount}</span>}
        <div className="snotes-folder-actions" onClick={e => e.stopPropagation()}>
          <button title="New subfolder" onClick={() => onNewSubFolder(folder.id)}><FolderPlus size={11} /></button>
          <button title="New template" onClick={() => onNewTemplate(folder.id)}><Plus size={11} /></button>
          <button title="Rename" onClick={() => setRenaming(true)}><Edit2 size={11} /></button>
          <button title="Delete" onClick={() => onDeleteFolder(folder.id)}><Trash2 size={11} /></button>
        </div>
      </div>
      {open && children.map(child => (
        <FolderNode
          key={child.id}
          folder={child}
          folders={folders}
          templates={templates}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
          onNewTemplate={onNewTemplate}
          onNewSubFolder={onNewSubFolder}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

// ─── Main ShellNotes component ────────────────────────────────────────────────
export default function ShellNotes({ onExecuteCommand }) {
  const [folders, setFolders] = useState([])
  const [templates, setTemplates] = useState([])
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showVarModal, setShowVarModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [newFolderParent, setNewFolderParent] = useState(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [shareUrl, setShareUrl] = useState(null)
  const [vendorFilter, setVendorFilter] = useState('')
  const importRef = useRef()

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [fRes, tRes] = await Promise.all([
        api.get('/shell-notes/folders'),
        api.get('/shell-notes/templates', {
          params: {
            folder_id: selectedFolderId ?? undefined,
            favorites_only: favoritesOnly || undefined,
            search: search || undefined,
          }
        })
      ])
      setFolders(fRes.data)
      setTemplates(tRes.data)
    } catch {
      showToast('Failed to load notes', 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedFolderId, favoritesOnly, search])

  useEffect(() => { load() }, [load])

  // Filtered templates for current view
  const displayedTemplates = templates.filter(t => {
    if (vendorFilter && t.vendor_hint && t.vendor_hint !== vendorFilter) return false
    return true
  })

  // Folders with no parent
  const rootFolders = folders.filter(f => !f.parent_id)

  // ── Folder actions ─────────────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      await api.post('/shell-notes/folders', { name: newFolderName.trim(), parent_id: newFolderParent })
      setNewFolderName(''); setShowNewFolder(false); setNewFolderParent(null)
      showToast('Folder created')
      load()
    } catch { showToast('Failed to create folder', 'error') }
  }

  const handleDeleteFolder = async (id) => {
    if (!window.confirm('Delete this folder and all its contents?')) return
    await api.delete(`/shell-notes/folders/${id}`)
    if (selectedFolderId === id) setSelectedFolderId(null)
    showToast('Folder deleted')
    load()
  }

  const handleRenameFolder = async (id, name) => {
    await api.put(`/shell-notes/folders/${id}`, { name })
    load()
  }

  // ── Template actions ───────────────────────────────────────────────────────
  const handleSaveTemplate = async (form) => {
    try {
      if (editingTemplate?.id) {
        await api.put(`/shell-notes/templates/${editingTemplate.id}`, form)
        showToast('Template updated')
      } else {
        await api.post('/shell-notes/templates', form)
        showToast('Template created')
      }
      setShowEditor(false); setEditingTemplate(null)
      load()
    } catch { showToast('Failed to save template', 'error') }
  }

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm('Delete this template?')) return
    await api.delete(`/shell-notes/templates/${id}`)
    if (selectedTemplate?.id === id) setSelectedTemplate(null)
    showToast('Template deleted')
    load()
  }

  const handleDuplicate = async (id) => {
    const res = await api.post(`/shell-notes/templates/${id}/duplicate`)
    showToast(`Duplicated as "${res.data.title}"`)
    load()
  }

  const handleToggleFavorite = async (t) => {
    const res = await api.post(`/shell-notes/templates/${t.id}/favorite`)
    showToast(res.data.is_favorite ? '⭐ Added to favorites' : 'Removed from favorites')
    load()
  }

  const handleShare = async (t) => {
    const res = await api.post(`/shell-notes/templates/${t.id}/share`)
    const url = `${window.location.origin}/api/shell-notes/shared/${res.data.shared_token}`
    setShareUrl(url)
    navigator.clipboard?.writeText(url)
    showToast('Share link copied!')
  }

  const handleExecute = (cmd) => {
    setShowVarModal(false)
    if (onExecuteCommand) onExecuteCommand(cmd)
    showToast('Command sent to terminal ✓')
  }

  const handleTryExecute = (t) => {
    if ((t.variables || []).length > 0) {
      setSelectedTemplate(t)
      setShowVarModal(true)
    } else {
      handleExecute(t.content)
    }
  }

  // ── Export / Import ────────────────────────────────────────────────────────
  const handleExport = () => {
    window.open('/api/shell-notes/export', '_blank')
    showToast('Export started')
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await api.post('/shell-notes/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      showToast(`Imported ${res.data.imported_folders} folders, ${res.data.imported_templates} templates`)
      load()
    } catch { showToast('Import failed — check file format', 'error') }
    e.target.value = ''
  }

  return (
    <div className="snotes-container">
      {/* ── Toast ─────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`snotes-toast ${toast.type === 'error' ? 'error' : ''}`}>
          {toast.type === 'error' ? <AlertCircle size={14} /> : <Check size={14} />}
          {toast.msg}
        </div>
      )}

      {/* ── LEFT PANEL: Folder Tree ───────────────────────────────────── */}
      <div className="snotes-sidebar">
        <div className="snotes-sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
            <BookOpen size={15} style={{ color: 'var(--primary)' }} />
            Notes
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="snotes-icon-btn" title="New Root Folder" onClick={() => { setNewFolderParent(null); setShowNewFolder(true) }}>
              <FolderPlus size={13} />
            </button>
            <button className="snotes-icon-btn" title="Export All" onClick={handleExport}>
              <Download size={13} />
            </button>
            <button className="snotes-icon-btn" title="Import" onClick={() => importRef.current?.click()}>
              <Upload size={13} />
            </button>
            <input ref={importRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleImport} />
          </div>
        </div>

        {/* New folder input */}
        {showNewFolder && (
          <div className="snotes-new-folder">
            <input
              autoFocus
              className="form-control"
              style={{ fontSize: 12, padding: '4px 8px' }}
              placeholder="Folder name..."
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') } }}
            />
            <button className="btn btn-sm btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={handleCreateFolder}>Create</button>
          </div>
        )}

        <div className="snotes-tree">
          {/* All Notes (root) */}
          <div
            className={`snotes-folder-row ${selectedFolderId === null && !favoritesOnly ? 'active' : ''}`}
            onClick={() => { setSelectedFolderId(null); setFavoritesOnly(false) }}
            style={{ paddingLeft: 12 }}
          >
            <FileText size={14} style={{ color: 'var(--primary)' }} />
            <span className="snotes-folder-name">All Templates</span>
            <span className="snotes-count">{templates.length}</span>
          </div>

          {/* Favorites */}
          <div
            className={`snotes-folder-row ${favoritesOnly ? 'active' : ''}`}
            onClick={() => { setFavoritesOnly(f => !f); setSelectedFolderId(null) }}
            style={{ paddingLeft: 12 }}
          >
            <Star size={14} style={{ color: '#f59e0b' }} />
            <span className="snotes-folder-name">Favorites</span>
          </div>

          <div className="snotes-divider" />

          {/* Folder tree */}
          {rootFolders.map(f => (
            <FolderNode
              key={f.id}
              folder={f}
              folders={folders}
              templates={templates}
              selectedFolderId={selectedFolderId}
              onSelectFolder={setSelectedFolderId}
              onDeleteFolder={handleDeleteFolder}
              onRenameFolder={handleRenameFolder}
              onNewTemplate={(folderId) => { setEditingTemplate({ folder_id: folderId }); setShowEditor(true) }}
              onNewSubFolder={(parentId) => { setNewFolderParent(parentId); setShowNewFolder(true) }}
            />
          ))}
        </div>
      </div>

      {/* ── CENTER PANEL: Template List ───────────────────────────────── */}
      <div className="snotes-list-panel">
        {/* Search & Filters */}
        <div className="snotes-list-toolbar">
          <div className="snotes-search-wrap">
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              className="snotes-search"
              placeholder="Search templates..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setSearch('')}><X size={12} /></button>}
          </div>
          <select
            style={{ fontSize: 11, padding: '4px 8px', background: 'var(--bg-card-2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
          >
            <option value="">All Vendors</option>
            <option value="cisco">Cisco</option>
            <option value="juniper">Juniper</option>
            <option value="huawei">Huawei</option>
            <option value="mikrotik">MikroTik</option>
            <option value="aruba">Aruba</option>
            <option value="fortinet">Fortinet</option>
          </select>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => { setEditingTemplate(selectedFolderId ? { folder_id: selectedFolderId } : {}); setShowEditor(true) }}
            style={{ padding: '5px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
          >
            <Plus size={13} /> New
          </button>
        </div>

        {/* Template cards */}
        <div className="snotes-list">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <div className="loading-spinner" />
            </div>
          ) : displayedTemplates.length === 0 ? (
            <div className="snotes-empty">
              <FileText size={32} style={{ opacity: 0.3 }} />
              <div>No templates yet</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click "+ New" to create your first CLI template</div>
            </div>
          ) : (
            displayedTemplates.map(t => (
              <div
                key={t.id}
                className={`snotes-card ${selectedTemplate?.id === t.id ? 'active' : ''}`}
                onClick={() => setSelectedTemplate(t)}
              >
                {/* Vendor color strip */}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: '4px 0 0 4px', background: vendorColor(t.vendor_hint) }} />

                <div className="snotes-card-header">
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t.is_favorite ? <Star size={12} style={{ color: '#f59e0b', fill: '#f59e0b' }} /> : null}
                    {t.title}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="snotes-action-btn" title="Execute" onClick={e => { e.stopPropagation(); handleTryExecute(t) }}>
                      <Play size={12} />
                    </button>
                    <button className="snotes-action-btn" title="Favorite" onClick={e => { e.stopPropagation(); handleToggleFavorite(t) }}>
                      <Heart size={12} style={{ fill: t.is_favorite ? '#f59e0b' : 'none', color: t.is_favorite ? '#f59e0b' : undefined }} />
                    </button>
                    <button className="snotes-action-btn" title="Edit" onClick={e => { e.stopPropagation(); setEditingTemplate(t); setShowEditor(true) }}>
                      <Edit2 size={12} />
                    </button>
                    <button className="snotes-action-btn" title="Duplicate" onClick={e => { e.stopPropagation(); handleDuplicate(t.id) }}>
                      <Copy size={12} />
                    </button>
                    <button className="snotes-action-btn" title="Share" onClick={e => { e.stopPropagation(); handleShare(t) }}>
                      <Share2 size={12} />
                    </button>
                    <button className="snotes-action-btn danger" title="Delete" onClick={e => { e.stopPropagation(); handleDeleteTemplate(t.id) }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {t.description && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{t.description}</div>
                )}

                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#7dd3fc', background: 'rgba(13,17,23,0.6)', borderRadius: 4, padding: '6px 10px', marginTop: 8, maxHeight: 60, overflow: 'hidden' }}>
                  {t.content?.split('\n').slice(0, 3).join('\n')}
                  {t.content?.split('\n').length > 3 && '\n...'}
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {t.vendor_hint && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, background: vendorColor(t.vendor_hint) + '22', color: vendorColor(t.vendor_hint), fontWeight: 600 }}>
                      {t.vendor_hint.toUpperCase()}
                    </span>
                  )}
                  {(t.variables || []).map(v => (
                    <span key={v} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontFamily: 'monospace' }}>
                      {'{{'}{v}{'}}'}
                    </span>
                  ))}
                  {(t.tags || []).map(tag => (
                    <span key={tag} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: Template Detail ──────────────────────────────── */}
      {selectedTemplate && (
        <div className="snotes-detail-panel">
          <div className="snotes-detail-header">
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{selectedTemplate.title}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => handleTryExecute(selectedTemplate)}
                style={{ padding: '5px 12px', fontSize: 12 }}
              >
                <Play size={12} /> Execute
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelectedTemplate(null)}>
                <X size={12} />
              </button>
            </div>
          </div>

          {selectedTemplate.description && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 16px', borderBottom: '1px solid var(--border)', lineHeight: 1.6 }}>
              {selectedTemplate.description}
            </div>
          )}

          {(selectedTemplate.variables || []).length > 0 && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Variable size={13} style={{ color: 'var(--warning)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Variables:</span>
              {selectedTemplate.variables.map(v => (
                <span key={v} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontFamily: 'monospace' }}>
                  {'{{'}{v}{'}}'}
                </span>
              ))}
            </div>
          )}

          <div style={{ flexGrow: 1, overflow: 'auto', padding: '14px 16px' }}>
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '14px 18px', fontFamily: 'monospace', fontSize: 12.5, color: '#e6edf3', minHeight: 120, border: '1px solid rgba(255,255,255,0.08)' }}>
              <SyntaxHighlight code={selectedTemplate.content} />
            </div>
          </div>

          <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
            <span>Updated: {new Date(selectedTemplate.updated_at).toLocaleDateString()}</span>
            {selectedTemplate.created_by_name && <span>By: {selectedTemplate.created_by_name}</span>}
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {showEditor && (
        <TemplateEditor
          template={editingTemplate}
          folders={folders}
          onClose={() => { setShowEditor(false); setEditingTemplate(null) }}
          onSave={handleSaveTemplate}
        />
      )}

      {showVarModal && selectedTemplate && (
        <VariableModal
          template={selectedTemplate}
          onClose={() => setShowVarModal(false)}
          onExecute={handleExecute}
        />
      )}

      {shareUrl && (
        <div className="modal-overlay" onClick={() => setShareUrl(null)}>
          <div className="modal animate-slide" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title"><Share2 size={15} /> Share Link</div></div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Link copied to clipboard. Share it with your team:</div>
              <input className="form-control" value={shareUrl} readOnly onClick={e => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShareUrl(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
