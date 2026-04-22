// DEV 4 — get, upsert (onboarding + settings)
import { Request, Response } from 'express';

export const getMyPreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    // const prefs = await PreferenceModel.findOne({ userId });
    
    return res.status(200).json({
      notifications: true,
      language: 'en'
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load preferences' }});
  }
};

export const updateMyPreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // await PreferenceModel.upsert({ userId, ...updates });
    
    return res.status(200).json({
      success: true,
      message: "Preferences updated",
      data: updates
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid preference data' }});
  }
};
