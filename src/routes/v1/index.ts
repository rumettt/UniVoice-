import { Router } from 'express';
import healthRouter from './health.router';
import authRouter from './auth.router';
import userRouter from './user.router';
import departmentRouter from './department.router';
import categoryRouter from './category.router';
import requestRouter from './request.router';

const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use('/auth', authRouter);
v1Router.use('/users', userRouter);
v1Router.use('/departments', departmentRouter);
v1Router.use('/categories', categoryRouter);
v1Router.use('/requests', requestRouter);

export default v1Router;
