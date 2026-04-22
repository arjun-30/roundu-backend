// DEV 3 — submit(5 questions), getByBooking, getPrediction
import { Request, Response } from 'express';

export const submitReport = async (req: Request, res: Response) => {
  try {
    const { bookingId, workDone, materials, photos } = req.body;
    
    const report = {
      id: 'rep-99',
      bookingId,
      workDone,
      materials,
      photos, // Array of S3 URLs
      submittedAt: new Date()
    };

    return res.status(201).json(report);
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'REPORT_FAILED', message: 'Failed to save report' }});
  }
};
