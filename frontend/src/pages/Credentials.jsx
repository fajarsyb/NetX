import { useState, useEffect } from 'react';
import api from '../api/client';
import { FiPlus, FiTrash2, FiLock, FiUser, FiTag } from 'react-icons/fi';

function Credentials() {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', username: '', password: '' });

  const fetchCredentials = async () => {
    try {
      const res = await api.getCredentials();
      setCredentials(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.createCredential(formData);
      setFormData({ name: '', username: '', password: '' });
      setShowModal(false);
      fetchCredentials();
    } catch (err) {
      alert(err.response?.data?.detail || 'Gagal menambahkan profil');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Hapus profil credential ini?')) return;
    try {
      await api.deleteCredential(id);
      fetchCredentials();
    } catch (err) {
      alert(err.response?.data?.detail || 'Gagal menghapus');
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-400 text-lg">Memuat Profil...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
            Credential Profiles
          </h1>
          <p className="text-slate-400 mt-1">Kelola profil kredensial aman untuk masuk ke perangkat</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg shadow-cyan-500/25 transition-all active:scale-95"
        >
          <FiPlus className="w-5 h-5" />
          <span>Tambah Profil</span>
        </button>
      </div>

      {credentials.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-12 text-center">
          <FiLock className="w-16 h-16 mx-auto text-slate-600 mb-4" />
          <h3 className="text-xl font-medium text-slate-300 mb-2">Belum ada profil</h3>
          <p className="text-slate-500">Tambahkan profil kredensial untuk mempermudah saat menambah perangkat.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {credentials.map(cred => (
            <div key={cred.id} className="bg-slate-800/80 border border-slate-700/50 rounded-2xl p-5 flex items-center justify-between group hover:border-cyan-500/30 transition-colors">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center text-cyan-400 border border-slate-700">
                  <FiLock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-200">{cred.name}</h3>
                  <p className="text-slate-400 text-sm flex items-center mt-1">
                    <FiUser className="w-3.5 h-3.5 mr-1.5" />
                    {cred.username}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(cred.id)}
                className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-900/50 transition-colors opacity-0 group-hover:opacity-100"
                title="Hapus Profil"
              >
                <FiTrash2 className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-bold text-slate-100 mb-6">Profil Baru</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Nama Profil</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiTag className="text-slate-500" />
                  </div>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-200 transition-all"
                    placeholder="Contoh: Cisco Global SSH"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiUser className="text-slate-500" />
                  </div>
                  <input
                    type="text"
                    required
                    value={formData.username}
                    onChange={e => setFormData({ ...formData, username: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-200 transition-all"
                    placeholder="admin"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiLock className="text-slate-500" />
                  </div>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-200 transition-all"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="flex space-x-3 pt-4 mt-6 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl font-medium shadow-lg shadow-cyan-500/25 transition-all"
                >
                  Simpan Profil
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Credentials;
