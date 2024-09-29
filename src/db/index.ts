import mongoose from 'mongoose';
import { existsSync, readdirSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * This function first check if the file is a directory, then if it is a file, and then if it exists.
 */
function checkFile(file: string) {
  console.log(`Checking file: ${file}`);
  try {
    const stat = lstatSync(file);
    return stat.isFile();
  } catch (err) {
    console.error(`Error checking file: ${file}`, err);
    return false;
  }
}

export class DB {
  db: mongoose.Connection;
  constructor() {
    this.db = mongoose.connection;
  }

  async connect() {
    console.log('Connecting to MongoDB', {
      url: process.env.MONGO_URL,
      ca: process.env.MONGO_CA?.substring(0, 100),
      cert: process.env.MONGO_CERT?.substring(0, 100),
    });

    if (!process.env.MONGO_URL) {
      throw new Error('MONGO_URL is required');
    }

    if (!process.env.MONGO_CA) {
      throw new Error('MONGO_CA is required');
    }

    if (!process.env.MONGO_CERT) {
      throw new Error('MONGO_CERT is required');
    }

    const caExists = checkFile(process.env.MONGO_CA);
    const certExists = checkFile(process.env.MONGO_CERT);

    if (!caExists) {
      const filesInDir = readdirSync(process.env.MONGO_CA);
      console.log('Files in dir:', filesInDir);
      throw new Error(
        `MONGO_CA file does not exist or is not a file ${process.env.MONGO_CA}`
      );
    }

    if (!certExists) {
      const filesInDir = readdirSync(process.env.MONGO_CERT);
      console.log('Files in dir:', filesInDir);
      throw new Error(
        `MONGO_CERT file does not exist or is not a file ${process.env.MONGO_CERT}`
      );
    }

    await mongoose
      .connect(`mongodb://${process.env.MONGO_URL}:27017/egdata`, {
        authMechanism: 'MONGODB-X509',
        authSource: '$external',
        tlsCAFile: process.env.MONGO_CA,
        tlsCertificateKeyFile: process.env.MONGO_CERT,
        tls: true,
        tlsAllowInvalidCertificates: true,
      })
      .catch((err) => {
        console.error('Error connecting to MongoDB', err);
        process.exit(1);
      });
    console.log('Connected to MongoDB');
  }

  async disconnect() {
    await this.db.close();
  }
}

export const db = new DB();
