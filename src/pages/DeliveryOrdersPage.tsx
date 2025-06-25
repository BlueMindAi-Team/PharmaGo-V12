import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, updateDoc, orderBy as firestoreOrderBy } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Order } from '../types';
import { FaSpinner, FaCheckCircle, FaTruck, FaBox, FaUser, FaMapMarkerAlt, FaPhone, FaCalendarAlt, FaMoneyBillWave, FaTimesCircle } from 'react-icons/fa';
import { toast } from 'react-toastify';

const DeliveryOrdersPage: React.FC = () => {
  const { user, userData, loading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [showMtpModal, setShowMtpModal] = useState(false);
  const [currentOrderIdForMtp, setCurrentOrderIdForMtp] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || userData?.role !== 'Delivery')) {
      navigate('/login');
      return;
    }

    const fetchOrders = async () => {
      if (!user || !userData?.deliveryInfo?.companyId) {
        setPageLoading(false);
        return;
      }

      setPageLoading(true);
      try {
        const ordersRef = collection(db, 'orders');
        const q = query(
          ordersRef,
          firestoreOrderBy('orderTimestamp', 'desc')
        );
        const querySnapshot = await getDocs(q);
        
        const fetchedOrders: Order[] = querySnapshot.docs.map(docSnap => ({ 
          id: docSnap.id, 
          ...docSnap.data() 
        } as Order));
        setOrders(fetchedOrders);
      } catch (error) {
        console.error('Error fetching orders:', error);
        toast.error('Failed to load orders.');
      } finally {
        setPageLoading(false);
      }
    };

    if (!loading && user && userData?.role === 'Delivery') {
      fetchOrders();
    }
  }, [user, userData, loading, navigate]);

  const handleMarkAsShippedClick = (orderId: string) => {
    setCurrentOrderIdForMtp(orderId);
    handleConfirmShipment(orderId);
  };

  const handleConfirmShipment = async (orderId: string) => {
    if (!orderId) {
      toast.error('Order not selected. Please try again.');
      return;
    }
    setCurrentOrderIdForMtp(orderId);
    setShowMtpModal(true);
  };

  if (loading || pageLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <FaSpinner className="animate-spin text-5xl text-blue-600" />
      </div>
    );
  }

  if (!user || userData?.role !== 'Delivery') {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-blue-100 to-purple-100 min-h-[calc(100vh-80px)] p-6 sm:p-10 lg:p-16 font-sans">
      <div className="container mx-auto max-w-screen-2xl">
        <h1 className="text-5xl font-extrabold text-gray-900 mb-12 text-center drop-shadow-lg tracking-tight">Delivery Orders</h1>

        {orders.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl shadow-xl text-center text-gray-700 border border-blue-300 animate-fade-in">
            <p className="text-3xl font-bold mb-4 text-blue-700">No pending orders for you!</p>
            <p className="text-xl text-gray-600">Check back later for new delivery assignments.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {orders.map(order => (
              <div key={order.id} className="bg-white p-8 rounded-2xl shadow-xl border border-blue-200 flex flex-col transform transition-all duration-300 hover:scale-102 hover:shadow-2xl relative overflow-hidden w-full">
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-purple-600"></div>
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-blue-100">
                  <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                    <FaBox className="mr-3 text-blue-600" /> Order #{order.id?.substring(0, 8)}...
                  </h2>
                  <span className={`px-4 py-1.5 text-sm font-bold rounded-full uppercase tracking-wide ${
                    order.status === 'Pending' ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' :
                    order.status === 'Shipped' ? 'bg-green-100 text-green-700 border border-green-300' :
                    'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}>
                    {order.status}
                  </span>
                </div>

                <div className="space-y-4 text-gray-700 flex-grow text-base">
                  <p className="flex items-center"><FaUser className="mr-3 text-blue-600 text-lg" /> <strong>Customer:</strong> <span className="ml-2 font-medium">{order.fullName}</span></p>
                  <p className="flex items-center"><FaPhone className="mr-3 text-blue-600 text-lg" /> <strong>Phone:</strong> <a href={`tel:${order.userNumber}`} className="text-blue-600 hover:underline font-medium">{order.userNumber}</a></p>
                  <p className="flex items-center"><FaMapMarkerAlt className="mr-3 text-blue-600 text-lg" /> <strong>Address:</strong> <span className="ml-2">{order.userAddress}</span></p>
                  {order.pharmacyName && (
                    <p className="flex items-center"><FaTruck className="mr-3 text-blue-600 text-lg" /> <strong>From Pharmacy:</strong> <span className="ml-2">{order.pharmacyName}</span></p>
                  )}
                  <p className="flex items-center"><FaCalendarAlt className="mr-3 text-blue-600 text-lg" /> <strong>Order Date:</strong> <span className="ml-2">{new Date(order.orderDate).toLocaleDateString()}</span></p>
                  {order.shippedAt && (
                    <p className="flex items-center"><FaTruck className="mr-3 text-blue-600 text-lg" /> <strong>Shipped At:</strong> <span className="ml-2">{new Date(order.shippedAt).toLocaleString()}</span></p>
                  )}
                  {order.mtp && (
                    <p className="flex items-center text-green-700"><FaCheckCircle className="mr-3 text-green-600 text-lg" /> <strong>MTP Confirmed:</strong> <span className="ml-2 font-semibold">{order.mtp}</span></p>
                  )}
                  <p className="flex items-center text-xl font-bold text-green-700"><FaMoneyBillWave className="mr-3 text-green-600 text-lg" /> <strong>Total:</strong> <span className="ml-2">EGP {order.totalPrice.toFixed(2)}</span></p>
                  {order.deliveryFee > 0 && (
                    <p className="flex items-center"><FaMoneyBillWave className="mr-3 text-blue-600 text-lg" /> <strong>Shipping:</strong> <span className="ml-2">EGP {order.deliveryFee.toFixed(2)}</span></p>
                  )}
                  <p className="flex items-center"><FaMoneyBillWave className="mr-3 text-blue-600 text-lg" /> <strong>Payment:</strong> <span className="ml-2">{order.paymentMethod === 'vodafoneCash' ? 'Vodafone Cash' : 'Cash on Delivery'}</span></p>
                  {order.userAddressMapLink && (
                    <p className="flex items-center"><FaMapMarkerAlt className="mr-3 text-blue-600 text-lg" /> <strong>Address Link:</strong> <a href={order.userAddressMapLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">View on Map</a></p>
                  )}
                  <p className="flex items-center"><FaBox className="mr-3 text-blue-600 text-lg" /> <strong>Order Type:</strong> <span className="ml-2">{order.orderType}</span></p>

                  {order.orderType === 'Prescription Order' && (
                    <div className="mt-6 pt-4 border-t border-blue-100">
                      <h3 className="font-bold text-gray-800 mb-3 flex items-center text-lg"><FaBox className="mr-3 text-blue-600" /> Prescription Details:</h3>
                      {order.uploadedImageLink && (
                         <p className="flex items-center"><FaBox className="mr-3 text-blue-600 text-lg" /> <strong>Prescription Image:</strong> <a href={order.uploadedImageLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">View Image</a></p>
                      )}
                      {order.doctorName && (
                        <p className="flex items-center"><FaUser className="mr-3 text-blue-600 text-lg" /> <strong>Doctor:</strong> <span className="ml-2">{order.doctorName}</span></p>
                      )}
                      {order.clinicHospitalName && (
                        <p className="flex items-center"><FaMapMarkerAlt className="mr-3 text-blue-600 text-lg" /> <strong>Clinic/Hospital:</strong> <span className="ml-2">{order.clinicHospitalName}</span></p>
                      )}
                       {order.prescriptionDate && (
                        <p className="flex items-center"><FaCalendarAlt className="mr-3 text-blue-600 text-lg" /> <strong>Prescription Date:</strong> <span className="ml-2">{order.prescriptionDate}</span></p>
                      )}
                       {order.prescriptionTime && (
                        <p className="flex items-center"><FaCalendarAlt className="mr-3 text-blue-600 text-lg" /> <strong>Prescription Time:</strong> <span className="ml-2">{order.prescriptionTime}</span></p>
                      )}
                       {order.manualProductList && (
                        <p className="flex items-center"><FaBox className="mr-3 text-blue-600 text-lg" /> <strong>Manual Product List:</strong> <span className="ml-2">{order.manualProductList}</span></p>
                      )}
                       {order.notFoundMedicines && (
                        <p className="flex items-center"><FaBox className="mr-3 text-blue-600 text-lg" /> <strong>Not Found Medicines:</strong> <span className="ml-2">{order.notFoundMedicines}</span></p>
                      )}
                    </div>
                  )}

                  <div className="mt-6 pt-4 border-t border-blue-100">
                    <h3 className="font-bold text-gray-800 mb-3 flex items-center text-lg"><FaBox className="mr-3 text-blue-600" /> Items:</h3>
                    <ul className="list-disc list-inside text-base space-y-1.5 pl-5">
                      {order.items.map(item => (
                        <li key={item.id} className="text-gray-600">{item.name} (x{item.quantity}) - EGP {item.price.toFixed(2)}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-blue-100">
                  <button
                      onClick={() => handleMarkAsShippedClick(order.id)}
                      className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3.5 rounded-xl font-bold text-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-300 flex items-center justify-center shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-300"
                    >
                      <FaTruck className="mr-3 text-xl" />
                      Mark as Shipped
                    </button>
                  {order.status === 'Pending' && (
                    <button
                      onClick={() => handleMarkAsShippedClick(order.id)}
                      disabled={updatingOrderId === order.id}
                      className="w-full bg-gradient-to-r from-green-500 to-teal-600 text-white py-3.5 rounded-xl font-bold text-lg hover:from-green-600 hover:to-teal-700 transition-all duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-green-300"
                    >
                      {updatingOrderId === order.id ? (
                        <FaSpinner className="animate-spin mr-3 text-xl" />
                      ) : (
                        <FaCheckCircle className="mr-3 text-xl" />
                      )}
                      Mark as Shipped
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MTP Confirmation Modal */}
      {showMtpModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white p-10 rounded-2xl shadow-3xl w-full max-w-md transform transition-all duration-300 scale-100 opacity-100 border border-blue-200">
            <div className="flex justify-between items-center mb-7">
              <h3 className="text-3xl font-bold text-gray-800">Confirm Shipment</h3>
              <button onClick={() => setShowMtpModal(false)} className="text-gray-500 hover:text-gray-700 transition-colors duration-200">
                <FaTimesCircle className="text-4xl" />
              </button>
            </div>
            <p className="text-gray-700 mb-7 text-lg leading-relaxed">Are you sure you want to mark this order as shipped?</p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setShowMtpModal(false)}
                className="px-7 py-3.5 bg-gray-200 text-gray-800 rounded-xl font-semibold hover:bg-gray-300 transition-colors duration-200 text-lg shadow-md"
              >
                No
              </button>
              <button
                onClick={async () => {
                  if (!user || !userData?.deliveryInfo?.companyId || !userData?.fullName || !currentOrderIdForMtp) {
                    toast.error('Authentication error or order not selected. Please log in again.');
                    return;
                  }
              
                  setUpdatingOrderId(currentOrderIdForMtp);
                  try {
                    const orderRef = doc(db, 'orders', currentOrderIdForMtp);
                    await updateDoc(orderRef, {
                      status: 'Shipped',
                      deliverymanId: userData.uid,
                      deliverymanName: userData.fullName,
                      shippedAt: new Date().toISOString(),
                    });
              
                    setOrders(prevOrders =>
                      prevOrders.map(order =>
                        order.id === currentOrderIdForMtp
                          ? ({ ...order, status: 'Shipped', deliverymanId: userData.uid, deliverymanName: userData.fullName, shippedAt: new Date().toISOString() } as Order)
                          : order
                      )
                    );
                    toast.success('Order marked as shipped successfully!');
                    setShowMtpModal(false);
                    setCurrentOrderIdForMtp(null);
                  } catch (error) {
                    console.error('Error marking order as shipped:', error);
                    toast.error('Failed to mark order as shipped.');
                  } finally {
                    setUpdatingOrderId(null);
                  }
                }}
                disabled={updatingOrderId === currentOrderIdForMtp}
                className="px-7 py-3.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-300"
              >
                {updatingOrderId === currentOrderIdForMtp ? (
                  <FaSpinner className="animate-spin mr-3" />
                ) : (
                  <FaCheckCircle className="mr-3" />
                )}
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeliveryOrdersPage;
