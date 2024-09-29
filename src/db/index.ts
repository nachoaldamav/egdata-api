import mongoose from 'mongoose';
import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class DB {
  db: mongoose.Connection;
  constructor() {
    this.db = mongoose.connection;
  }

  async connect() {
    console.log('Connecting to MongoDB', {
      url: process.env['MONGO_URL'],
      ca: process.env['MONGO_CA']?.substring(0, 100),
      cert: process.env['MONGO_CERT']?.substring(0, 100),
    });

    if (!process.env['MONGO_URL']) {
      throw new Error('MONGO_URL is required');
    }

    if (!process.env['MONGO_CA']) {
      throw new Error('MONGO_CA is required');
    }

    if (!process.env['MONGO_CERT']) {
      throw new Error('MONGO_CERT is required');
    }

    const caExists = existsSync(process.env['MONGO_CA']);
    const certExists = existsSync(process.env['MONGO_CERT']);

    if (!caExists || !certExists) {
      console.error('CA or CERT file does not exist', {
        ca: !!caExists,
        cert: !!certExists,
      });

      const filesInDir = readdirSync(dirname(process.env['MONGO_CA']));

      console.error('Files in dir', filesInDir);

      throw new Error('CA or CERT file does not exist');
    }

    await mongoose.connect(
      `mongodb://${process.env['MONGO_URL']}:27017/egdata`,
      {
        authMechanism: 'MONGODB-X509',
        authSource: '$external',
        tlsCAFile: process.env['MONGO_CA'],
        tlsCertificateKeyFile: process.env['MONGO_CERT'],
        tls: true,
        tlsAllowInvalidCertificates: true,
      }
    );
    console.log('Connected to MongoDB');
  }

  async disconnect() {
    await this.db.close();
  }
}

export const db = new DB();
