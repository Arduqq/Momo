import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings as SettingsIcon, X, Save } from 'lucide-react';

interface SettingsProps {
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.ipcRenderer.invoke('get-store-value', 'zotero-user-id').then((v: string) => setUserId(v || ''));
    window.ipcRenderer.invoke('get-store-value', 'zotero-api-key').then((v: string) => setApiKey(v || ''));
  }, []);

  const handleSave = async () => {
    await window.ipcRenderer.invoke('set-store-value', 'zotero-user-id', userId);
    await window.ipcRenderer.invoke('set-store-value', 'zotero-api-key', apiKey);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1500);
  };

  return createPortal(
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '32px',
        borderRadius: '12px',
        width: '400px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        position: 'relative'
      }}>
        <button 
          onClick={onClose}
          style={{ position: 'absolute', right: '16px', top: '16px', border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <SettingsIcon size={24} color="#333" />
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>Zotero Settings</h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#666' }}>User ID</label>
            <input 
              type="text" 
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="e.g. 1234567"
              style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#666' }}>API Key</label>
            <input 
              type="password" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your Zotero API Key"
              style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' }}
            />
          </div>

          <button 
            onClick={handleSave}
            disabled={saved}
            style={{
              marginTop: '12px',
              padding: '12px',
              backgroundColor: saved ? '#10b981' : '#333',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background-color 0.2s'
            }}
          >
            {saved ? <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Save size={18} /> Saved!</span> : 'Save Settings'}
          </button>
          
          <p style={{ fontSize: '11px', color: '#888', marginTop: '8px', lineHeight: '1.4' }}>
            Your credentials are saved locally on your MacBook.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};
