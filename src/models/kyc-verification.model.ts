// DEV 3 — create, findByUserId, updateStatus, getVerified
export interface KYCVerification {
  id: string;
  userId: string;
  status: 'pending' | 'verified' | 'rejected';
  idType: 'aadhaar' | 'pan';
  idNumber: string; // Encrypted in production
  documentUrl?: string;
  rejectionReason?: string;
  verifiedAt?: Date;
}
