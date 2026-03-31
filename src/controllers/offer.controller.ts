// DEV 4 — listActive, applyToBooking, create(admin), deactivate(admin)
import { Request, Response } from 'express';

export const getOffers = async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.query;
    
    // Logic: Find active offers. If serviceId is provided, filter for 
    // offers applicable to that specific service category.
    const activeOffers = [
      { id: "o1", code: "WELCOME50", description: "Flat ₹50 off", discountAmount: 50, type: "flat" },
      { id: "o2", code: "CLEAN10", description: "10% off Cleaning", discountAmount: 10, type: "percentage" }
    ];

    return res.status(200).json(activeOffers);
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch offers' }});
  }
};

export const validateOffer = async (req: Request, res: Response) => {
  try {
    const { code, bookingId } = req.body;

    // 1. Check if offer exists and is active
    // 2. Check if bookingId is valid and not already paid
    // 3. Check if user has used this specific one-time code before
    
    const mockValidation = {
      discountAmount: 50,
      discountType: "flat",
      finalPrice: 450 // base price - discount
    };

    return res.status(200).json(mockValidation);
  } catch (error) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_OFFER', message: 'Coupon is expired or invalid' }});
  }
};
