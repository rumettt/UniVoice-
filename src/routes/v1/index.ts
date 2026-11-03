import { Router } from 'express';
import healthRouter from './health.router';

const v1Router = Router();

v1Router.use(healthRouter);

// Future v1 route modules are mounted here:
// v1Router.use('/requests', requestsRouter);
// v1Router.use('/users', usersRouter);

export default v1Router;
