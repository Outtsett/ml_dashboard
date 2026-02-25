import { Module } from '@nestjs/common';
import { TypeOrmModule as NestTypeOrmModule } from '@nestjs/typeorm';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

@Module({
  imports: [
    NestTypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: path.join(process.cwd(), 'data', 'ml_dashboard.db'),
      entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
      synchronize: false, // Drizzle manages schema via drizzle-kit push
      logging: false,
    }),
  ],
})
export class TypeOrmConfigModule {}
