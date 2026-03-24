import { Module } from '@nestjs/common';
import { TypeOrmModule as NestTypeOrmModule } from '@nestjs/typeorm';
import path from 'path';

// Use import.meta.dirname when available (ESM/tsx), fall back to __dirname (CJS bundle)
const currentDir = typeof import.meta?.dirname === 'string'
  ? import.meta.dirname
  : __dirname;

@Module({
  imports: [
    NestTypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: path.join(process.cwd(), 'data', 'ml_dashboard.db'),
      entities: [path.join(currentDir, '..', '**', '*.entity.{ts,js}')],
      synchronize: false, // Drizzle manages schema via drizzle-kit push
      logging: false,
    }),
  ],
})
export class TypeOrmConfigModule {}
