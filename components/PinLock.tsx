import React, { useState, useEffect, useCallback, useRef } from 'react';

interface PinLockProps {
  onUnlock: () => void;
}

const PIN_LENGTH = 6;
const DEFAULT_PIN = '110096';

const PinLock: React.FC<PinLockProps> = ({ onUnlock }) => {
  const [pin, setPin] = useState<string>('');
  const [storedPin, setStoredPin] = useState<string>(() => {
    const saved = localStorage.getItem('app_pin');
    if (!saved) {
      localStorage.setItem('app_pin', DEFAULT_PIN);
      return DEFAULT_PIN;
    }
    return saved;
  });
  
  const [isSetup, setIsSetup] = useState<boolean>(false);
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [tempPin, setTempPin] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyPress = useCallback((num: string) => {
    setPin(prev => {
      if (prev.length >= PIN_LENGTH) return prev;
      setError(null);
      const newPin = prev + num;
      
      // We check the logic in a timeout or useEffect to handle the transitions
      // after the state update to avoid stale closure issues in the validator.
      return newPin;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
  }, []);

  // Validation logic triggered when PIN reaches target length
  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      if (isSetup) {
        if (setupStep === 1) {
          setTempPin(pin);
          setPin('');
          setSetupStep(2);
        } else {
          if (pin === tempPin) {
            localStorage.setItem('app_pin', pin);
            setStoredPin(pin);
            setIsSetup(false);
            onUnlock();
          } else {
            setError("PINs don't match. Try again.");
            setPin('');
            setSetupStep(1);
          }
        }
      } else {
        if (pin === storedPin) {
          onUnlock();
        } else {
          setError("Incorrect PIN. Please try again.");
          setPin('');
        }
      }
    }
  }, [pin, isSetup, setupStep, tempPin, storedPin, onUnlock]);

  // Keyboard support (Physical keyboard & Numpad)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleKeyPress, handleBackspace]);

  // Focus hidden input to trigger mobile numeric keyboard when tapping the container
  const triggerMobileKeyboard = () => {
    inputRef.current?.focus();
  };

  const handleHiddenInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const lastChar = value.slice(-1);
    if (/^[0-9]$/.test(lastChar)) {
      handleKeyPress(lastChar);
    }
    // Clear it so it's always ready for next char
    e.target.value = '';
  };

  const buttons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];

  return (
    <div 
      className="fixed inset-0 z-[100] bg-slate-900 flex items-center justify-center p-4"
      onClick={triggerMobileKeyboard}
    >
      {/* Hidden input to catch mobile keyboard events */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="absolute opacity-0 pointer-events-none"
        onChange={handleHiddenInputChange}
        onKeyDown={(e) => {
          if (e.key === 'Backspace') handleBackspace();
        }}
      />

      <div 
        className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden p-8 flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 text-indigo-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-slate-800 mb-2">
          {isSetup ? (setupStep === 1 ? 'Set App PIN' : 'Confirm PIN') : 'Enter PIN'}
        </h2>
        
        <p className="text-slate-500 text-sm mb-8 text-center h-5">
          {error ? <span className="text-red-500 font-medium">{error}</span> : `Please enter your ${PIN_LENGTH}-digit PIN`}
        </p>

        <div className="flex gap-3 mb-12">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div 
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 border-2 ${
                pin.length > i 
                  ? 'bg-indigo-600 border-indigo-600 scale-110' 
                  : 'bg-transparent border-slate-200'
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-6 w-full px-4">
          {buttons.map((btn, i) => (
            btn === '' ? (
              <div key={i} />
            ) : btn === 'delete' ? (
              <button
                key={i}
                onClick={handleBackspace}
                className="w-full aspect-square flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z" />
                </svg>
              </button>
            ) : (
              <button
                key={i}
                onClick={() => handleKeyPress(btn)}
                className="w-full aspect-square rounded-full border border-slate-100 bg-slate-50 text-2xl font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100 transition-all active:scale-95 shadow-sm"
              >
                {btn}
              </button>
            )
          ))}
        </div>
      </div>
    </div>
  );
};

export default PinLock;