import React, { useState, useRef, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '../Buttons/Button';
import SessionContext from '@/context/SessionContext';
import { useTenant } from '@/context/TenantContext'; // Kept
import PopupLayout from './PopupLayout';
import { last } from '@/util';
import { Lock } from 'lucide-react';

function PinInput({ isOpen, setIsOpen, onSubmit, inputsCount = 4, inputsMode = 'numeric', onCancel }) {
  const { api } = useContext(SessionContext);
  const navigate = useNavigate();
  const { buildPath } = useTenant();
  const [errMessage, setErrMessage] = useState('');
  
  const [pin, setPin] = useState(Array(inputsCount).fill(''));
  const { t } = useTranslation();

  const inputRefs = useRef([]);
  if (inputRefs.current.length !== inputsCount) {
    inputRefs.current = Array(inputsCount).fill(0).map((_, i) => inputRefs.current[i] || React.createRef());
  }

  useEffect(() => {
    if (isOpen && inputRefs.current[0]?.current) {
      inputRefs.current[0].current.focus();
    }
  }, [isOpen]);

  const handleCancel = () => {
    setIsOpen(false);
    if (onCancel) onCancel();
    navigate(buildPath());
  };

  const handleSubmit = async () => {
    try {
      const userPin = pin.join('');
      await api.post('/communication/handle', { user_pin: userPin });      
      if (onSubmit) onSubmit(userPin);
      
      setIsOpen(false);
    } catch (err) {
      setErrMessage(`${t('PinInputPopup.errMessage')}`);
    }
  };

  const handleInputChange = (index, value) => {
    setErrMessage('');
    const isValid = inputsMode === 'numeric' ? /^\d*$/.test(value) : true;
    
    if (isValid && value.length <= 1) {
      const newPin = [...pin];
      newPin[index] = value;
      setPin(newPin);

      if (value === '' && index > 0) {
				// Move focus to the previous input field and clear it if the value is cleared
        inputRefs.current[index - 1].current.focus();
        newPin[index - 1] = '';
      } else if (value !== '' && index < inputsCount - 1) {
				// Move focus to the next input and clean it
				const nextInput = inputRefs.current[index + 1].current;
        newPin[index + 1] = '';
        setPin(newPin);
        nextInput.focus();
        nextInput.select();
      }
    }
  };

  const handleInputKeyDown = (index, event) => {
    setErrMessage('');
    if (event.key === 'Backspace' && pin[index] === '' && index > 0) {
      inputRefs.current[index - 1].current.focus();
      const newPin = [...pin];
      newPin[index - 1] = '';
      setPin(newPin);
    }
  };

  if (!isOpen) return null;

  const handleInputKeyPress = (event) => {
    if (event.key === 'Enter') handleSubmit();
  };

  return (
    <PopupLayout isOpen={isOpen} onClose={handleCancel}>
      <h2 className="text-lg font-bold mb-2 text-lm-gray-900 dark:text-dm-gray-100">
        <Lock size={20} className="inline mr-1 mb-1" />
        {t('PinInputPopup.title')}
      </h2>
      <hr className="mb-2 border-t border-lm-gray-400 dark:border-dm-gray-600" />
      <p className="italic pd-2 text-lm-gray-800 dark:text-dm-gray-200">
        {t('PinInputPopup.description')}
      </p>

      {errMessage && <p className='text-sm text-lm-red dark:text-dm-red'>{errMessage}</p>}
      
      <div className='mt-2 flex flex-wrap justify-center overflow-y-auto max-h-[50vh]'>
        {pin.map((digit, index) => (
          <input
            type={inputsMode === 'numeric' ? 'tel' : 'text'}
            key={index}
            value={digit}
            onChange={(e) => handleInputChange(index, e.target.value)}
            onKeyDown={(e) => handleInputKeyDown(index, e)}
            onKeyPress={(e) => handleInputKeyPress(e)}
            className="w-10 px-3 mx-1 my-2 py-2 bg-lm-gray-200 dark:bg-dm-gray-800 border border-lm-gray-400 dark:border-dm-gray-600 rounded-md focus:outline-none"
            ref={inputRefs.current[index]}
          />
        ))}
      </div>

      <div className="flex justify-end space-x-2 pt-4">
        <Button id="cancel-pin-input" onClick={handleCancel}>
          {t('common.cancel')}
        </Button>
        <Button id="submit-pin-input" variant="primary" onClick={handleSubmit}>
          {t('common.submit')}
        </Button>
      </div>
    </PopupLayout>
  );
}

export default PinInput;
