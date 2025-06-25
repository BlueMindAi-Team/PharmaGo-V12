import React, { useState } from 'react';
import { X, Shield, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { toast } from 'react-toastify';

interface PharmacyVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerificationSuccess: () => void;
}

const PharmacyVerificationModal: React.FC<PharmacyVerificationModalProps> = ({
  isOpen,
  onClose,
  onVerificationSuccess
}) => {
  const { user, userData, updateUserProfile } = useAuth();
  const [verificationCode, setVerificationCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');

  // The verification code (encoded for security)
  const VERIFICATION_CODE = 'PGPV-XN^#r$E84bFW+gqCVm7PtKjo*YAxMUzLd159!&nT@362';

  const handleVerify = async () => {
    if (!user || !userData) {
      setError('User not authenticated.');
      return;
    }

    if (verificationCode.trim() !== VERIFICATION_CODE) {
      setError('You need a valid code. Contact Admin or Help Center to obtain it.');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        'pharmacyInfo.verified': true
      });

      // Update local state
      await updateUserProfile({
        pharmacyInfo: {
          ...userData.pharmacyInfo!,
          verified: true
        }
      });

      toast.success('Pharmacy verified successfully!');
      onVerificationSuccess();
      onClose();
    } catch (err) {
      console.error('Error verifying pharmacy:', err);
      setError('Failed to verify pharmacy. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClose = () => {
    setVerificationCode('');
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Shield className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800">Verify Pharmacy</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="mb-6">
          <p className="text-gray-600 mb-4">
            Enter the 50-character verification code to verify your pharmacy account.
          </p>
          
          <div className="mb-4">
            <label htmlFor="verificationCode" className="block text-sm font-medium text-gray-700 mb-2">
              Verification Code
            </label>
            <input
              type="text"
              id="verificationCode"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              placeholder="Enter 50-character code"
              maxLength={50}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
        </div>

        <div className="flex space-x-3">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleVerify}
            disabled={isVerifying || !verificationCode.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isVerifying ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Verify
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PharmacyVerificationModal;