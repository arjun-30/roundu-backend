// TECH LEAD — mounts all routers under /api/v1
import subscriptionRoutes      from './subscription.routes';
import notificationRoutes      from './notification-schedule.routes';

// inside the router setup:
router.use('/subscriptions', subscriptionRoutes);
router.use('/notifications', notificationRoutes);
