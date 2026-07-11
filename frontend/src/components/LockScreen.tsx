import { useState, useMemo } from 'react';
import { Lock } from 'lucide-react';

interface LockScreenProps {
  onUnlock: (pin: string) => void;
  error?: string;
}

export function LockScreen({ onUnlock, error }: LockScreenProps) {
  const [pin, setPin] = useState('');

  // Scrambled keypad: randomize 0-9 on every render/mount to prevent keylogging/smudge attacks
  const scrambledKeys = useMemo(() => {
    const keys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
  }, []);

  const handleKeyPress = (digit: string) => {
    const newPin = pin + digit;
    setPin(newPin);
    if (newPin.length === 6) {
      onUnlock(newPin);
      setPin('');
    }
  };

  const handleClear = () => {
    setPin(pin.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-apple-bg/80 dark:bg-apple-darkBg/80 backdrop-blur-apple">
      <div className="flex flex-col items-center space-y-8 p-8 rounded-3xl bg-white/50 dark:bg-black/50 shadow-2xl backdrop-blur-xl border border-apple-border/50 dark:border-apple-darkBorder/50">
        
        <div className="flex flex-col items-center space-y-2">
          <div className="p-4 bg-apple-blue/10 dark:bg-apple-darkBlue/20 rounded-full text-apple-blue dark:text-apple-darkBlue">
            <Lock size={32} />
          </div>
          <h1 className="text-xl font-medium tracking-tight">Enter PIN</h1>
          {error ? (
            <p className="text-sm text-red-500 font-medium h-5">{error}</p>
          ) : (
            <p className="text-sm text-gray-500 h-5">Enter your 6-digit PIN</p>
          )}
        </div>

        {/* PIN Indicators */}
        <div className="flex space-x-3">
          {[...Array(6)].map((_, i) => (
            <div 
              key={i} 
              className={`w-3 h-3 rounded-full transition-colors duration-200 ${
                i < pin.length 
                  ? 'bg-apple-blue dark:bg-apple-darkBlue' 
                  : 'bg-gray-300 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Scrambled Keypad */}
        <div className="grid grid-cols-3 gap-4">
          {scrambledKeys.slice(0, 9).map(digit => (
            <button
              key={digit}
              onClick={() => handleKeyPress(digit)}
              className="w-16 h-16 text-2xl font-light rounded-full bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center justify-center shadow-sm"
            >
              {digit}
            </button>
          ))}
          <div className="w-16 h-16"></div>
          <button
            onClick={() => handleKeyPress(scrambledKeys[9])}
            className="w-16 h-16 text-2xl font-light rounded-full bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center justify-center shadow-sm"
          >
            {scrambledKeys[9]}
          </button>
          <button
            onClick={handleClear}
            disabled={pin.length === 0}
            className="w-16 h-16 text-sm font-medium rounded-full text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors flex items-center justify-center"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
