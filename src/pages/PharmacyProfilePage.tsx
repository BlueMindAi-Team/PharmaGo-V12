import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, serverTimestamp, deleteDoc, orderBy, onSnapshot, runTransaction, setDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { UserData, Product, Feedback, ProfileView, Reply, PharmacyReview, PharmacyReply } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import {
    FaMapMarkerAlt, FaPhone, FaGlobe, FaBox, FaBuilding, FaSpinner, FaArrowLeft,
    FaClock, FaDollarSign, FaImage, FaInfoCircle, FaCheckCircle, FaChartLine,
    FaEye, FaUpload, FaAt, FaSync, FaShieldAlt
} from 'react-icons/fa';
import { v4 as uuidv4 } from 'uuid';
import ImageModal from '../components/ImageModal';

export const PharmacyProfilePage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user, userData }: { user: any; userData: UserData | null } = useAuth();
    const [pharmacyData, setPharmacyData] = useState<UserData | null>(null);
    const [productCount, setProductCount] = useState<number>(0);
    const [profileViews, setProfileViews] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [profileStatusMessage, setProfileStatusMessage] = useState<string | null>(null);

    const [isUploadingLogo, setIsUploadingLogo] = useState(false);
    const [isUploadingCover, setIsUploadingCover] = useState(false);
    const logoFileInputRef = useRef<HTMLInputElement>(null);
    const coverFileInputRef = useRef<HTMLInputElement>(null);
    const [isImageModalOpen, setIsImageModalOpen] = useState(false);

    // Generate order ID in the correct format
    const generateOrderId = () => {
        const randomDigits = Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
        return `PGORD-${randomDigits}`;
    };

    useEffect(() => {
        let unsubscribeProfileViews: Unsubscribe | null = null;

        const fetchInitialData = async () => {
            if (!id) {
                setProfileStatusMessage("Pharmacy ID is missing.");
                setLoading(false);
                return;
            }

            try {
                const userDocRef = doc(db, 'users', id);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                    const data = userDocSnap.data() as UserData;
                    setPharmacyData(data);

                    if (data.role === 'pharmacy' && data.pharmacyInfo) {
                        setProfileStatusMessage(null);

                        // Fetch product count
                        const productsRef = collection(db, 'products');
                        const q = query(productsRef, where('pharmacyName', '==', data.pharmacyInfo.name));
                        const querySnapshot = await getDocs(q);
                        setProductCount(querySnapshot.size);

                        // Log profile view with transaction for atomic increment
                        let currentSessionId = localStorage.getItem('medgo_session_id');
                        if (!currentSessionId) {
                            currentSessionId = uuidv4();
                            localStorage.setItem('medgo_session_id', currentSessionId);
                        }

                        const profileViewsRef = collection(db, 'profileViews');
                        if (user?.uid || currentSessionId) {
                            const viewDocId = user?.uid ? `${id}_${user.uid}` : `${id}_${currentSessionId}`;
                            const profileViewDocRef = doc(profileViewsRef, viewDocId);
                            const existingViewSnap = await getDoc(profileViewDocRef);

                            if (!existingViewSnap.exists()) {
                                await setDoc(profileViewDocRef, {
                                    pharmacyId: id,
                                    timestamp: serverTimestamp(),
                                    userId: user?.uid || null,
                                    sessionId: user?.uid ? null : currentSessionId,
                                });

                                await runTransaction(db, async (transaction) => {
                                    const userDoc = await transaction.get(userDocRef);
                                    if (!userDoc.exists()) return;
                                    const prevViews = userDoc.data().pharmacyInfo?.profileViews || 0;
                                    transaction.update(userDocRef, {
                                        'pharmacyInfo.profileViews': prevViews + 1
                                    });
                                });
                            }
                        }

                        // Setup real-time listeners
                        unsubscribeProfileViews = onSnapshot(userDocRef, (docSnap) => {
                            const data = docSnap.data();
                            const updatedViews = data?.pharmacyInfo?.profileViews || 0;
                            setProfileViews(updatedViews);
                        });

                    } else {
                        setProfileStatusMessage("This profile does not belong to a registered pharmacy or has incomplete information.");
                    }
                } else {
                    setProfileStatusMessage("Pharmacy not found.");
                }
            } catch (err) {
                console.error("Error fetching pharmacy data:", err);
                setProfileStatusMessage("Failed to load pharmacy profile due to a network error.");
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();

        return () => {
            if (unsubscribeProfileViews) unsubscribeProfileViews();
        };
    }, [id, user, userData]);

    const handleLogoImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!id || user?.uid !== id || userData?.role !== 'pharmacy') {
            toast.error("You do not have permission to update this logo.");
            return;
        }

        if (event.target.files && event.target.files.length > 0) {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Image = reader.result as string;
                setIsUploadingLogo(true);
                try {
                    const userDocRef = doc(db, 'users', id);
                    await updateDoc(userDocRef, { 'pharmacyInfo.logoImage': base64Image });
                    setPharmacyData(prev => prev ? { ...prev, pharmacyInfo: { ...prev.pharmacyInfo!, logoImage: base64Image } } : null);
                    toast.success("Logo updated successfully!");
                } catch (err) {
                    console.error("Error uploading logo:", err);
                    toast.error("Failed to upload logo.");
                } finally {
                    setIsUploadingLogo(false);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCoverImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!id || user?.uid !== id || userData?.role !== 'pharmacy') {
            toast.error("You do not have permission to update this cover photo.");
            return;
        }

        if (event.target.files && event.target.files.length > 0) {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Image = reader.result as string;
                setIsUploadingCover(true);
                try {
                    const userDocRef = doc(db, 'users', id);
                    await updateDoc(userDocRef, { 'pharmacyInfo.coverPhoto': base64Image });
                    setPharmacyData(prev => prev ? { ...prev, pharmacyInfo: { ...prev.pharmacyInfo!, coverPhoto: base64Image } } : null);
                    toast.success("Cover photo updated successfully!");
                } catch (err) {
                    console.error("Error uploading cover photo:", err);
                    toast.error("Failed to upload cover photo.");
                } finally {
                    setIsUploadingCover(false);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <FaSpinner className="animate-spin text-4xl text-blue-500" />
            </div>
        );
    }

    const pharmacyInfo = pharmacyData?.pharmacyInfo;
    const phoneNumber = pharmacyData?.phoneNumber;
    const role = pharmacyData?.role;
    const aboutMe = pharmacyData?.aboutMe;
    const isOwner = user?.uid === id && userData?.role === 'pharmacy';

    return (
        <div className="bg-gray-100 min-h-screen">
            {profileStatusMessage && !pharmacyInfo && (
                <div className="container mx-auto p-4">
                    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4" role="alert">
                        <p className="font-bold">Profile Error</p>
                        <p>{profileStatusMessage}</p>
                    </div>
                </div>
            )}

            {/* Cover Photo and Profile Picture Section */}
            <div className="bg-white shadow-sm">
                <div className="container mx-auto px-4">
                    <div className="relative h-64 md:h-96 rounded-b-lg overflow-hidden bg-gray-200 group">
                        <img
                            src={pharmacyInfo?.coverPhoto || 'https://i.ibb.co/1GsrsySF/cover.png'}
                            alt="Cover"
                            className="w-full h-full object-cover"
                        />
                        {isOwner && (
                            <div
                                className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 cursor-pointer"
                                onClick={() => coverFileInputRef.current?.click()}
                            >
                                {isUploadingCover ? (
                                    <FaSpinner className="animate-spin text-3xl text-white" />
                                ) : (
                                    <div className="text-center text-white">
                                        <FaUpload className="mb-2 text-3xl mx-auto" />
                                        <p>Change Cover Photo</p>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    ref={coverFileInputRef}
                                    onChange={handleCoverImageChange}
                                    accept="image/*"
                                    className="hidden"
                                />
                            </div>
                        )}
                    </div>
                    <div className="relative flex flex-col md:flex-row items-center md:items-end -mt-24 md:-mt-16 px-4 pb-4">
                        <div className="relative w-40 h-40 rounded-full border-4 border-white shadow-lg group bg-gray-300">
                            <img
                                src={pharmacyInfo?.logoImage || 'https://via.placeholder.com/180'}
                                alt={`${pharmacyInfo?.name || 'Pharmacy'} Logo`}
                                className="w-full h-full object-cover rounded-full"
                            />
                            {isOwner && (
                                <div
                                    className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 cursor-pointer"
                                    onClick={() => logoFileInputRef.current?.click()}
                                >
                                    {isUploadingLogo ? <FaSpinner className="animate-spin text-2xl text-white" /> : <FaUpload className="text-2xl text-white" />}
                                    <input type="file" ref={logoFileInputRef} onChange={handleLogoImageChange} accept="image/*" className="hidden" />
                                </div>
                            )}
                        </div>
                        <div className="md:ml-6 mt-4 md:mt-0 text-center md:text-left">
                            <div className="flex items-center justify-center md:justify-start space-x-2">
                                <h1 className="text-3xl md:text-4xl font-bold text-gray-800">{pharmacyInfo?.name || 'Pharmacy Profile'}</h1>
                                {pharmacyInfo?.verified && (
                                    <div className="flex items-center bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-medium">
                                        <FaShieldAlt className="w-4 h-4 mr-1" />
                                        Verified
                                    </div>
                                )}
                            </div>
                            <p className="text-gray-600">{pharmacyInfo ? `Your Trusted Partner in Health` : 'Profile information not available'}</p>
                        </div>
                        {pharmacyInfo && (
                            <div className="flex-grow flex justify-center md:justify-end mt-4 md:mt-0 space-x-2">
                                <button onClick={() => navigate(`/products?pharmacy=${encodeURIComponent(pharmacyInfo.name)}`)} className="flex items-center px-4 py-2 text-white transition bg-blue-600 rounded-md hover:bg-blue-700">
                                    <FaBox className="mr-2" /> Products
                                </button>
                                {pharmacyInfo.vodafoneCash && (
                                    <a href={`https://wa.me/${pharmacyInfo.vodafoneCash}?text=Hello%20${encodeURIComponent(pharmacyInfo.name)}%2C%20I%20would%20like%20to%20message%20you%20about...`} target="_blank" rel="noopener noreferrer" className="flex items-center px-4 py-2 text-white transition bg-green-500 rounded-md hover:bg-green-600">
                                        <FaPhone className="mr-2" /> WhatsApp
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {pharmacyInfo ? (
                <div className="container mx-auto p-4 grid grid-cols-1 md:grid-cols-12 gap-8">
                    {/* Left Sidebar */}
                    <div className="md:col-span-5 space-y-6">
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h2 className="text-xl font-bold text-gray-800 mb-4">Intro</h2>
                            <p className="text-gray-700 text-left mb-4">{aboutMe || `Welcome to ${pharmacyInfo.name}! We are dedicated to providing high-quality pharmaceutical products and excellent service.`}</p>
                            <ul className="space-y-3 text-gray-700">
                                <li className="flex items-center"><FaBuilding className="mr-3 text-gray-500" />{role}</li>
                                {pharmacyData?.username && (<li className="flex items-center"><FaAt className="mr-3 text-gray-500" />{pharmacyData.username}</li>)}
                                {pharmacyInfo.pharmacyId && (<li className="flex items-center"><FaInfoCircle className="mr-3 text-gray-500" />ID: {pharmacyInfo.pharmacyId}</li>)}
                                <li className="flex items-center"><FaMapMarkerAlt className="mr-3 text-gray-500" />{pharmacyInfo.address || 'Address not provided'}</li>
                                <li className="flex items-center"><FaPhone className="mr-3 text-gray-500" />{phoneNumber || 'N/A'}</li>
                                {pharmacyInfo.mapLink && (<li className="flex items-center"><FaGlobe className="mr-3 text-gray-500" /><a href={pharmacyInfo.mapLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View on Map</a></li>)}
                            </ul>
                        </div>
                        
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-gray-800">Photos</h2>
                                <button onClick={() => setIsImageModalOpen(true)} className="text-blue-600 hover:underline">See all photos</button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {pharmacyInfo.pharmacyImages && pharmacyInfo.pharmacyImages.slice(0, 4).map((img, index) => (img ? (<div key={index} className="relative w-full h-32 md:h-52 bg-gray-200 rounded-lg overflow-hidden shadow-sm group"><img src={img} alt={`Pharmacy ${index + 1}`} className="w-full h-full object-cover"/></div>) : null))}
                            </div>
                            {(!pharmacyInfo.pharmacyImages || pharmacyInfo.pharmacyImages.length === 0) && (<p className="py-4 text-center text-gray-500">No images available.</p>)}
                        </div>
                    </div>

                    {/* Main Content (Reviews) */}
                    <div className="md:col-span-7 space-y-6">
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h2 className="mb-4 text-xl font-bold text-gray-800 flex items-center"><FaChartLine className="mr-3 text-blue-600" /> Quick Stats</h2>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-gray-700">
                                <div className="flex items-center p-3 bg-gray-50 rounded-md"><FaBox className="mr-3 text-blue-500 text-xl" /><div><span className="font-semibold">Products:</span> {productCount}</div></div>
                                <div className="flex items-center p-3 bg-gray-50 rounded-md">
                                    <FaEye className="mr-3 text-purple-500 text-xl" />
                                    <div>
                                        <span className="font-semibold">Profile Views:</span> {profileViews}
                                    </div>
                                </div>
                                <div className="flex items-center p-3 bg-gray-50 rounded-md"><FaClock className="mr-3 text-green-500 text-xl" /><div><span className="font-semibold">Est. Delivery:</span> 45 mins</div></div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="container p-4 mx-auto text-center text-gray-600">
                    {!profileStatusMessage && <p className="text-lg">This profile does not have detailed pharmacy information.</p>}
                </div>
            )}

            <ImageModal
                images={
                    [
                        pharmacyInfo?.logoImage,
                        pharmacyInfo?.coverPhoto,
                        ...(pharmacyInfo?.pharmacyImages || []),
                    ].filter((img): img is string => !!img)
                }
                isOpen={isImageModalOpen}
                onClose={() => setIsImageModalOpen(false)}
            />
        </div>
    );
};
