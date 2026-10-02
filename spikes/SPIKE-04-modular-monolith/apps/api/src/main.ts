import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
const port = Number(process.env.PORT ?? 61040);
await app.listen(port);
console.log(`api escuchando en http://localhost:${port}`);
if (process.env.SMOKE_EXIT === '1') await app.close();
