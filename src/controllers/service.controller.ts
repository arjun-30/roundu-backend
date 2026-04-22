// EXISTING — list, getById, create(admin), update(admin), remove(admin)
import { Request, Response } from 'express';
// import { ServiceModel } from '../models/service.model'; // Assuming a generic DB model

export const getServices = async (req: Request, res: Response) => {
  try {
    const { category, search, page = 1, limit = 10 } = req.query;
    
    // MOCK DB CALL: Replace with actual DB logic (e.g., Prisma, TypeORM, raw SQL)
    // const services = await ServiceModel.find({ category, search, offset, limit });
    const mockData = {
      data: [{ id: "123", name: "Deep Cleaning", basePrice: 150 }],
      total: 1,
      page: Number(page),
      limit: Number(limit)
    };

    return res.status(200).json(mockData);
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch services' }});
  }
};

export const getServiceById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // const service = await ServiceModel.findById(id);
    const service = { id, name: "Deep Cleaning", basePrice: 150 }; // Mock

    if (!service) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Service not found' }});
    }

    return res.status(200).json(service);
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error fetching service' }});
  }
};

export const createService = async (req: Request, res: Response) => {
  try {
    const { name, category, basePrice, durationMinutes } = req.body;
    
    // const newService = await ServiceModel.create({ ... });
    const newService = { id: "new-uuid", name, category, basePrice, durationMinutes }; // Mock

    return res.status(201).json(newService);
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error creating service' }});
  }
};

export const updateService = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // const updatedService = await ServiceModel.update(id, updates);
    const updatedService = { id, ...updates }; // Mock

    return res.status(200).json(updatedService);
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error updating service' }});
  }
};

export const deleteService = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // await ServiceModel.delete(id);
    
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error deleting service' }});
  }
};
