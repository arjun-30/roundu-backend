// DEV 4 — uploadVideo, uploadBeforeAfter, getByProvider, delete
import { Request, Response } from 'express';

export const getPortfolio = async (req: Request, res: Response) => {
  const { providerId } = req.params;
  // const items = await PortfolioModel.find({ providerId });
  return res.status(200).json([{ id: "item1", title: "Kitchen Leak Fix", imageUrl: "s3://..." }]);
};

export const addPortfolioItem = async (req: Request, res: Response) => {
  try {
    const { title, imageUrl, description } = req.body;
    const providerId = req.user.id;

    const newItem = { id: "new-port-id", providerId, title, imageUrl, description };
    return res.status(201).json(newItem);
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Upload failed' }});
  }
};

export const deletePortfolioItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  // await PortfolioModel.delete(id, { providerId: req.user.id });
  return res.status(204).send();
};
