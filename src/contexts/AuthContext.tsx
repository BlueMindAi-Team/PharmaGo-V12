import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, deleteField } from 'firebase/firestore';
import { useFirebase } from './FirebaseContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { UserData } from '../types';
import emailjs from '@emailjs/browser';
import { User as FirebaseAuthUser } from 'firebase/auth';
import { generateMTP } from '../utils/mtpGenerator'; // Import generateMTP

// EmailJS configuration
const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  loading: boolean;
  signInWithGoogle: (fullName: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  updateUserProfile: (updates: Partial<UserData>) => Promise<void>;
  updateUserRole: (role: string) => Promise<void>;
  uploadProfilePicture: (file: File, user: User) => Promise<void>;
  verifyPharmacy: (pharmacyId: string, mtp: string) => Promise<boolean>;
  generatePharmacyCredentials: () => Promise<{pharmacyId: string, mtp: string} | null>;
  generateDeliveryCredentials: () => Promise<{deliverymanId: string, mtp: string} | null>;
  verifyDelivery: (deliverymanId: string, mtp: string) => Promise<boolean>;
  checkDuplicatePharmacy: (name: string, address: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper functions
function generatePharmacyId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = 'PGP-';
  for (let i = 0; i < 11; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

// Helper function to generate a unique Delivery Company ID
function generatedeliverymanId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = 'PGD-'; // Changed prefix to PGD-
  for (let i = 0; i < 11; i++) { // 11 characters
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function extractUsername(email: string) {
  return email.split('@')[0];
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null); // Firebase Auth user
  const [userData, setUserData] = useState<UserData | null>(null); // Firestore user data
  const [loading, setLoading] = useState(true);
  const { db, auth } = useFirebase(); // Get db and auth from FirebaseContext
  const navigate = useNavigate();
  const location = useLocation();
  const pendingFullName = useRef<string | null>(null); // Ref to store fullName

  // Listen for Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch user data from Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const fetchedUserData = { uid: currentUser.uid, ...userDocSnap.data() } as UserData;
          setUserData(fetchedUserData);
          // Ensure photoDataUrl is updated from Google photoURL if available and different
          if (currentUser.photoURL && fetchedUserData.photoDataUrl !== currentUser.photoURL) {
            await updateDoc(userDocRef, { photoDataUrl: currentUser.photoURL });
            setUserData(prevData => ({ ...prevData!, photoDataUrl: currentUser.photoURL! }));
          }
        } else {
          // If user exists in Auth but not Firestore, create a basic entry
          const initialUserData: UserData = {
            uid: currentUser.uid,
            email: currentUser.email || '',
            username: currentUser.email?.split('@')[0] || '',
            fullName: currentUser.displayName || pendingFullName.current || '',
            photoDataUrl: currentUser.photoURL || undefined,
          };
          await setDoc(userDocRef, initialUserData);
          setUserData(initialUserData);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth, db]); // Added auth and db to dependency array

  // Effect to handle redirection based on user and userData state
  useEffect(() => {
    if (loading) {
      return;
    }

    if (user && userData) {
      const currentPath = location.pathname;

      // If user is already on their correct dashboard, do nothing.
      if (userData.role === 'Pharmacy' && currentPath.startsWith('/dashboard/pharmacy')) {
        return;
      }
      if (userData.role === 'Delivery' && currentPath.startsWith('/dashboard/delivery')) {
        return;
      }

      // Onboarding Step 1: Phone Number
      if (!userData.phoneNumber && currentPath !== '/number') {
        toast.info('Please complete your profile by adding a phone number.');
        navigate('/number');
        return;
      }

      // Onboarding Step 2: Role Selection
      if (userData.phoneNumber && !userData.role && currentPath !== '/role') {
        toast.info('Please select a role to continue.');
        navigate('/role');
        return;
      }

      // Role-specific onboarding/verification
      if (userData.role === 'Pharmacy') {
        // CHANGE 1: SIMPLIFIED AND CORRECTED PHARMACY ONBOARDING LOGIC
        if (!userData.isPharmacyVerified) {
          // If not verified, they MUST go to the verification page.
          // We only prevent redirection if they are already there.
          if (currentPath !== '/verify-pharmacy') {
            toast.info('Please verify your pharmacy account to continue.');
            navigate('/verify-pharmacy');
            return;
          }
        } else if (!userData.isPharmacyInfoComplete) {
          // If verified but info is incomplete, they MUST go to the info page.
          if (currentPath !== '/info-pharmacy') {
            toast.info('Please complete your pharmacy profile.');
            navigate('/info-pharmacy');
            return;
          }
        }
      } else if (userData.role === 'Delivery') {
        if (!userData.isDeliveryInfoComplete && currentPath !== '/info-delivery') {
          toast.info('Please complete your delivery profile to continue.');
          navigate('/info-delivery');
          return;
        }
      }

      // Final check: If a user's profile is fully complete, redirect them from
      // onboarding pages to their correct dashboard or account page.
      const isProfileFullyComplete = userData.phoneNumber && userData.role &&
        ((userData.role === 'Pharmacy' && userData.isPharmacyVerified && userData.isPharmacyInfoComplete) ||
         (userData.role === 'Delivery' && userData.isDeliveryInfoComplete) ||
         (userData.role === 'Client'));

      const isOnboardingPage = [
        '/login', '/number', '/role', '/info-pharmacy', '/verify-pharmacy', '/info-delivery'
      ].includes(currentPath);

      if (isProfileFullyComplete && isOnboardingPage) {
        // CHANGE 2: REDIRECT TO THE CORRECT DASHBOARD BASED ON ROLE
        if (userData.role === 'Pharmacy') {
          navigate('/dashboard/pharmacy');
        } else if (userData.role === 'Delivery') {
          navigate('/dashboard/delivery');
        } else {
          navigate('/account'); // Default for 'Client' or other roles
        }
        return;
      }

    } else if (!user && // If user is not logged in...
               // ...and is not on a public page...
               !['/login', '/', '/terms-of-service', '/privacy-policy'].includes(location.pathname)) {
      // ...redirect them to the login page.
      navigate('/login');
    }
  }, [user, userData, loading, navigate, location.pathname]);

  const uploadProfilePicture = async (file: File, currentUser: FirebaseAuthUser) => {
    if (!currentUser || !currentUser.uid) {
      toast.error('You must be logged in to upload a profile picture.');
      throw new Error('User not authenticated.');
    }

    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        if (dataUrl.length > 1024 * 1024) { // Check if Base64 string exceeds 1MB (Firestore limit)
          toast.error('Image is too large. Please select a smaller image.');
          reject(new Error('Image too large for Firestore document.'));
          return;
        }

        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          await updateDoc(userDocRef, { photoDataUrl: dataUrl });

          // Update local state
          setUserData(prevData => ({ ...prevData!, photoDataUrl: dataUrl }));
          toast.success('Profile picture uploaded successfully!');
          resolve();
        } catch (error: any) {
          console.error('Error saving photoDataUrl to Firestore:', error);
          toast.error(`Failed to save profile picture: ${error.message}`);
          reject(error);
        }
      };
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        toast.error('Failed to read image file.');
        reject(error);
      };
      reader.readAsDataURL(file);
    });
  };

  const signInWithGoogle = async (fullName: string) => {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    provider.setCustomParameters({
      prompt: 'select_account'
    });

    try {
      pendingFullName.current = fullName; // Store fullName before popup
      const result = await signInWithPopup(auth, provider);
      const currentUser = result.user;

      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
          console.log('New user, creating document...');
          const initialUserData: UserData = {
            uid: currentUser.uid,
            email: currentUser.email || '',
            username: currentUser.email?.split('@')[0] || '',
            fullName: currentUser.displayName || pendingFullName.current || '',
            photoDataUrl: currentUser.photoURL || undefined,
          };
          await setDoc(userDocRef, initialUserData);
          setUserData(initialUserData);
          toast.success('Account created successfully!');
          // New users will be handled by the redirection useEffect
        } else {
          console.log('Existing user, loading and updating data...');
          const existingUserData = { uid: currentUser.uid, ...userDocSnap.data() } as UserData;
          
          const updates: Partial<UserData> = {};
          if ((pendingFullName.current && pendingFullName.current !== existingUserData.fullName) ||
              (currentUser.displayName && currentUser.displayName !== existingUserData.fullName)) {
            updates.fullName = currentUser.displayName || pendingFullName.current || existingUserData.fullName;
          }
          if (currentUser.photoURL && currentUser.photoURL !== existingUserData.photoDataUrl) {
            updates.photoDataUrl = currentUser.photoURL;
          }

          if (Object.keys(updates).length > 0) {
            await updateDoc(userDocRef, updates);
            setUserData({ ...existingUserData, ...updates });
          } else {
            setUserData(existingUserData);
          }
          
          toast.success('Logged in successfully!');
          // Redirection for existing users is handled by the main useEffect
        }
      }
    } catch (error: any) {
      console.error('Error during Google sign-in:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        toast.error(`Login failed: ${error.message}`);
      }
      pendingFullName.current = null;
    }
  };

  const signOutUser = async () => {
    try {
      if (user?.uid) {
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        const updateData: { [key: string]: any } = {};

        if (userDocSnap.exists() && userDocSnap.data()?.pharmacyInfo?.mtp) {
          updateData['pharmacyInfo.mtp'] = deleteField();
        }
        if (userDocSnap.exists() && userDocSnap.data()?.deliveryInfo?.mtp) {
          updateData['deliveryInfo.mtp'] = deleteField();
        }

        if (Object.keys(updateData).length > 0) {
          await updateDoc(userDocRef, updateData);
        }
      }
      await signOut(auth);
      setUserData(null);
      setUser(null);
      toast.info('You have been logged out.');
      navigate('/login');
    } catch (error: any) {
      console.error('Error signing out:', error);
      toast.error(`Sign out failed: ${error.message}`);
    }
  };

  const updateUserProfile = async (updates: Partial<UserData>) => {
    if (!user || !user.uid) {
      toast.error('You must be logged in to update your profile.');
      return;
    }
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, updates);
      setUserData(prevData => ({ ...prevData!, ...updates }));
      toast.success('Profile updated successfully!');
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(`Failed to update profile: ${error.message}`);
    }
  };

  const updateUserRole = async (role: string) => {
    if (!user || !user.uid) {
      toast.error('You must be logged in to select a role.');
      return;
    }
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const updatedData = { role };
      await updateDoc(userDocRef, updatedData);
      setUserData(prevData => ({ ...prevData!, ...updatedData }));
      toast.success(`Role set to ${role}!`);
      // Redirection is handled by the main useEffect
    } catch (error: any) {
      console.error('Error updating role:', error);
      toast.error(`Failed to update role: ${error.message}`);
    }
  };

  const checkDuplicatePharmacy = async (name: string, address: string) => {
    try {
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef, 
        where('role', '==', 'Pharmacy'),
        where('pharmacyInfo.name', '==', name),
        where('pharmacyInfo.address', '==', address)
      );
      
      const querySnapshot = await getDocs(q);
      return !querySnapshot.empty;
    } catch (error: any) {
      console.error('Error checking for duplicate pharmacy:', error);
      toast.error(`Failed to check for duplicate pharmacy: ${error.message}`);
      return true; // Default to true (prevent submission) on error
    }
  };

  const generatePharmacyCredentials = async () => {
    if (!user || !user.email) {
      toast.error('User not authenticated or missing email.');
      return null;
    }
    try {
      const pharmacyId = generatePharmacyId();
      const mtp = generateMTP();
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        'pharmacyInfo.pharmacyId': pharmacyId,
        'pharmacyInfo.mtp': mtp,
        isPharmacyVerified: false
      });

      if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
        toast.error('Email service not configured.');
        console.error('EmailJS environment variables are missing.');
        return null;
      }

      const templateParams = {
        email: user.email,
        to_name: userData?.fullName || extractUsername(user.email),
        mtp_code: mtp,
        user_role: userData?.role || 'Pharmacy',
        pharmacy_id: pharmacyId,
        from_email: 'PharmaGo Team',
      };
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams, EMAILJS_PUBLIC_KEY);
      toast.success(`MTP sent to ${user.email}. Please check your inbox.`);
      return { pharmacyId, mtp };
    } catch (error: any) {
      console.error('Error generating pharmacy credentials:', error);
      toast.error(`Failed to generate credentials: ${error.message}`);
      return null;
    }
  };

  const verifyPharmacy = async (pharmacyId: string, mtp: string) => {
    if (!user || !user.uid) {
      toast.error('User not authenticated.');
      return false;
    }
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (!userDocSnap.exists()) {
        toast.error('User data not found.');
        return false;
      }
      const currentUserData = userDocSnap.data() as UserData;
      if (currentUserData.pharmacyInfo?.pharmacyId !== pharmacyId || currentUserData.pharmacyInfo?.mtp !== mtp) {
        toast.error('Invalid Pharmacy ID or MTP. Please try again.');
        return false;
      }
      await updateDoc(userDocRef, {
        isPharmacyVerified: true,
        'pharmacyInfo.mtp': deleteField() // Use deleteField for security
      });
      setUserData(prevData => prevData ? { 
        ...prevData, 
        isPharmacyVerified: true,
        pharmacyInfo: prevData.pharmacyInfo ? { ...prevData.pharmacyInfo, mtp: undefined } : undefined
      } : null);
      toast.success('Pharmacy verified successfully!');
      return true;
    } catch (error: any) {
      console.error('Error verifying pharmacy:', error);
      toast.error(`Verification failed: ${error.message}`);
      return false;
    }
  };

  const generateDeliveryCredentials = async () => {
    if (!user || !user.email) {
      toast.error('User not authenticated or missing email.');
      return null;
    }
    try {
      const deliverymanId = generatedeliverymanId();
      const mtp = generateMTP();
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        'deliveryInfo.companyId': deliverymanId,
        'deliveryInfo.mtp': mtp,
        isDeliveryInfoComplete: false
      });

      if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
        toast.error('Email service not configured.');
        console.error('EmailJS environment variables are missing.');
        return null;
      }

      const templateParams = {
        email: user.email,
        to_name: userData?.fullName || extractUsername(user.email),
        mtp_code: mtp,
        user_role: userData?.role || 'Delivery',
        delivery_company_id: deliverymanId,
        from_email: 'The MedGo Team',
      };
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams, EMAILJS_PUBLIC_KEY);
      toast.success(`MTP sent to ${user.email}. Please check your inbox.`);
      return { deliverymanId, mtp };
    } catch (error: any) {
      console.error('Error generating delivery credentials:', error);
      toast.error(`Failed to generate credentials: ${error.message}`);
      return null;
    }
  };

  const verifyDelivery = async (deliverymanId: string, mtp: string) => {
    if (!user || !user.uid) {
      toast.error('User not authenticated.');
      return false;
    }
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (!userDocSnap.exists()) {
        toast.error('User data not found.');
        return false;
      }
      const currentUserData = userDocSnap.data() as UserData;
      if (currentUserData.deliveryInfo?.companyId !== deliverymanId || currentUserData.deliveryInfo?.mtp !== mtp) {
        toast.error('Invalid Delivery Company ID or MTP. Please try again.');
        return false;
      }
      await updateDoc(userDocRef, {
        isDeliveryInfoComplete: true,
        'deliveryInfo.mtp': deleteField()
      });
      setUserData(prevData => prevData ? { 
        ...prevData, 
        isDeliveryInfoComplete: true,
        deliveryInfo: prevData.deliveryInfo ? { ...prevData.deliveryInfo, mtp: undefined } : undefined
      } : null);
      toast.success('Delivery verified successfully!');
      return true;
    } catch (error: any) {
      console.error('Error verifying delivery:', error);
      toast.error(`Verification failed: ${error.message}`);
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      userData,
      loading,
      signInWithGoogle,
      signOutUser,
      updateUserProfile,
      updateUserRole,
      uploadProfilePicture,
      verifyPharmacy,
      generatePharmacyCredentials,
      checkDuplicatePharmacy,
      generateDeliveryCredentials,
      verifyDelivery
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};