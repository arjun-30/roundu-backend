// DEV 3 — initiate, callback, getStatus
import { Request, Response } from 'express';

export const initiateKYC = async (req: Request, res: Response) => {
  try {
    const { aadhaarNumber, panNumber } = req.body;
    const providerId = req.user.id;

    // Logic: Call DigiLocker API to get a redirect URL
    const redirectUrl = `https://hub.digilocker.gov.in/auth/v1/login?state=${providerId}`;

    return res.status(200).json({ redirectUrl });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'KYC_INIT_FAILED', message: 'Could not start verification' }});
  }
};

export const getKYCStatus = async (req: Request, res: Response) => {
  // Mocking status retrieval from DB
  return res.status(200).json({ status: 'pending' });
};

export const handleDigilockerCallback = async (req: Request, res: Response) => {
  // Webhook from DigiLocker
  const { transactionId, status, docType } = req.body;
  // Update KYCVerification model and User model (isVerified: true)
  return res.status(200).json({ success: true });
};
