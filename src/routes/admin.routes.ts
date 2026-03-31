// EXISTING
import { Router } from 'express';
const router = Router();

// Only accessible by role: admin
router.get('/kyc/pending', (req, res) => {
  // Return list of providers awaiting manual check
  res.json([{ id: 'p1', name: 'Verified Candidate', docs: ['aadhaar_front.jpg'] }]);
});

router.patch('/kyc/:id', (req, res) => {
  const { status, reason } = req.body; // 'verified' | 'rejected'
  res.json({ message: `Provider KYC ${status}` });
});

export default router;
