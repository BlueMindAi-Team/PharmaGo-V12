import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, serverTimestamp, deleteDoc, orderBy, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { UserData, Product, Feedback, ProfileView, Reply, PharmacyReview, PharmacyReply } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import {
    FaMapMarkerAlt, FaPhone, FaGlobe, FaBox, FaBuilding, FaSpinner, FaArrowLeft,
    FaStar, FaClock, FaDollarSign, FaImage, FaInfoCircle, FaCheckCircle, FaChartLine,
    FaEye, FaPaperPlane, FaSmile, FaThumbsUp, FaHeart, FaLaugh, FaAngry, FaSadTear, FaCamera, FaTrash, FaRegTrashAlt, FaUpload, FaAt, FaSync, FaShieldAlt
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
    const [reviews, setReviews] = useState<PharmacyReview[]>([]);
    const [replies, setReplies] = useState<{ [reviewId: string]: PharmacyReply[] }>({});
    const [loading, setLoading] = useState(true);
    const [profileStatusMessage, setProfileStatusMessage] = useState<string | null>(null);

    const [reviewText, setReviewText] = useState('');
    const [reviewRating, setReviewRating] = useState(0);
    const [reviewImages, setReviewImages] = useState<string[]>([]);
    const reviewFileInputRef = useRef<HTMLInputElement>(null);
    const [isSubmittingReview, setIsSubmittingReview] = useState(false);

    const [replyText, setReplyText] = useState<{ [reviewId: string]: string }>({});
    const [isSubmittingReply, setIsSubmittingReply] = useState<{ [reviewId: string]: boolean }>({});

    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<{ type: 'review' | 'reply' | null; reviewId: string | null; replyId?: string | null }>({ type: null, reviewId: null, replyId: null });
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
        let unsubscribeReviews: (() => void) | null = null;
        let unsubscribeProfileViews: (() => void) | null = null;

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

                        // Setup reviews listener
                        const reviewsRef = collection(db, 'pharmacyReviews');
                        const reviewsQuery = query(reviewsRef, where('pharmacyId', '==', id), orderBy('timestamp', 'desc'));
                        unsubscribeReviews = onSnapshot(reviewsQuery, (reviewSnapshot) => {
                            const fetchedReviews: PharmacyReview[] = reviewSnapshot.docs.map(docSnap => {
                                const reviewData = docSnap.data();
                                return {
                                    id: docSnap.id,
                                    ...reviewData as Omit<PharmacyReview, 'id' | 'timestamp'>,
                                    timestamp: (reviewData.timestamp?.toDate() || new Date()) as Date,
                                };
                            });
                            setReviews(fetchedReviews);

                            // Fetch replies for each review
                            fetchedReviews.forEach(async (review) => {
                                const repliesRef = collection(db, 'pharmacyReplies');
                                const repliesQuery = query(repliesRef, where('reviewId', '==', review.id), orderBy('timestamp', 'asc'));
                                const repliesSnapshot = await getDocs(repliesQuery);
                                const reviewReplies: PharmacyReply[] = repliesSnapshot.docs.map(docSnap => ({
                                    id: docSnap.id,
                                    ...docSnap.data() as Omit<PharmacyReply, 'id'>
                                }));
                                setReplies(prev => ({ ...prev, [review.id]: reviewReplies }));
                            });
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
            if (unsubscribeReviews) unsubscribeReviews();
            if (unsubscribeProfileViews) unsubscribeProfileViews();
        };
    }, [id, user, userData]);

    const handleReviewImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                setReviewImages([reader.result as string]);
            };
            reader.readAsDataURL(file);
        }
    };

    const removeReviewImage = () => {
        setReviewImages([]);
    };

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

    const handleSubmitReview = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id || !reviewText.trim() || reviewRating === 0) {
            toast.error("Please provide text and a rating for your review.");
            return;
        }
        if (!user) {
            toast.error("Please log in to leave a review.");
            return;
        }

        setIsSubmittingReview(true);
        try {
            const newReview: Omit<PharmacyReview, 'id'> = {
                pharmacyId: id,
                userId: user.uid,
                userName: user.displayName || userData?.fullName || "Anonymous",
                userPhotoUrl: user.photoURL || userData?.photoDataUrl || undefined,
                text: reviewText.trim(),
                rating: reviewRating,
                timestamp: serverTimestamp() as any,
                images: reviewImages,
                reactions: {},
            };

            await addDoc(collection(db, 'pharmacyReviews'), newReview);
            toast.success("Review submitted successfully!");

            setReviewText('');
            setReviewRating(0);
            setReviewImages([]);
        } catch (err) {
            console.error("Error submitting review:", err);
            toast.error("Failed to submit review.");
        } finally {
            setIsSubmittingReview(false);
        }
    };

    const handleSubmitReply = async (reviewId: string) => {
        if (!user || !userData || user.uid !== id || userData.role !== 'pharmacy') {
            toast.error("Only the pharmacy owner can reply to reviews.");
            return;
        }

        const text = replyText[reviewId]?.trim();
        if (!text) {
            toast.error("Please enter a reply.");
            return;
        }

        setIsSubmittingReply(prev => ({ ...prev, [reviewId]: true }));
        try {
            const newReply: Omit<PharmacyReply, 'id'> = {
                reviewId,
                pharmacyId: id!,
                userId: user.uid,
                userName: pharmacyData?.pharmacyInfo?.name || "Pharmacy",
                text,
                timestamp: serverTimestamp() as any,
            };

            await addDoc(collection(db, 'pharmacyReplies'), newReply);
            toast.success("Reply submitted successfully!");

            setReplyText(prev => ({ ...prev, [reviewId]: '' }));
        } catch (err) {
            console.error("Error submitting reply:", err);
            toast.error("Failed to submit reply.");
        } finally {
            setIsSubmittingReply(prev => ({ ...prev, [reviewId]: false }));
        }
    };

    const handleReaction = async (targetId: string, emoji: string, type: 'review' | 'reply') => {
        if (!user) {
            toast.error("Please log in to react.");
            return;
        }

        try {
            const collectionName = type === 'review' ? 'pharmacyReviews' : 'pharmacyReplies';
            const docRef = doc(db, collectionName, targetId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const currentReactions = docSnap.data().reactions || {};
                let updatedReactions = { ...currentReactions };

                // Remove user's previous reaction if it exists
                for (const key in updatedReactions) {
                    updatedReactions[key] = updatedReactions[key].filter((uid: string) => uid !== user.uid);
                    if (updatedReactions[key].length === 0) delete updatedReactions[key];
                }

                // Add new reaction, or toggle off if it's the same emoji
                const userHasReacted = currentReactions[emoji]?.includes(user.uid);
                if (!userHasReacted) {
                    updatedReactions[emoji] = [...(updatedReactions[emoji] || []), user.uid];
                }

                await updateDoc(docRef, { reactions: updatedReactions });
            }
        } catch (err) {
            console.error("Error updating reaction:", err);
            toast.error("Failed to add reaction.");
        }
    };

    const openDeleteConfirmation = (type: 'review' | 'reply', reviewId: string, replyId?: string) => {
        setItemToDelete({ type, reviewId, replyId });
        setShowDeleteConfirmation(true);
    };

    const handleConfirmDelete = async () => {
        if (!user) {
            toast.error("You must be logged in to delete content.");
            return;
        }

        const { type, reviewId, replyId } = itemToDelete;

        if (type === 'review' && reviewId) {
            const review = reviews.find(r => r.id === reviewId);
            if (review?.userId !== user.uid) {
                toast.error("You can only delete your own reviews.");
                handleCancelDelete();
                return;
            }
            await deleteDoc(doc(db, 'pharmacyReviews', reviewId));
            toast.success("Review deleted successfully!");
        } else if (type === 'reply' && reviewId && replyId) {
            await deleteDoc(doc(db, 'pharmacyReplies', replyId));
            toast.success("Reply deleted successfully!");
        }
        handleCancelDelete();
    };

    const handleCancelDelete = () => {
        setShowDeleteConfirmation(false);
        setItemToDelete({ type: null, reviewId: null, replyId: null });
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
                                    <FaSpinner className="animate-spin text-white text-3xl" />
                                ) : (
                                    <div className="text-center text-white">
                                        <FaUpload className="text-3xl mb-2 mx-auto" />
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
                                    {isUploadingLogo ? <FaSpinner className="animate-spin text-white text-2xl" /> : <FaUpload className="text-white text-2xl" />}
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
                                <button onClick={() => navigate(`/products?pharmacy=${encodeURIComponent(pharmacyInfo.name)}`)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition flex items-center">
                                    <FaBox className="mr-2" /> Products
                                </button>
                                {pharmacyInfo.vodafoneCash && (
                                    <a href={`https://wa.me/${pharmacyInfo.vodafoneCash}?text=Hello%20${encodeURIComponent(pharmacyInfo.name)}%2C%20I%20would%20like%20to%20message%20you%20about...`} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition flex items-center">
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
                            {(!pharmacyInfo.pharmacyImages || pharmacyInfo.pharmacyImages.length === 0) && (<p className="text-gray-500 text-center py-4">No images available.</p>)}
                        </div>
                    </div>

                    {/* Main Content (Reviews) */}
                    <div className="md:col-span-7 space-y-6">
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center"><FaChartLine className="mr-3 text-blue-600" /> Quick Stats</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-gray-700">
                                <div className="flex items-center p-3 bg-gray-50 rounded-md"><FaStar className="mr-3 text-yellow-500 text-xl" /><div><span className="font-semibold">Avg. Rating:</span> {reviews.length > 0 ? (reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length).toFixed(1) : 'N/A'}<span className="text-sm text-gray-500 ml-1">({reviews.length})</span></div></div>
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

                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-xl font-semibold text-gray-800 mb-3">Leave a Review</h3>
                            <form onSubmit={handleSubmitReview} className="space-y-4">
                                <textarea className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" rows={4} placeholder={`Share your experience at ${pharmacyInfo.name}...`} value={reviewText} onChange={(e) => setReviewText(e.target.value)} required></textarea>
                                <div className="flex items-center"><span className="font-semibold text-gray-700 mr-3">Your Rating:</span>{[1, 2, 3, 4, 5].map((star) => (<FaStar key={star} className={`cursor-pointer text-2xl ${reviewRating >= star ? 'text-yellow-400' : 'text-gray-300'}`} onClick={() => setReviewRating(star)}/>))}</div>
                                <div className="flex items-center"><input type="file" ref={reviewFileInputRef} onChange={handleReviewImageSelect} accept="image/*" className="hidden" /><button type="button" onClick={() => reviewFileInputRef.current?.click()} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition flex items-center"><FaCamera className="mr-2" /> Add Photo</button>{reviewImages.length > 0 && (<div className="relative ml-4 w-24 h-24"><img src={reviewImages[0]} alt="preview" className="w-full h-full object-cover rounded-md" /><button type="button" onClick={removeReviewImage} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">×</button></div>)}</div>
                                <button type="submit" className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition flex items-center justify-center disabled:opacity-50" disabled={isSubmittingReview || !user}>{isSubmittingReview ? <FaSpinner className="animate-spin mr-2" /> : <FaPaperPlane className="mr-2" />}{user ? "Submit Review" : "Login to Review"}</button>
                            </form>
                        </div>

                        <div className="bg-white rounded-lg shadow-md">
                            <div className="flex justify-between items-center p-6 border-b border-gray-200">
                                <h2 className="text-xl font-bold text-gray-800">Reviews</h2>
                            </div>
                            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
                                {reviews.length > 0 ? (
                                    reviews.map((review, index) => (
                                        <div key={review.id} className={`p-6 ${index < 3 ? 'h-auto' : ''}`}>
                                            <div className="flex items-start">
                                                <img src={review.userPhotoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(review.userName)}&background=random&color=fff&size=40`} alt={review.userName} className="w-10 h-10 rounded-full object-cover mr-4"/>
                                                <div className="flex-1">
                                                    <div className="flex items-center justify-between"><p className="font-semibold text-gray-800">{review.userName}</p><div className="flex items-center text-yellow-400">{[1, 2, 3, 4, 5].map((star) => (<FaStar key={star} className={review.rating >= star ? 'text-yellow-400' : 'text-gray-300'}/>))}</div></div>
                                                    <span className="text-sm text-gray-500">{(review.timestamp as Date).toLocaleDateString()}</span>
                                                    <div className="flex justify-between items-start mt-2">
                                                        <p className="text-gray-700 whitespace-pre-wrap flex-1">{review.text}</p>
                                                        {user?.uid === review.userId && (<button onClick={() => openDeleteConfirmation('review', review.id)} className="ml-4 text-gray-500 hover:text-red-600 text-lg p-1 rounded-full"><FaRegTrashAlt /></button>)}
                                                    </div>
                                                    {review.images && review.images.length > 0 && (<div className="mt-3 flex flex-wrap gap-2">{review.images.map((img, imgIndex) => (<img key={imgIndex} src={img} alt={`Review ${imgIndex + 1}`} className="w-32 h-32 md:w-52 md:h-52 object-cover rounded-md border cursor-pointer" onClick={() => setIsImageModalOpen(true)}/>))}</div>)}
                                                    
                                                    <div className="mt-4 flex items-center space-x-4 text-gray-600">
                                                        <button className="flex items-center space-x-1 hover:text-blue-600 transition" onClick={() => handleReaction(review.id, '👍', 'review')}><FaThumbsUp className={review.reactions && review.reactions['👍']?.includes(user?.uid || '') ? 'text-blue-600' : ''}/><span>{review.reactions?.['👍']?.length || 0}</span></button>
                                                    </div>

                                                    {/* Reply Section */}
                                                    {replies[review.id] && replies[review.id].length > 0 && (
                                                        <div className="mt-4 space-y-3 border-l-2 border-gray-200 pl-4">
                                                            {replies[review.id].map((reply) => (
                                                                <div key={reply.id} className="flex items-start">
                                                                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                                                                        <FaBuilding className="w-4 h-4 text-blue-600" />
                                                                    </div>
                                                                    <div className="flex-1 bg-gray-50 p-3 rounded-lg">
                                                                        <div className="flex items-center justify-between">
                                                                            <div className="flex items-center space-x-2">
                                                                                <p className="font-semibold text-gray-800 text-sm">{reply.userName}</p>
                                                                                {pharmacyInfo?.verified && (
                                                                                    <div className="flex items-center bg-blue-100 text-blue-800 px-1 py-0.5 rounded text-xs">
                                                                                        <FaShieldAlt className="w-3 h-3 mr-1" />
                                                                                        Verified
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            {user?.uid === reply.userId && (
                                                                                <button onClick={() => openDeleteConfirmation('reply', review.id, reply.id)} className="text-gray-500 hover:text-red-600 text-sm">
                                                                                    <FaRegTrashAlt />
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-gray-700 text-sm mt-1 whitespace-pre-wrap">{reply.text}</p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Reply Form - Only for pharmacy owner */}
                                                    {isOwner && (
                                                        <div className="mt-4 border-t border-gray-100 pt-4">
                                                            <div className="flex space-x-3">
                                                                <input
                                                                    type="text"
                                                                    value={replyText[review.id] || ''}
                                                                    onChange={(e) => setReplyText(prev => ({ ...prev, [review.id]: e.target.value }))}
                                                                    placeholder="Reply to this review..."
                                                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                />
                                                                <button
                                                                    onClick={() => handleSubmitReply(review.id)}
                                                                    disabled={isSubmittingReply[review.id] || !replyText[review.id]?.trim()}
                                                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    {isSubmittingReply[review.id] ? <FaSpinner className="animate-spin" /> : <FaPaperPlane />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p className="p-6 text-center text-gray-500">No reviews yet. Be the first to leave one!</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="container mx-auto p-4 text-center text-gray-600">
                    {!profileStatusMessage && <p className="text-lg">This profile does not have detailed pharmacy information.</p>}
                </div>
            )}

            <ImageModal
                images={
                    [
                        pharmacyInfo?.logoImage,
                        pharmacyInfo?.coverPhoto,
                        ...(pharmacyInfo?.pharmacyImages || []),
                        ...reviews.flatMap(review => review.images || [])
                    ].filter((img): img is string => !!img)
                }
                isOpen={isImageModalOpen}
                onClose={() => setIsImageModalOpen(false)}
            />

            {showDeleteConfirmation && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
                    <div className="bg-white p-8 rounded-lg shadow-xl max-w-sm w-full text-center">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h3>
                        <p className="text-gray-700 mb-6">Are you sure you want to delete this {itemToDelete.type}? This action cannot be undone.</p>
                        <div className="flex justify-center space-x-4">
                            <button onClick={handleCancelDelete} className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 transition">Cancel</button>
                            <button onClick={handleConfirmDelete} className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition">Continue</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};