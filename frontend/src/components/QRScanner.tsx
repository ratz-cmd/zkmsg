import { useState } from 'react';
import { Camera } from 'lucide-react';

interface QRScannerProps {
  onScanSuccess: (payloadBase58: string) => void;
}

export function QRScanner({ onScanSuccess }: QRScannerProps) {
  const [debugPayload, setDebugPayload] = useState('');

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-6 bg-white/50 dark:bg-black/50 backdrop-blur-apple rounded-3xl border border-apple-border dark:border-apple-darkBorder shadow-2xl">
      <div className="flex flex-col items-center space-y-2 mb-2">
        <h2 className="text-xl font-medium tracking-tight">Scanner QR Code</h2>
        <p className="text-sm text-gray-500 text-center max-w-xs">
          Scannez le QR code affiché sur l'appareil distant pour établir la connexion E2EE.
        </p>
      </div>

      <div className="w-64 h-64 bg-gray-200/50 dark:bg-gray-800/50 rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-gray-400 dark:border-gray-600">
        <Camera size={48} className="text-gray-400 mb-2 opacity-50" />
        <p className="text-sm text-gray-500 font-medium">Flux Caméra (En Attente...)</p>
      </div>
      
      {/* 
        LOCAL DEBUG MODE
        Ajout du champ de texte pour simuler le scan (bypass webcam) 
        permettant le test sur une seule machine (Alice & Bob).
      */}
      <div className="w-full mt-6 border-t border-apple-border dark:border-apple-darkBorder pt-6">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 block">
          Debug Mode Local
        </label>
        <div className="flex flex-col space-y-3">
          <input 
            type="text" 
            placeholder="Coller la chaîne Base58 générée..." 
            value={debugPayload}
            onChange={(e) => setDebugPayload(e.target.value)}
            className="w-full bg-white dark:bg-gray-800 border border-apple-border dark:border-apple-darkBorder rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-apple-blue font-mono"
          />
          <button 
            onClick={() => { if (debugPayload.trim()) onScanSuccess(debugPayload.trim()); }}
            className="w-full py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-apple-text dark:text-apple-darkText text-sm font-medium rounded-xl transition-colors"
          >
            Debug: Coller Payload
          </button>
        </div>
      </div>
    </div>
  );
}
