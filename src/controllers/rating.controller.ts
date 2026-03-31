// EXISTING — create(+triggers cashback), listByProvider, getByBooking
import { Request, Response } from 'express';

export const submitRating = async (req: Request, res: Response) => {
  try {
    const { bookingId, rating, review, tags } = req.body;
    const userId = req.user.id;

    // Logic: Ensure booking is 'completed' before allowing rating
    // Logic: Prevent double rating for the same bookingId

    return res.status(201).json({ id: 'r123', bookingId, rating, review });
  } catch (error) {
    return res.status(409).json({ success: false, error: { code: 'ALREADY_RATED', message: 'Rating already exists' }});
  }
};
